/**
 * Catalog panel assembly: one shared `installed` observable read from the
 * Host's `ahelCatalog` namespace, the face the catalog panels receive, the
 * `ahel-discover`, `ahel-knowledge` and `ahel-apps` main panels, and their sidebar rows.
 */
import type { Context } from '@ahel/cordis'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { CatalogInstalled } from '@ahel/dsh-ahel-account/types'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
// Type-only: the `ahel-catalog/*` Remote failure codes.
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type { AhelAccountInjected } from '../contract.ts'
import { NS } from '../locales.ts'
import type { DiscoverInjected } from './contract.ts'
import { DiscoverPage } from './DiscoverPage.tsx'
import { KnowledgePage } from './KnowledgePage.tsx'
import { AppsPanelIcon, DiscoverPanelIcon, KnowledgePanelIcon } from './PanelIcons.tsx'
import { YourAppsPage } from './YourAppsPage.tsx'

/** Main panel and sidebar row id of the Discover page. */
const DISCOVER_ID = 'ahel-discover' as MainPanelId

/** Main panel and sidebar row id of the Knowledge page. */
const KNOWLEDGE_ID = 'ahel-knowledge' as MainPanelId

/** Main panel and sidebar row id of the Your apps page. */
const APPS_ID = 'ahel-apps' as MainPanelId

/** Window focus re-reads at most this often. */
const FOCUS_REFRESH_MS = 5_000

/**
 * Register the Discover, Knowledge and Your apps panels and the shared installs read.
 * @param ctx - Client context with `remote.ahelCatalog`, `slots`, `locale` and `layout`.
 * @param account - the account face built by the package's `register`.
 * @returns the catalog face, for the panels registered later.
 */
export function registerCatalog(ctx: Context, account: AhelAccountInjected): DiscoverInjected {
  const t = ctx.locale.bind(NS)
  let value: CatalogInstalled | null = null
  const listeners = new Set<() => void>()
  const installed: HostObservable<CatalogInstalled | null> = {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: CatalogInstalled): void => {
    value = next
    for (const listener of listeners) listener()
  }

  // Only the newest read publishes, so a slow answer never overwrites a newer one.
  let generation = 0
  let lastRead = 0
  const refreshInstalled = async (): Promise<void> => {
    const mine = ++generation
    lastRead = Date.now()
    if (account.hooks.account.getSnapshot()?.status === 'signed-out') {
      publish({ signedIn: false, rows: [] })
      return
    }
    const result = await ctx.remote.ahelCatalog.installed()
    if (mine !== generation) return
    if (result.ok) publish(result.value)
    else if (result.error.code === 'ahel-catalog/signed-out') publish({ signedIn: false, rows: [] })
    // Any other failure keeps the last answer; the next trigger reads again.
  }
  const refresh = (): void => { void refreshInstalled().catch(() => undefined) }

  refresh()
  ctx.effect(() => {
    let previous = account.hooks.account.getSnapshot()
    return account.hooks.account.subscribe(() => {
      const next = account.hooks.account.getSnapshot()
      const moved = next?.status !== previous?.status || next?.workspace !== previous?.workspace
      previous = next
      if (moved) refresh()
    })
  }, 'ui-ahel-account: installs follow the account')
  ctx.effect(() => {
    const onFocus = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead >= FOCUS_REFRESH_MS) refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, 'ui-ahel-account: installs on window focus')
  ctx.effect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead >= FOCUS_REFRESH_MS) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => { document.removeEventListener('visibilitychange', onVisible) }
  }, 'ui-ahel-account: installs on visibility')
  ctx.effect(() => {
    let previous = ctx.layout.panelInfo.getSnapshot().activePanelId
    return ctx.layout.panelInfo.subscribe(() => {
      const next = ctx.layout.panelInfo.getSnapshot().activePanelId
      if ((next === APPS_ID || next === KNOWLEDGE_ID) && previous !== next) refresh()
      previous = next
    })
  }, 'ui-ahel-account: installs when Your apps or Knowledge opens')

  const face: DiscoverInjected = {
    browse: async (query) => {
      const result = await ctx.remote.ahelCatalog.browse(query)
      if (!result.ok) throw result.error
      return result.value
    },
    browsePart: async (query, groupKey, offset) => {
      const result = await ctx.remote.ahelCatalog.browsePart(query, groupKey, offset)
      if (!result.ok) throw result.error
      return result.value
    },
    knowledge: async (q) => {
      const result = await ctx.remote.ahelCatalog.knowledge(q)
      if (!result.ok) throw result.error
      return result.value
    },
    install: async (id) => {
      const result = await ctx.remote.ahelCatalog.add(id)
      refresh()
      if (!result.ok) throw result.error
      return result.value
    },
    setEnabled: async (key, on) => {
      const result = await ctx.remote.ahelCatalog.setEnabled(key, on)
      refresh()
      if (!result.ok) throw result.error
      return result.value
    },
    refreshInstalled,
    signIn: () => account.signIn(),
    openLink: (url) => { account.openLink(url) },
    openPanel: (id) => { ctx.layout.selectPanel(id as MainPanelId) },
    hooks: { account: account.hooks.account, installed },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: DISCOVER_ID, locale: NS, inject: () => face,
  }, DiscoverPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: DISCOVER_ID, order: -20, locale: NS, label: () => t('discover'),
  }, DiscoverPanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: KNOWLEDGE_ID, locale: NS, inject: () => face,
  }, KnowledgePage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: KNOWLEDGE_ID, order: -15, locale: NS, label: () => t('knowledgeTitle'),
  }, KnowledgePanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: APPS_ID, locale: NS, inject: () => face,
  }, YourAppsPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: APPS_ID, order: -10, locale: NS, label: () => t('appsTitle'),
  }, AppsPanelIcon))
  return face
}
