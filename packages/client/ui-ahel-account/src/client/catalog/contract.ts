/** Injected face shared by the Discover and Your apps panels. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {
  AhelAccountView, CatalogBrowsePage, CatalogBrowseQuery, CatalogInstalled, CatalogInstallResult, CatalogPart, CatalogRow,
  CatalogSwitchResult, KeyConnectAnswer, KeyConnectSaved, VaultDisconnected, VaultSignInList,
} from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '../locales.ts'

/** Main panels this package registers. */
export type CatalogPanelId = 'ahel-discover' | 'ahel-apps'

/**
 * Catalog reads and the person's own writes. Every method rejects with the
 * Host's Remote failure, whose `code` is one of the `ahel-catalog/*` codes and
 * whose `message` is ahel.ai's own sentence for `ahel-catalog/refused`.
 */
export interface DiscoverInjected {
  /** One page of the public Discover listing; works signed out. */
  browse(query: CatalogBrowseQuery): Promise<CatalogBrowsePage>
  /** A further slice of one group's nested skills. */
  browsePart(query: CatalogBrowseQuery, groupKey: string, offset: number): Promise<CatalogPart>
  /**
   * Install one catalog item, then re-read `installed`.
   * @param id - `CatalogRow.id`.
   */
  install(id: string): Promise<CatalogInstallResult>
  /** Turn one installed capability on or off, then re-read `installed`. */
  setEnabled(key: string, on: boolean): Promise<CatalogSwitchResult>
  /** Re-read what the signed-in person has installed. */
  refreshInstalled(): Promise<void>
  /**
   * One app's Connect state from the workspace vault. Rejects with an `ahel-team/*` failure;
   * `ahel-team/outdated` means ahel.ai has no desktop vault route yet.
   * @param app - a catalog item id, stack key or `app:<service>`.
   */
  connectPanel(app: string): Promise<KeyConnectAnswer>
  /**
   * Seal a key app's values in the vault, install and switch it on, then re-read `installed`.
   * The values go to the Host only and are never kept.
   * @param app - `KeyConnectView.app`.
   * @param values - field id to typed value.
   */
  connect(app: string, values: Record<string, string>): Promise<KeyConnectSaved>
  /**
   * Forget an app's sign-in or saved key, then re-read `installed`. Rejects with `ahel-team/refused`
   * carrying `webUrl` when the app has several accounts.
   * @param app - the name `connectPanel` takes.
   */
  disconnect(app: string): Promise<VaultDisconnected>
  /** The workspace's sign-ins and whether this seat may connect and disconnect. */
  signIns(): Promise<VaultSignInList>
  /** Start the ahel.ai sign-in. */
  signIn(): Promise<void>
  /** Open an absolute https URL outside the app. */
  openLink(url: string): void
  /** Select one of this package's main panels. */
  openPanel(id: CatalogPanelId): void
  hooks: {
    /** The latest account view, or null before the first frame. */
    account: HostObservable<AhelAccountView | null>
    /** The person's installs, or null before the first read. */
    installed: HostObservable<CatalogInstalled | null>
  }
}

/** Props of the Discover main panel. */
export type DiscoverPageProps = PropsRuntime<'main'> & InjectFace<DiscoverInjected> & PropsLocale<'ahel-account'>

/** Props of a component rendered inside a catalog panel: the composed face plus the typed `t` seat. */
export type CatalogFaceProps = InjectFace<DiscoverInjected> & PropsLocale<'ahel-account'>

/** What opening a row does; the default opens its ahel.ai page. */
export type OpenRow = (row: CatalogRow) => void
