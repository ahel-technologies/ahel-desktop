/** The team summary poll shared by the account menu and the team panels, and the Approvals panel face. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView, DesktopSummary } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
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
