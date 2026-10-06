/**
 * The shared issues feed: the board's issues for the current filters, the
 * per-status counts, the agents at work, the projects, the person's role and
 * the assigned-to-me badge, plus every write the panels make. Reads happen on
 * demand, every 60 s while the window has focus and on window focus (the
 * apply wires those). Writes show at once and roll back on a refusal.
 */
import type {
  Issue, IssueActivity, IssueActorType, IssueAssignees, IssueComment, IssueDraft, IssuePage, IssuePatch, IssueProject, IssueQuery, IssueRun,
  IssueRunReport, IssueStatus, IssueWriteAnswer,
} from '@ahel/dsh-ahel-account/types'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { RemoteResult } from '@ahel/dsh-typert-protocol'
import type { IssueDetailLoad, IssuesAnswer, IssuesFilter, IssuesInjected, IssuesState } from './contract.ts'
import { CLOSED } from './model.ts'

/** The `ahelIssues` Remote methods the feed calls. */
export interface IssuesBackend {
  list(query: IssueQuery): Promise<RemoteResult<IssuePage>>
  create(draft: IssueDraft): Promise<RemoteResult<IssueWriteAnswer>>
  get(key: string): Promise<RemoteResult<IssueWriteAnswer>>
  update(key: string, patch: IssuePatch): Promise<RemoteResult<IssueWriteAnswer>>
  deleteIssue(key: string): Promise<RemoteResult<IssueWriteAnswer>>
  comments(key: string): Promise<RemoteResult<readonly IssueComment[]>>
  comment(key: string, body: string, authorType: IssueActorType): Promise<RemoteResult<readonly IssueComment[]>>
  assignees(): Promise<RemoteResult<IssueAssignees>>
  activity(key: string): Promise<RemoteResult<readonly IssueActivity[]>>
  run(key: string, report: IssueRunReport): Promise<RemoteResult<IssueWriteAnswer>>
  projects(): Promise<RemoteResult<readonly IssueProject[]>>
  createProject(name: string): Promise<RemoteResult<readonly IssueProject[]>>
}

/** Who is signed in and with which role. */
export interface IssuesAccount {
  readonly signedIn: boolean
  /** Role in the selected workspace; null while unknown. */
  readonly role: string | null
}

/** Pages read per board refresh at most. */
const MAX_PAGES = 5

const FILTER: IssuesFilter = { assignee: 'all', project: null, q: '' }

/** The empty feed. */
export const EMPTY_ISSUES: IssuesState = {
  phase: 'loading', message: null, issues: [], counts: {}, agentsWorking: 0, filter: FILTER, projects: [], assignees: null, role: null, mine: 0,
  runs: {}, open: null, composer: null, offerRun: null,
}

/** Run states a run report moves the issue's status to; ahel.ai applies the same moves. */
const RUN_STATUS: Partial<Record<IssueRunReport['state'], IssueStatus>> = {
  running: 'in_progress', waiting_approval: 'blocked', finished: 'in_review',
}

/** The feed and the face actions it backs. */
export type IssuesFeed = Omit<IssuesInjected, 'run' | 'openSession' | 'showBoard' | 'openLink' | 'viewOnWeb' | 'hooks'> & {
  readonly state: HostObservable<IssuesState>
  /** Record a run report locally and send it. */
  report(key: string, report: IssueRunReport): void
  /** Re-read the account, then the board. */
  reload(): Promise<void>
  /** Post a run's closing summary as Ahel's comment. */
  agentComment(key: string, body: string): void
}

/** A Remote failure's message worth showing: ahel.ai's own reason for refusals, nothing for transport failures. */
function reason(error: { code: string; message: string }): string | null {
  return error.code === 'ahel-issues/forbidden' || error.code === 'ahel-issues/refused' ? error.message : null
}

/**
 * Create the feed.
 * @param backend - the `ahelIssues` Remote.
 * @param account - reads whether someone is signed in and their role.
 * @returns the observable state and its actions.
 */
export function createIssuesFeed(backend: IssuesBackend, account: () => Promise<IssuesAccount>): IssuesFeed {
  let value = EMPTY_ISSUES
  const listeners = new Set<() => void>()
  const state: HostObservable<IssuesState> = {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const set = (next: Partial<IssuesState>): void => {
    value = { ...value, ...next }
    for (const listener of listeners) listener()
  }
  const replaceIssue = (issue: Issue): void => {
    const exists = value.issues.some(row => row.key === issue.key)
    set({ issues: exists ? value.issues.map(row => row.key === issue.key ? issue : row) : [issue, ...value.issues] })
  }

  // Only the newest read publishes.
  let generation = 0
  const readBoard = async (): Promise<void> => {
    const mine = ++generation
    const { filter } = value
    const query: IssueQuery = {
      ...filter.assignee === 'all' ? {} : { assigneeType: filter.assignee === 'agents' ? 'agent' : 'member' },
      ...filter.project === null ? {} : { project: filter.project },
      ...filter.q.trim() === '' ? {} : { q: filter.q.trim() },
    }
    const issues: Issue[] = []
    let page: IssuePage | undefined
    let cursor: string | null = null
    for (let n = 0; n < MAX_PAGES; n++) {
      const result = await backend.list(cursor === null ? query : { ...query, cursor })
      if (mine !== generation) return
      if (!result.ok) {
        const code = result.error.code
        if (code === 'ahel-issues/outdated') set({ phase: 'outdated', message: null })
        else if (code === 'ahel-issues/signed-out') set({ ...EMPTY_ISSUES, phase: 'signed-out', filter: value.filter })
        else set({ phase: value.phase === 'ready' ? 'ready' : 'failed', message: reason(result.error) })
        return
      }
      page = result.value
      issues.push(...page.issues)
      cursor = page.nextCursor
      if (cursor === null) break
    }
    if (page === undefined) return
    set({ phase: 'ready', message: null, issues, counts: page.counts, agentsWorking: page.agentsWorking })
  }
  const readMine = async (): Promise<void> => {
    const result = await backend.list({ assigneeType: 'member', assigneeId: 'me', limit: 1 })
    if (!result.ok) return
    const open = Object.entries(result.value.counts)
      .filter(([status]) => !CLOSED.has(status as IssueStatus))
      .reduce((sum, [, n]) => sum + (Number.isFinite(n) ? n : 0), 0)
    if (open !== value.mine) set({ mine: open })
  }
  const readProjects = async (): Promise<void> => {
    const result = await backend.projects()
    if (result.ok) set({ projects: result.value })
  }
  const readAssignees = async (): Promise<void> => {
    const result = await backend.assignees()
    if (result.ok) set({ assignees: result.value })
  }
  const reload = async (): Promise<void> => {
    const who = await account()
    if (!who.signedIn) {
      generation++
      if (value.phase !== 'signed-out') set({ ...EMPTY_ISSUES, phase: 'signed-out', filter: value.filter })
      return
    }
    if (who.role !== value.role) set({ role: who.role })
    if (value.phase === 'signed-out') set({ phase: 'loading' })
    await Promise.all([readBoard(), readMine(), readProjects(), readAssignees()])
  }
  const refresh = (): void => { void reload().catch(() => undefined) }

  const answer = (result: RemoteResult<unknown>): IssuesAnswer =>
    result.ok ? { ok: true } : { ok: false, message: reason(result.error) }

  const update = async (key: string, patch: IssuePatch): Promise<IssuesAnswer> => {
    const before = value.issues.find(row => row.key === key)
    if (before !== undefined) {
      const { project: _project, ...plain } = patch
      const project = patch.project === undefined
        ? before.project
        : patch.project === null ? null : value.projects.find(row => row.id === patch.project) ?? before.project
      replaceIssue({ ...before, ...plain as Partial<Issue>, project, updatedAt: new Date().toISOString() })
    }
    const result = await backend.update(key, patch)
    if (result.ok) {
      if (result.value.issue !== null) replaceIssue(result.value.issue)
      // Assigning the agent from the board offers Run now.
      if (patch.assigneeType === 'agent' && before?.assigneeType !== 'agent') set({ offerRun: key })
      void readMine().catch(() => undefined)
    } else if (before !== undefined) {
      replaceIssue(before)
    }
    return answer(result)
  }

  return {
    state,
    reload,
    refresh,
    setFilter: (filter) => {
      set({ filter: { ...value.filter, ...filter } })
      void readBoard().catch(() => undefined)
    },
    openIssue: (key) => { set({ open: key }) },
    compose: (status) => { set({ composer: status === null ? null : { status } }) },
    dismissOffer: () => { set({ offerRun: null }) },
    create: async (draft) => {
      const result = await backend.create(draft)
      if (result.ok && result.value.issue !== null) {
        replaceIssue(result.value.issue)
        set({ composer: null, open: result.value.issue.key })
        if (draft.assigneeType === 'agent') set({ offerRun: result.value.issue.key })
      }
      if (result.ok) refresh()
      return answer(result)
    },
    update,
    remove: async (key) => {
      const result = await backend.deleteIssue(key)
      if (result.ok) set({ issues: value.issues.filter(row => row.key !== key), open: value.open === key ? null : value.open })
      return answer(result)
    },
    detail: async (key): Promise<IssueDetailLoad> => {
      const [issue, comments, activity] = await Promise.all([backend.get(key), backend.comments(key), backend.activity(key)])
      if (!issue.ok) return { ok: false, message: reason(issue.error) }
      const read = issue.value.issue ?? value.issues.find(row => row.key === key)
      if (read === undefined) return { ok: false, message: null }
      return { ok: true, issue: read, comments: comments.ok ? comments.value : [], activity: activity.ok ? activity.value : [] }
    },
    comment: async (key, body) => answer(await backend.comment(key, body, 'member')),
    agentComment: (key, body) => { void backend.comment(key, body, 'agent').catch(() => undefined) },
    createProject: async (name) => {
      const result = await backend.createProject(name)
      if (result.ok) set({ projects: result.value })
      return answer(result)
    },
    report: (key, report) => {
      const run: IssueRun = { ...report, updatedAt: new Date().toISOString() }
      set({ runs: { ...value.runs, [key]: run } })
      const issue = value.issues.find(row => row.key === key)
      const status = RUN_STATUS[report.state]
      if (issue !== undefined && status !== undefined && issue.status !== status) replaceIssue({ ...issue, status })
      void backend.run(key, report).then((result) => {
        if (result.ok && result.value.issue !== null) replaceIssue(result.value.issue)
      }).catch(() => undefined)
    },
  }
}
