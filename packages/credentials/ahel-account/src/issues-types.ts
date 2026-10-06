/**
 * Shapes of ahel.ai's `/api/desktop/issues` and `/api/desktop/projects`
 * routes: the team's issues, their comments, activity and the run that
 * works on one in a desktop chat.
 */

import type {} from '@ahel/dsh-typert-protocol'

declare module '@ahel/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Ahel account is signed in, or ahel.ai refused its grant after one refresh. */
    'ahel-issues/signed-out': Record<string, never>
    /** ahel.ai does not serve the issues routes yet. */
    'ahel-issues/outdated': { readonly status: number }
    /** The person's role does not allow this write; the message is ahel.ai's reason. */
    'ahel-issues/forbidden': { readonly error: string | null }
    /** ahel.ai refused the request (bad input, unknown issue); the message is its own sentence. */
    'ahel-issues/refused': { readonly status: number; readonly error: string | null }
    /** ahel.ai rate-limited the request. */
    'ahel-issues/busy': { readonly retryAfterSec: number | null }
    /** ahel.ai did not answer, timed out, or answered a server error. */
    'ahel-issues/unreachable': { readonly status: number | null }
  }
}

/** Board columns plus `cancelled`; no transition is enforced. */
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled'

/** Issue priority, `none` first. */
export type IssuePriority = 'none' | 'low' | 'medium' | 'high' | 'urgent'

/** Who an issue is assigned to or created by: a teammate or an agent. */
export type IssueActorType = 'member' | 'agent'

/** State of the run that works on an issue in a desktop chat. */
export type IssueRunState = 'queued' | 'running' | 'waiting_approval' | 'finished' | 'failed'

/** The run attached to an issue. */
export interface IssueRun {
  /** Desktop session the run happens in. */
  readonly sessionId: string
  /** Null when ahel.ai holds no state for the session. */
  readonly state: IssueRunState | null
  /** Tool calls made so far. */
  readonly steps: number
  /** Expected tool calls; null when unknown. */
  readonly totalSteps: number | null
  readonly updatedAt: string
}

/** A project an issue may belong to. */
export interface IssueProject {
  readonly id: string
  readonly name: string
}

/** One issue. */
export interface Issue {
  /** Workspace prefix and number, for example `AHEL-137`. */
  readonly key: string
  readonly title: string
  /** Markdown. */
  readonly description: string
  readonly status: IssueStatus
  readonly priority: IssuePriority
  readonly assigneeType: IssueActorType | null
  readonly assigneeId: string | null
  readonly assigneeName: string | null
  /** Initials, or a picture URL. */
  readonly assigneeAvatar: string | null
  readonly project: IssueProject | null
  readonly labels: readonly string[]
  readonly parentKey: string | null
  readonly creatorType: IssueActorType
  readonly creatorName: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly run: IssueRun | null
  readonly commentCount: number
}

/** Filters of one issue list read; every field is optional. */
export interface IssueQuery {
  readonly status?: IssueStatus | undefined
  /** `none` is unassigned. */
  readonly assigneeType?: IssueActorType | 'none' | undefined
  /** A member or agent id; `me` is the signed-in person. */
  readonly assigneeId?: string | undefined
  /** Project id. */
  readonly project?: string | undefined
  /** Free text over key, title and description. */
  readonly q?: string | undefined
  readonly cursor?: string | undefined
  /** Page size, 1-100; ahel.ai's default is 50. */
  readonly limit?: number | undefined
}

/** One page of issues with the per-status counts of the whole filtered set. */
export interface IssuePage {
  readonly issues: readonly Issue[]
  readonly nextCursor: string | null
  /** Issues per status for the same filters, ignoring `status` and paging. */
  readonly counts: Readonly<Record<string, number>>
  /** Agent runs in `running` or `waiting_approval` state across the workspace. */
  readonly agentsWorking: number
}

/** Fields of a new issue. */
export interface IssueDraft {
  readonly title: string
  readonly description: string
  readonly status: IssueStatus
  readonly priority: IssuePriority
  readonly assigneeType: IssueActorType | null
  readonly assigneeId: string | null
  /** Project id. */
  readonly project: string | null
}

/** Fields one PATCH changes; absent fields stay as they are. */
export interface IssuePatch {
  readonly title?: string | undefined
  readonly description?: string | undefined
  readonly status?: IssueStatus | undefined
  readonly priority?: IssuePriority | undefined
  readonly assigneeType?: IssueActorType | null | undefined
  readonly assigneeId?: string | null | undefined
  /** Project id, or null to clear it. */
  readonly project?: string | null | undefined
  readonly labels?: readonly string[] | undefined
  readonly parentKey?: string | null | undefined
}

/** One comment on an issue; agent comments come from runs and show as "Ahel". */
export interface IssueComment {
  readonly id: string
  readonly authorType: IssueActorType
  readonly authorName: string
  readonly authorAvatar?: string | null | undefined
  /** Markdown. */
  readonly body: string
  readonly createdAt: string
}

/** What one activity line records. */
export type IssueActivityKind =
  | 'created' | 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'project' | 'labels' | 'parent' | 'commented' | 'run'

/** One line of an issue's activity log; `from` and `to` are the old and new values where the kind has them. */
export interface IssueActivity {
  readonly id: string
  readonly kind: IssueActivityKind
  readonly actorType: IssueActorType
  readonly actorName: string
  readonly from: string | null
  readonly to: string | null
  readonly createdAt: string
}

/** Someone an issue can be assigned to. */
export interface IssueAssignee {
  readonly id: string
  readonly name: string
  /** Initials, or a picture URL. */
  readonly avatar: string | null
}

/** The workspace's seats and its agents (v1: the one Ahel agent with its model). */
export interface IssueAssignees {
  readonly members: readonly IssueAssignee[]
  readonly agents: readonly (IssueAssignee & { readonly model: string | null })[]
}

/**
 * One issue row of the unified Inbox (`GET /api/desktop/handoffs` `items`);
 * the Inbox opens the issue detail with the `ahel-issues/open` client event.
 */
export interface IssueInboxItem {
  readonly id: string
  readonly type: 'assigned' | 'mentioned' | 'run_finished' | 'run_failed'
  readonly issueKey: string
  readonly issueTitle: string
  readonly actorType: IssueActorType
  readonly actorName: string
  readonly body: string
  readonly unread: boolean
  readonly createdAt: string
}

/** What one run report sends. */
export interface IssueRunReport {
  readonly sessionId: string
  readonly state: IssueRunState
  readonly steps: number
  readonly totalSteps: number | null
}

/** The issue after a write; null when ahel.ai answered without it. */
export interface IssueWriteAnswer {
  readonly issue: Issue | null
}
