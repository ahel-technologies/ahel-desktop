/**
 * Pickup of agent runs queued on ahel.ai: a seat asks for a run of an issue
 * assigned to the Ahel agent (`POST /run { action: "start" }`), ahel.ai keeps
 * it in `queued` with no session and `requestedBy` set to that seat, and the
 * Ahel Desktop of the person who asked claims it by starting Run with Ahel,
 * whose first `running` report carries the new chat's session. A run someone
 * else asked for is left to their desktop. The claim is atomic on ahel.ai:
 * when another session got the run first, ahel.ai answers 409 `run_claimed`
 * and the new chat is dropped unused. ahel.ai fails a queued run no desktop
 * reports within 60 minutes. A claimed run reads, writes and acts in the
 * workspace its issue was listed in, whatever workspace is selected by then.
 */
import type { Issue, IssuePage, IssueQuery, IssueWriteAnswer } from '@ahel/dsh-ahel-account/types'
import type { RemoteResult } from '@ahel/dsh-typert-protocol'

/** Pages of agent issues one pickup read covers at most. */
const MAX_PAGES = 5

/** The largest page ahel.ai serves. */
const PAGE_SIZE = 100

/**
 * Whether an issue's run waits in `queued` for a desktop.
 * @param issue - the issue as read.
 * @returns true for a queued run without a session.
 */
export function isQueued(issue: Issue): boolean {
  return issue.run !== null && issue.run.state === 'queued' && issue.run.sessionId === null
}

/**
 * One queued run's identity: the issue and when it was queued, so the same issue queued again later is a new run.
 * @param issue - an issue with a queued run.
 * @returns `<key>@<queued at>`.
 */
export function queuedRunId(issue: Issue): string {
  return `${issue.key}@${issue.run?.updatedAt ?? ''}`
}

/**
 * Whether this desktop claims an issue's queued run: the issue is the agent's,
 * its run waits without a session, the signed-in person asked for it, and this
 * desktop has not claimed that run already.
 * @param issue - the issue as read.
 * @param me - the signed-in person's user id, or null when ahel.ai already answered only this person's runs (`requestedBy=me`).
 * @param claimed - runs this desktop claimed or saw taken, by `queuedRunId`.
 * @returns true when the run is this desktop's to start.
 */
export function shouldClaim(issue: Issue, me: string | null, claimed: ReadonlySet<string>): boolean {
  return issue.assigneeType === 'agent' && isQueued(issue) && (me === null || issue.run?.requestedBy === me)
    && !claimed.has(queuedRunId(issue))
}

/** How one claim ended: the chat started, another session holds the run, or the start failed and may be retried. */
export type ClaimOutcome = 'started' | 'taken' | 'failed'

/** What a pickup reads and does. */
export interface PickupHost {
  /** `ahelIssues.list`. */
  list(query: IssueQuery): Promise<RemoteResult<IssuePage>>
  /** `ahelIssues.get` in the issue's workspace (null: the selected one), to see that a run is still queued right before claiming it. */
  get(key: string, workspace: string | null): Promise<RemoteResult<IssueWriteAnswer>>
  /** The signed-in person's user id, or null while unknown; read only when ahel.ai ignores the run filters. */
  me(): Promise<string | null>
  /**
   * Start Run with Ahel for the issue; its first report claims the run.
   * @param issue - the issue with its queued run.
   * @param workspace - the workspace the issue was listed in, or null for the selected one.
   * @returns how the claim ended.
   */
  claim(issue: Issue, workspace: string | null): Promise<ClaimOutcome>
}

/** A pickup: one read and its claims per `poll`. */
export interface Pickup {
  /** Read the agent's issues and claim this person's queued runs; a poll while one runs does nothing. */
  poll(): Promise<void>
}

/**
 * Create the pickup; claimed runs, and runs another session took, are remembered for the life of this Client.
 * It asks ahel.ai for this person's queued runs (`runState=queued&requestedBy=me`); an ahel.ai that answers
 * runs in other states, or no `agentsQueued`, ignored those filters, and the pickup then matches the
 * person's user id against the agent issues it answered.
 * @param host - the reads and the run start.
 * @returns the pickup.
 */
export function createPickup(host: PickupHost): Pickup {
  const claimed = new Set<string>()
  let busy = false

  /**
   * Read up to MAX_PAGES pages of one workspace; `filtered` is false when ahel.ai ignored the run filters.
   * Pages read across a workspace switch answer null.
   */
  const read = async (query: IssueQuery): Promise<{ issues: Issue[]; filtered: boolean; workspace: string | null } | null> => {
    const issues: Issue[] = []
    let filtered = true
    let workspace: string | null | undefined
    let cursor: string | null = null
    for (let n = 0; n < MAX_PAGES; n++) {
      const result = await host.list(cursor === null ? query : { ...query, cursor })
      if (!result.ok) return null
      if (workspace !== undefined && workspace !== result.value.workspace) return null
      workspace = result.value.workspace
      issues.push(...result.value.issues)
      // An ahel.ai without the filters also sends no `agentsQueued`.
      if (result.value.agentsQueued === null) filtered = false
      cursor = result.value.nextCursor
      if (cursor === null) break
    }
    return { issues, filtered: filtered && issues.every(isQueued), workspace: workspace ?? null }
  }

  const claimOne = async (issue: Issue, workspace: string | null): Promise<void> => {
    const fresh = await host.get(issue.key, workspace)
    const current = fresh.ok ? fresh.value.issue : null
    if (current === null || !isQueued(current) || queuedRunId(current) !== queuedRunId(issue)) return
    const id = queuedRunId(current)
    claimed.add(id)
    if (await host.claim(current, workspace) === 'failed') claimed.delete(id)
  }

  /** Queued runs to consider, whose they must be (null when ahel.ai answered only this person's runs) and their workspace. */
  const candidates = async (): Promise<{ issues: Issue[]; me: string | null; workspace: string | null } | null> => {
    // An ahel.ai that ignores runState and requestedBy answers every agent issue, which is the fallback read.
    const page = await read({ assigneeType: 'agent', runState: 'queued', requestedBy: 'me', limit: PAGE_SIZE })
    if (page === null) return null
    const { workspace } = page
    if (page.filtered) return { issues: page.issues, me: null, workspace }
    const queued = page.issues.filter(issue => isQueued(issue) && typeof issue.run?.requestedBy === 'string')
    if (queued.length === 0) return { issues: [], me: null, workspace }
    const me = await host.me()
    return me === null ? null : { issues: queued, me, workspace }
  }

  return {
    poll: async () => {
      if (busy) return
      busy = true
      try {
        const found = await candidates()
        if (found === null) return
        for (const issue of found.issues) {
          if (shouldClaim(issue, found.me, claimed)) await claimOne(issue, found.workspace)
        }
      } finally {
        busy = false
      }
    },
  }
}
