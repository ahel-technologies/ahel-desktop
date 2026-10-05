/** Injected face shared by the account menu and the Models row. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AhelAccountView } from '@deepseek-ai/dsh-ahel-account/types'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from './locales.ts'

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
  hooks: {
    /** The latest account view, or null before the first frame. */
    account: HostObservable<AhelAccountView | null>
  }
}

/** Props of the sidebar footer account entry. */
export type AccountMenuProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>

/** Props of the Settings > Models Ahel row. */
export type ModelsRowProps = PropsRuntime<'settings.models.footer'> & InjectFace<AhelAccountInjected> & PropsLocale<'ahel-account'>
