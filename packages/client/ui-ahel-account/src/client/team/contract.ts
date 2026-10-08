/** The team summary poll shared by the account menu and the team panels, and the Approvals and Inbox panel faces. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView, DesktopSummary, HandoffList, HandoffReceivedRow, IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '../locales.ts'

/** What the latest `ahelTeam.summary()` read left. */
export interface TeamSummaryState {
  /** The latest summary for the selected workspace; null signed out, before the first read, or on an outdated ahel.ai. */
  readonly summary: DesktopSummary | null
  /** ahel.ai has no `/api/desktop` routes yet; the UI says "Update ahel.ai". */
  readonly outdated: boolean
  /** The last failed read's message; the previous summary stays. */
  readonly error: string | null
}

/** The shared poll and its manual trigger. */
export interface TeamSummary {
  readonly state: HostObservable<TeamSummaryState>
  /** Read now, for example after a team write. */
  refresh(): void
  /**
   * Show the Inbox read's unread count as the summary's `inbox.unread`, so every badge equals the list until the next poll.
   * @param unread - the unread rows of the Inbox list.
   */
  adoptInbox(unread: number): void
}

/** What answering one held call left: ahel.ai's stored status, or why it refused. */
export type ApprovalAnswer =
  | { readonly ok: true; readonly status: 'approved' | 'declined' }
  /**
   * `message` is ahel.ai's own sentence when it gave one, else null. `outdated` means ahel.ai has no desktop route yet.
   * `final` means ahel.ai refused this call for good (gone, expired, answered, or the person's own); otherwise a retry may work.
   */
  | { readonly ok: false; readonly outdated: boolean; readonly final: boolean; readonly message: string | null }

/** Face of the Approvals panel and its sidebar row. */
export interface ApprovalsInjected {
  /**
   * Answer one held call, then re-read the summary.
   * @param id - `ApprovalRow.id`.
   * @param decision - approve opens a one-hour window for the requester to repeat the exact call.
   * @param note - optional note for the requester; ahel.ai keeps 500 characters.
   */
  decide(id: string, decision: 'approved' | 'declined', note: string): Promise<ApprovalAnswer>
  /** Re-read the summary now. */
  refresh(): void
  /** Start the ahel.ai sign-in. */
  signIn(): Promise<void>
  /** Open ahel.ai's organization settings at the approvals section, in the browser. */
  openWebApprovals(): void
  hooks: {
    account: HostObservable<AhelAccountView | null>
    summary: HostObservable<TeamSummaryState>
  }
}

/** Props of the Approvals main panel. */
export type ApprovalsPageProps = PropsRuntime<'main'> & InjectFace<ApprovalsInjected> & PropsLocale<'ahel-account'>

/** Props of the Approvals sidebar glyph with its pending-count badge. */
export type ApprovalsPanelIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<ApprovalsInjected>

/** What one Inbox read left. */
export type InboxLoad =
  | { readonly ok: true; readonly list: HandoffList }
  /**
   * `refused` carries ahel.ai's own sentence, for example a plan without handoffs;
   * `failed` is a transport failure worth a retry; `message` is null without a sentence.
   */
  | { readonly ok: false; readonly reason: 'outdated' | 'signed-out' | 'refused' | 'failed'; readonly message: string | null }

/** What opening or finishing one handoff left. */
export type InboxAnswer =
  | { readonly ok: true }
  | { readonly ok: false; readonly outdated: boolean; readonly message: string | null }

/** Face of the Inbox panel and its sidebar row. */
export interface InboxInjected {
  /** Read received and sent handoffs and issue rows for the selected workspace; the summary's inbox count takes the read's unread rows. */
  load(): Promise<InboxLoad>
  /**
   * Read one handoff (which marks it read) and start a new session whose composer
   * holds the handoff text; nothing is sent.
   * @param row - the received handoff.
   */
  open(row: HandoffReceivedRow): Promise<InboxAnswer>
  /**
   * Show an issue row's issue in the desktop's Issues panel and mark the row read.
   * @param item - the issue row.
   */
  openIssue(item: IssueInboxItem): Promise<InboxAnswer>
  /**
   * Mark one received handoff done.
   * @param id - `HandoffReceivedRow.id`.
   */
  markDone(id: string): Promise<InboxAnswer>
  /** Open one handoff's ahel.ai page in the browser; ignores anything that is not a web page. */
  openUrl(url: string): void
  /** Open ahel.ai's handoffs page in the browser. */
  openWebInbox(): void
  /** Start the ahel.ai sign-in. */
  signIn(): Promise<void>
  hooks: {
    account: HostObservable<AhelAccountView | null>
    summary: HostObservable<TeamSummaryState>
  }
}

/** Props of the Inbox main panel. */
export type InboxPageProps = PropsRuntime<'main'> & InjectFace<InboxInjected> & PropsLocale<'ahel-account'>

/** Props of the Inbox sidebar glyph with its unread badge. */
export type InboxPanelIconProps = PropsRuntime<'sidebar.panellist'> & InjectFace<InboxInjected>

/** Where a team-at-a-glance tile leads. */
export type TeamGlanceTarget = 'approvals' | 'inbox' | 'apps'

/** Face of the sidebar team header and the welcome screen's team strip. */
export interface TeamGlanceInjected {
  /**
   * Select one of this package's panels.
   * @param target - the tile's panel.
   */
  openPanel(target: TeamGlanceTarget): void
  /** Open the workspace's team settings on ahel.ai in the browser. */
  openMembers(): void
  hooks: {
    account: HostObservable<AhelAccountView | null>
    summary: HostObservable<TeamSummaryState>
  }
}

/** Props of the team header at the top of the sidebar. */
export type TeamHeaderProps = PropsRuntime<'sidebar.header'> & InjectFace<TeamGlanceInjected> & PropsLocale<'ahel-account'>

/** Props of the team strip under the blank-session greeting. */
export type TeamStripProps = PropsRuntime<'conversation.hero.subhead'> & InjectFace<TeamGlanceInjected> & PropsLocale<'ahel-account'>
