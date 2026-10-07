/** Injected face shared by the account menu and the Models row. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '@ahel/dsh-client-ui-settings-models/client'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import type { CatalogPanelId } from './catalog/contract.ts'
import type { TeamSummaryState } from './team/contract.ts'

/** Account operations and the live view; tokens never reach the browser. */
export interface AhelAccountInjected {
  /** Start the ahel.ai sign-in and open the consent page. */
  signIn(): Promise<void>
  /** Revoke and remove the sign-in. */
  signOut(): Promise<void>
  /** Choose the workspace the Ahel MCP server and models act in. @param id - workspace id, or null for the account default. */
  selectWorkspace(id: string | null): Promise<void>
  /** Open a URL outside the app. @param url - absolute https URL. */
  openLink(url: string): void
  /** Open Settings on the Models section, where own keys are added. */
  openModels(): void
  /** Select one of this package's in-app panels. @param id - Discover or Your apps. */
  openPanel(id: CatalogPanelId): void
  /** Open the workspace's ahel.ai billing page in the browser; does nothing until the summary shows credits. */
  openBilling(): void
  hooks: {
    /** The latest account view, or null before the first frame. */
    account: HostObservable<AhelAccountView | null>
    /** The shared team summary poll: balance, approvals and unread handoffs. */
    summary: HostObservable<TeamSummaryState>
  }
}

/**
 * The `ahelAccountUi` client service: the live account view, the shared team
 * summary poll and the account actions, for a shell that composes its own
 * account surfaces, for example the hosted chat's navigation rail.
 */
export interface AhelAccountUi {
  /** The latest account view, or null before the first frame. */
  readonly account: HostObservable<AhelAccountView | null>
  /** The shared team summary poll: workspace, balance, approvals, unread handoffs and installed apps. */
  readonly summary: HostObservable<TeamSummaryState>
  /**
   * Choose the workspace the Ahel MCP server and models act in; the view and the summary follow at once.
   * @param id - workspace id, or null for the account default.
   */
  selectWorkspace(id: string | null): Promise<void>
  /** Sign out the way the account menu does; a hosted chat hands it to ahel.ai. */
  signOut(): Promise<void>
  /** Re-read the team summary now. */
  refreshSummary(): void
  /** Open the workspace's ahel.ai billing page, as the account menu's Top up does; does nothing until the summary shows credits. */
  openBilling(): void
}

/** Props of the sidebar footer account entry. */
export type AccountMenuProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the starter prompts below the blank-session composer. */
export type StarterPromptsProps = PropsRuntime<'conversation.hero.dock'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the blank-session greeting that names the signed-in person. */
export type HeroGreetingProps = PropsRuntime<'conversation.hero.greeting'> & InjectFace<AhelAccountInjected>

/** Props of the in-place row for an Ahel model refusal; `matched` is the claimed failure code. */
export type AhelTurnErrorProps = PropsRuntime<'conversation.chat.turnError'> & { matched: AhelFailureCode }
  & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the claimed frame-wide notice for an Ahel balance refusal. */
export type AhelQuotaNoticeProps = PropsRuntime<'shell.quota-notice'>

/** Failure codes `dsh-llm-ahel` gives the proxy's 402, 403 and 401 refusals. */
export type AhelFailureCode = 'ACCOUNT_QUOTA' | 'AHEL_NOT_ENABLED' | 'AHEL_SESSION_ENDED'

/** Props of the Settings > Models Ahel row. */
export type ModelsRowProps = PropsRuntime<'settings.models.footer'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>
