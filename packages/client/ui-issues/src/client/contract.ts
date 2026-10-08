/** The Issues panel face shared by the board, the detail drawer, New Issue and the sidebar rows. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {
  Issue, IssueActivity, IssueAssignees, IssueComment, IssueDraft, IssuePatch, IssueProject, IssueRun, IssueStatus,
} from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from './locales.ts'

/** Which assignees the board shows. */
export type AssigneeFilter = 'all' | 'members' | 'agents'

/** The board's filters. */
export interface IssuesFilter {
  readonly assignee: AssigneeFilter
  /** Project id, or null for every project. */
  readonly project: string | null
  readonly q: string
}

/** Where the board's data stands. */
export type IssuesPhase = 'signed-out' | 'loading' | 'ready' | 'outdated' | 'failed'

/** What the shared issues feed holds. */
export interface IssuesState {
  readonly phase: IssuesPhase
  /** The last failed read's message, if ahel.ai gave one. */
  readonly message: string | null
  readonly issues: readonly Issue[]
  /** Issues per status for the current filters. */
  readonly counts: Readonly<Record<string, number>>
  /** Agent runs running or waiting for the person across the workspace, as ahel.ai counts them. */
  readonly agentsWorking: number
  /** Agent runs queued on ahel.ai for a desktop across the workspace; 0 from an ahel.ai that does not count them. */
  readonly agentsQueued: number
  readonly filter: IssuesFilter
  readonly projects: readonly IssueProject[]
  /** The workspace's seats and agents; null until read. */
  readonly assignees: IssueAssignees | null
  /** The person's role in the selected workspace; null while unknown. */
  readonly role: string | null
  /** Issues assigned to the person that are not done or cancelled. */
  readonly mine: number
  /** Runs this window started, newer than the server's copy until the next read. */
  readonly runs: Readonly<Record<string, IssueRun>>
  /** The model label of each chat a run of this window works in, by session id; a chat whose model is unknown is absent. */
  readonly models: Readonly<Record<string, string>>
  /** The issue whose detail is open. */
  readonly open: string | null
  /** Set while New Issue is open; `status` preselects the column it was opened from. */
  readonly composer: { readonly status: IssueStatus } | null
  /** Set after an issue was assigned to the agent from the board, to offer Run now. */
  readonly offerRun: string | null
}

/** A write's result; `message` is ahel.ai's reason (for example a role refusal) or null. */
export type IssuesAnswer = { readonly ok: true } | { readonly ok: false; readonly message: string | null }

/** A detail read that ahel.ai was too busy for or did not answer, so repeating it may work. */
export interface IssueDetailRetry {
  /** ahel.ai's Retry-After in milliseconds, or null when it sent none. */
  readonly afterMs: number | null
}

/** One issue's detail reads; `retry` is set when a part of the read failed for a reason that repeating may fix. */
export type IssueDetailLoad =
  | {
    readonly ok: true
    readonly issue: Issue
    readonly comments: readonly IssueComment[]
    readonly activity: readonly IssueActivity[]
    readonly retry: IssueDetailRetry | null
  }
  | { readonly ok: false; readonly message: string | null; readonly retry: IssueDetailRetry | null }

/** Face of the Issues panel, the New Issue row and the Issues sidebar row. */
export interface IssuesInjected {
  /** Re-read the board now, then claim the runs this person queued on ahel.ai. */
  refresh(): void
  /** Change some filters; the board re-reads. */
  setFilter(filter: Partial<IssuesFilter>): void
  /** Open one issue's detail, or close it with null. */
  openIssue(key: string | null): void
  /** Open New Issue preset to one column, or close it with null. */
  compose(status: IssueStatus | null): void
  /** Forget the Run now offer. */
  dismissOffer(): void
  /** Create an issue; on success the detail opens. */
  create(draft: IssueDraft): Promise<IssuesAnswer>
  /** Change some fields; the board shows the change at once and rolls it back on a refusal. */
  update(key: string, patch: IssuePatch): Promise<IssuesAnswer>
  /** Delete an issue; ahel.ai allows it for owners. */
  remove(key: string): Promise<IssuesAnswer>
  /** Read the issue with its comments and activity. */
  detail(key: string): Promise<IssueDetailLoad>
  /** Post a comment. */
  comment(key: string, body: string): Promise<IssuesAnswer>
  /** Create a project and select nothing. */
  createProject(name: string): Promise<IssuesAnswer>
  /** Start a new chat seeded with the issue and track it as the issue's run. */
  run(issue: Issue): Promise<IssuesAnswer>
  /** Show the chat a run happens in. */
  openSession(sessionId: string): void
  /** Open the issue's page on ahel.ai, in the selected workspace. */
  viewOnWeb(key: string): void
  /** Open an https link outside the app. */
  openLink(url: string): void
  hooks: {
    issues: HostObservable<IssuesState>
  }
}

/** Props of the Issues main panel. */
export type IssuesPageProps = PropsRuntime<'main'> & InjectFace<IssuesInjected> & PropsLocale<'ahel-issues'>

/** Props of the Issues sidebar glyph with its assigned-to-me badge. */
export type IssuesPanelIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<IssuesInjected>
