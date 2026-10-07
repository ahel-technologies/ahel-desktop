/**
 * Pickup of agent runs queued on ahel.ai: a seat asks for a run of an issue
 * assigned to the Ahel agent (`POST /run { action: "start" }`), ahel.ai keeps
 * it in `queued` with no session and `requestedBy` set to that seat, and the
 * Ahel Desktop of the person who asked claims it by starting Run with Ahel,
 * whose first `running` report carries the new chat's session. A run someone
 * else asked for is left to their desktop. ahel.ai fails a queued run no
 * desktop reports within 60 minutes.
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
 * @param me - the signed-in person's user id.
 * @param claimed - runs this desktop claimed, by `queuedRunId`.
 * @returns true when the run is this desktop's to start.
 */
export function shouldClaim(issue: Issue, me: string, claimed: ReadonlySet<string>): boolean {
  return issue.assigneeType === 'agent' && isQueued(issue) && issue.run?.requestedBy === me && !claimed.has(queuedRunId(issue))
}

/** What a pickup reads and does. */
export interface PickupHost {
  /** `ahelIssues.list`. */
  list(query: IssueQuery): Promise<RemoteResult<IssuePage>>
  /** `ahelIssues.get`, to see that a run is still queued right before claiming it. */
  get(key: string): Promise<RemoteResult<IssueWriteAnswer>>
  /** The signed-in person's user id, or null while unknown. */
  me(): Promise<string | null>
  /**
   * Start Run with Ahel for the issue; its first report claims the run.
   * @returns whether the chat started.
   */
  claim(issue: Issue): Promise<boolean>
  /** Receives the number of queued runs among the agent's issues after each read. */
  queued(count: number): void
}

/** A pickup: one read and its claims per `poll`. */
export interface Pickup {
  /** Read the agent's issues and claim this person's queued runs; a poll while one runs does nothing. */
  poll(): Promise<void>
}

/**
 * Create the pickup; claimed runs are remembered for the life of this Client.
 * @param host - the reads and the run start.
 * @returns the pickup.
 */
export function createPickup(host: PickupHost): Pickup {
  const claimed = new Set<string>()
  let busy = false

  const readAgentIssues = async (): Promise<Issue[] | null> => {
    const issues: Issue[] = []
    let cursor: string | null = null
    for (let n = 0; n < MAX_PAGES; n++) {
      const query: IssueQuery = { assigneeType: 'agent', limit: PAGE_SIZE }
      const result = await host.list(cursor === null ? query : { ...query, cursor })
      if (!result.ok) return null
      issues.push(...result.value.issues)
      cursor = result.value.nextCursor
      if (cursor === null) break
    }
    return issues
  }

  const claimOne = async (issue: Issue): Promise<void> => {
    const fresh = await host.get(issue.key)
    const current = fresh.ok ? fresh.value.issue : null
    if (current === null || !isQueued(current) || queuedRunId(current) !== queuedRunId(issue)) return
    const id = queuedRunId(current)
    claimed.add(id)
    if (!await host.claim(current)) claimed.delete(id)
  }

  return {
    poll: async () => {
      if (busy) return
      busy = true
      try {
        const issues = await readAgentIssues()
        if (issues === null) return
        const queued = issues.filter(issue => issue.assigneeType === 'agent' && isQueued(issue))
        host.queued(queued.length)
        if (!queued.some(issue => typeof issue.run?.requestedBy === 'string')) return
        const me = await host.me()
        if (me === null) return
        for (const issue of queued) {
          if (shouldClaim(issue, me, claimed)) await claimOne(issue)
        }
      } finally {
        busy = false
      }
    },
  }
}
