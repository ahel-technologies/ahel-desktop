/** Injected face shared by the account menu and the Models row. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '@ahel/dsh-client-ui-settings-models/client'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import type { CatalogPanelId } from './catalog/contract.ts'

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
  hooks: {
    /** The latest account view, or null before the first frame. */
    account: HostObservable<AhelAccountView | null>
  }
}

/** Props of the sidebar footer account entry. */
export type AccountMenuProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the starter prompts below the blank-session composer. */
export type StarterPromptsProps = PropsRuntime<'conversation.hero.dock'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the in-place row for an Ahel model refusal; `matched` is the claimed failure code. */
export type AhelTurnErrorProps = PropsRuntime<'conversation.chat.turnError'> & { matched: AhelFailureCode }
  & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the claimed frame-wide notice for an Ahel balance refusal. */
export type AhelQuotaNoticeProps = PropsRuntime<'shell.quota-notice'>

/** Failure codes `dsh-llm-ahel` gives the proxy's 402, 403 and 401 refusals. */
export type AhelFailureCode = 'ACCOUNT_QUOTA' | 'AHEL_NOT_ENABLED' | 'AHEL_SESSION_ENDED'

/** Props of the Settings > Models Ahel row. */
export type ModelsRowProps = PropsRuntime<'settings.models.footer'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>
