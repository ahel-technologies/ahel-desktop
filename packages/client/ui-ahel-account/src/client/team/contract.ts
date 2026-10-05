/** The team summary poll shared by the account menu and the team panels. */
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { DesktopSummary } from '@ahel/dsh-ahel-account/types'

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
