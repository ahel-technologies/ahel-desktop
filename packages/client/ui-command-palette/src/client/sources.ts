/**
 * The palette's own groups. Each reads what another plugin already shows:
 * the sidebar's main-panel rows, the Session list, the Settings sections,
 * the session's model directory, the theme, the Ahel installs and the
 * sidebar footer's account menu. Nothing here keeps a second copy of that
 * state; a group re-reads it whenever the palette ranks rows.
 */
import type { Context } from '@ahel/cordis'
import type { SessionSummary } from '@ahel/dsh-api-session-controller/client'
import type { CatalogCapability } from '@ahel/dsh-ahel-account/types'
import type { ModelDirectory } from '@ahel/dsh-client-ui-model-selection/client'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import { resolveSlotLabel } from '@ahel/dsh-client-ui-slots'
import type { TranslateNS } from '@ahel/dsh-client-ui-slots'
import type { SessionId } from '@ahel/dsh-session/types'
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-ahel-account/remote'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-model-selection/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '@ahel/dsh-client-ui-theme/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import type { NS } from './locales.ts'
import type { PaletteCommand, PaletteRegistry } from './registry.ts'

/** The palette's translate function. */
type Translate = TranslateNS<typeof NS>

/** Main panel id of ui-ahel-account's Approvals page. */
export const APPROVALS_PANEL = 'ahel-approvals'

/** Main panel id of ui-ahel-account's Inbox page. */
export const INBOX_PANEL = 'ahel-inbox'

/**
 * Shortcut command id of one sidebar chat position.
 * @param n - 1-based position.
 * @returns the command id.
 */
export function chatShortcutId(n: number): string {
  return `palette.chat.${String(n)}`
}

/** Shortcut command ids of panels the palette binds keys to. */
const PANEL_SHORTCUTS: Readonly<Record<string, string>> = {
  [APPROVALS_PANEL]: 'palette.approvals',
  [INBOX_PANEL]: 'palette.inbox',
}

/** Chats the palette lists while the query is empty. */
const CHAT_LIMIT = 8

/** The Ahel installs are read again at most this often. */
const INSTALLS_REFRESH_MS = 10_000

/**
 * The Sessions a person sees in the sidebar: top-level, not blank.
 * @param ctx - context with `sessions`.
 * @returns the summaries, newest first.
 */
function chatSummaries(ctx: Context): SessionSummary[] {
  const list = ctx.sessions.list.getSnapshot()
  return list.ids.flatMap((id) => {
    const row = list.byId[id]
    return row === undefined || row.blank || row.parentId !== undefined || row.origin === 'subagent' ? [] : [row]
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * The sidebar's chat rows in on-screen order, read from the rendered rows;
 * when the sidebar shows none (collapsed or not yet mounted) the newest-first list stands in.
 * @param ctx - context with `sessions`.
 * @returns Session ids in sidebar order.
 */
export function sidebarChatOrder(ctx: Context): SessionId[] {
  const known = new Set<string>(chatSummaries(ctx).map(row => row.id))
  const rendered = [...document.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')]
    .map(node => (node.dataset.rowKey ?? '').slice('session:'.length))
    .filter(id => known.has(id))
  if (rendered.length > 0) return [...new Set(rendered)] as SessionId[]
  return chatSummaries(ctx).map(row => row.id)
}

/** The Session the main view shows, if any. */
function currentSessionId(ctx: Context): SessionId | undefined {
  return Object.values(ctx.sessions.list.getSnapshot().byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
}

/**
 * Relative age of a chat for its row.
 * @param t - palette translate.
 * @param at - last update, epoch ms.
 * @returns the label.
 */
function age(t: Translate, at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return t('justNow')
  if (minutes < 60) return t('minutesAgo', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('hoursAgo', { n: String(hours) })
  return t('daysAgo', { n: String(Math.floor(hours / 24)) })
}

/**
 * Register the New chat, panel, chat, settings and model groups.
 * @param ctx - context with `slots`, `sessions`, `uiWorkspace`, `layout` and `theme`.
 * @param registry - the palette registry.
 * @param t - palette translate.
 */
export function registerCoreSources(ctx: Context, registry: PaletteRegistry, t: Translate): void {
  const invalidate = (): void => { registry.invalidate() }

  ctx.effect(() => registry.register({
    id: 'actions', label: () => t('groupActions'), order: 0,
    items: () => [{
      id: 'action:new-chat', title: t('newChat'), keywords: ['new session', 'start', 'compose'], shortcut: 'session.new',
      run: () => { ctx.uiWorkspace.startSession() },
    }],
  }), 'ui-command-palette: actions')

  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', invalidate), 'ui-command-palette: panels follow the sidebar')
  ctx.effect(() => registry.register({
    id: 'panels', label: () => t('groupGoTo'), order: 10,
    items: () => ctx.slots.entries('sidebar.panellist').flatMap((entry): PaletteCommand[] => {
      const id = entry.options.id
      const title = resolveSlotLabel(entry.options.label)
      if (id === undefined || title === undefined) return []
      const shortcut = PANEL_SHORTCUTS[id]
      return [{
        id: `panel:${id}`, title, keywords: [id.replace(/^ahel-/, '')],
        ...(shortcut === undefined ? {} : { shortcut }),
        active: ctx.layout.panelInfo.getSnapshot().activePanelId === id,
        run: () => { ctx.layout.selectPanel(id as MainPanelId) },
      }]
    }),
  }), 'ui-command-palette: panels')

  ctx.effect(() => ctx.sessions.list.subscribe(invalidate), 'ui-command-palette: chats follow the list')
  ctx.effect(() => registry.register({
    id: 'chats', label: () => t('groupChats'), order: 20, limit: CHAT_LIMIT,
    items: () => {
      const order = sidebarChatOrder(ctx)
      const current = currentSessionId(ctx)
      return chatSummaries(ctx).map((row) => {
        const position = order.indexOf(row.id)
        return {
          id: `chat:${row.id}`,
          title: row.title?.trim() || t('untitledChat'),
          subtitle: age(t, row.updatedAt),
          recency: row.updatedAt,
          active: row.id === current,
          ...(position >= 0 && position < 9 ? { shortcut: chatShortcutId(position + 1) } : {}),
          run: () => { ctx.uiWorkspace.openSession(row.id) },
        }
      })
    },
  }), 'ui-command-palette: chats')

  ctx.effect(() => ctx.slots.subscribe('settings.section', invalidate), 'ui-command-palette: settings follow their sections')
  ctx.effect(() => registry.register({
    id: 'settings', label: () => t('groupSettings'), order: 50,
    items: () => {
      const preference = ctx.theme.getTheme().preference
      const sections = ctx.slots.entries('settings.section').flatMap((entry): PaletteCommand[] => {
        const id = entry.options.id
        const name = resolveSlotLabel(entry.options.label)
        if (id === undefined || name === undefined) return []
        return [{
          id: `settings:${id}`, title: t('settingsPage', { name }), keywords: ['preferences', id],
          ...(entry === ctx.slots.entries('settings.section')[0] ? { shortcut: 'settings.open' } : {}),
          run: () => { ctx.emit('settings/open-section', id) },
        }]
      })
      const themes = (['light', 'dark', 'system'] as const).map((mode): PaletteCommand => ({
        id: `theme:${mode}`,
        title: t(mode === 'light' ? 'themeLight' : mode === 'dark' ? 'themeDark' : 'themeSystem'),
        keywords: ['appearance', 'color', mode === 'system' ? 'auto' : mode],
        active: preference === mode,
        run: () => { ctx.theme.setTheme(mode) },
      }))
      return [...sections, ...themes]
    },
  }), 'ui-command-palette: settings')

  registerModelSource(ctx, registry, t)
}

/**
 * The current Session's models, read from ui-model-selection's directory when that plugin is loaded.
 * @param ctx - context with `sessions`.
 * @param registry - the palette registry.
 * @param t - palette translate.
 */
function registerModelSource(ctx: Context, registry: PaletteRegistry, t: Translate): void {
  let watched: { directory: ModelDirectory; off: () => void } | undefined
  const directory = (): ModelDirectory | undefined => {
    const sessionId = currentSessionId(ctx)
    const resolver = ctx.get('modelDirectories')
    if (sessionId === undefined || resolver === undefined || ctx.sessions.subagentAddress(sessionId) !== undefined) return undefined
    try {
      return resolver.directoryFor(sessionId)
    } catch (_unscoped) {
      // The Session's scope is not resolved yet; the group stays empty until the next opening.
      return undefined
    }
  }
  ctx.effect(() => () => { watched?.off() }, 'ui-command-palette: model directory watch')
  ctx.effect(() => registry.register({
    id: 'models', label: () => t('groupModels'), order: 40, limit: 3,
    open: () => {
      const next = directory()
      if (next === undefined) return
      if (watched?.directory !== next) {
        watched?.off()
        watched = { directory: next, off: next.store.subscribe(() => { registry.invalidate() }) }
      }
      void next.load().catch(() => undefined)
    },
    items: () => {
      const target = directory()
      if (target === undefined) return []
      const state = target.store.getSnapshot()
      const resolver = ctx.get('modelDirectories')
      /* v8 ignore next -- directory() resolved through the same service. */
      if (resolver === undefined) return []
      // One row per model, on the route a pick in the composer takes: the one in use, else the metered one.
      return resolver.groupsFor(state).flatMap(group => group.rows.flatMap((row): PaletteCommand[] => {
        const inUse = [row.metered, row.own]
          .find(r => r !== undefined && r.provider === state.current?.provider && r.model === state.current.model)
        const route = inUse ?? row.metered ?? row.own
        /* v8 ignore next -- a row always has a route. */
        if (route === undefined) return []
        const active = state.current?.provider === route.provider && state.current.model === route.model
        const effort = active ? state.current?.reasoningEffort ?? route.reasoning?.defaultEffort : route.reasoning?.defaultEffort
        return [{
          id: `model:${route.provider}/${route.model}`,
          title: t('model', { name: row.shortName }),
          subtitle: group.maker,
          keywords: ['switch model', group.maker, route.model],
          recency: active ? 1 : 0,
          active,
          run: async () => {
            const choice = { provider: route.provider, model: route.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
            const result = await target.select(choice)
            if (!result.ok) throw result.error
          },
        }]
      }))
    },
  }), 'ui-command-palette: models')
}

/**
 * Register the installed Ahel apps once the `ahelCatalog` Remote is mounted.
 * @param ctx - context with `remote.ahelCatalog` and `uiWorkspace`.
 * @param registry - the palette registry.
 * @param t - palette translate.
 */
export function registerAppSource(ctx: Context, registry: PaletteRegistry, t: Translate): void {
  let rows: readonly CatalogCapability[] = []
  let lastRead = 0
  const refresh = async (): Promise<void> => {
    lastRead = Date.now()
    const result = await ctx.remote.ahelCatalog.installed()
    rows = result.ok ? result.value.rows : []
    registry.invalidate()
  }
  ctx.effect(() => registry.register({
    id: 'apps', label: () => t('groupApps'), order: 30, limit: 6,
    open: () => {
      if (Date.now() - lastRead >= INSTALLS_REFRESH_MS) void refresh().catch(() => undefined)
    },
    items: () => rows.filter(row => row.state === 'on').map(row => ({
      id: `app:${row.key}`,
      title: t('useApp', { name: row.name }),
      keywords: [row.name, row.key],
      run: () => { ctx.uiWorkspace.startSession(undefined, { prompt: t('useAppPrompt', { name: row.name }), clearPreviousDraft: true }) },
    })),
  }), 'ui-command-palette: apps')
}

/** The sidebar footer's account entry, read structurally from its slot registration. */
interface AccountEntry {
  /** Unknown until the account stream's first frame lands. */
  status: 'signed-in' | 'signed-out' | undefined
  signIn: () => unknown
  signOut: () => unknown
}

/**
 * Read ui-ahel-account's account face from its `sidebar.footer.action` entry,
 * so Sign in and Sign out run that package's own flows (desktop hand-off,
 * hosted chat) instead of a second copy of them.
 * @param ctx - context with `slots`.
 * @returns the entry, or undefined when that package is not loaded.
 */
function accountEntry(ctx: Context): AccountEntry | undefined {
  const face = ctx.slots.entries('sidebar.footer.action').find(entry => entry.options.id === 'ahel-account')?.inject?.()
  if (face === undefined) return undefined
  const { signIn, signOut, hooks } = face
  if (typeof signIn !== 'function' || typeof signOut !== 'function' || typeof hooks !== 'object' || hooks === null || !('account' in hooks)) {
    return undefined
  }
  const account = hooks.account
  const view = typeof account === 'object' && account !== null && 'getSnapshot' in account && typeof account.getSnapshot === 'function'
    ? (account.getSnapshot as () => unknown)()
    : undefined
  const raw = typeof view === 'object' && view !== null && 'status' in view ? view.status : undefined
  const status = raw === 'signed-in' || raw === 'signed-out' ? raw : undefined
  return { status, signIn: () => (signIn as () => unknown).call(face), signOut: () => (signOut as () => unknown).call(face) }
}

/**
 * Register the Account group: Sign in while signed out, Sign out while an Ahel account is signed in.
 * @param ctx - context with `slots`.
 * @param registry - the palette registry.
 * @param t - palette translate.
 */
export function registerAccountSource(ctx: Context, registry: PaletteRegistry, t: Translate): void {
  ctx.effect(() => registry.register({
    id: 'account', label: () => t('groupAccount'), order: 60,
    items: () => {
      const entry = accountEntry(ctx)
      if (entry?.status === undefined) return []
      return entry.status === 'signed-in'
        ? [{ id: 'account:sign-out', title: t('signOut'), keywords: ['log out', 'logout'], run: () => entry.signOut() as void | Promise<void> }]
        : [{ id: 'account:sign-in', title: t('signIn'), keywords: ['log in', 'login', 'account'], run: () => entry.signIn() as void | Promise<void> }]
    },
  }), 'ui-command-palette: account')
}
