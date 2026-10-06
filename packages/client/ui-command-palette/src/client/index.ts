/**
 * Command palette, browser half: provides `ctx.commandPalette` (the registry
 * other packages add groups to), fills it with chats, main panels, installed
 * Ahel apps, models, Settings pages, theme and Sign in or out, mounts the
 * dialog in `shell.overlay`, and registers the palette, sidebar-chat
 * (Desktop) and Approvals/Inbox commands through `ctx.shortcuts` so they
 * show and rebind in the shortcut reference.
 */
import type { Context } from '@ahel/cordis'
import type { ShortcutBinding, ShortcutCommand, ShortcutCommandId, ShortcutContext } from '@ahel/dsh-client-shortcuts/client'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-api-session-controller/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import { CommandPalette as PaletteOverlay } from './Palette.tsx'
import type { PaletteInjected } from './Palette.tsx'
import { PaletteRegistry, recentStore } from './registry.ts'
import type { CommandPalette } from './registry.ts'
import {
  APPROVALS_PANEL, INBOX_PANEL, chatShortcutId, registerAccountSource, registerAppSource, registerCoreSources, sidebarChatOrder,
} from './sources.ts'
import { en, NS, zh } from './locales.ts'

export type { CommandPalette, PaletteCommand, PaletteRow, PaletteSection, PaletteSource, PaletteState } from './registry.ts'
export { fuzzyMatch, rankSections } from './registry.ts'
export type { PaletteInjected, PaletteProps } from './Palette.tsx'
export type { CommandPaletteKey } from './locales.ts'

declare module '@ahel/cordis' {
  interface Context {
    /** Command palette registry: `register` a group of rows, `open` or `toggle` the dialog. */
    commandPalette: CommandPalette
  }
}

/** Origin-local storage key of the recently run rows. */
const RECENT_KEY = 'dsh.command-palette.recent.v1'

/** Required services. */
export const inject = ['slots', 'locale', 'layout', 'shortcuts', 'sessions', 'uiWorkspace', 'theme']

/** What a command's resolver returns. */
type ShortcutResolution = ReturnType<ShortcutCommand['resolve']>

/** Modifier lists accepted by `ShortcutBinding`. */
type Modifiers = ShortcutBinding['modifiers']

/** Default bindings by shortcut profile. */
type Defaults = Partial<Record<'desktop:macos' | 'desktop:windows' | 'desktop:linux' | 'web:macos' | 'web:windows', ShortcutBinding>>

/**
 * Per-profile defaults: one binding for every Desktop platform and, when given, one for macOS and Windows Web.
 * Linux Web stays unbound, as browsers there keep most combinations.
 * @param code - physical key.
 * @param desktop - Desktop modifiers.
 * @param web - Web modifiers; absent leaves Web unbound.
 * @returns the defaults map.
 */
function defaults(code: string, desktop: Modifiers, web?: Modifiers): Defaults {
  const desktopOnly: Defaults = {
    'desktop:macos': { code, modifiers: desktop },
    'desktop:windows': { code, modifiers: desktop },
    'desktop:linux': { code, modifiers: desktop },
  }
  return web === undefined ? desktopOnly : { ...desktopOnly, 'web:macos': { code, modifiers: web }, 'web:windows': { code, modifiers: web } }
}

/**
 * Register the dictionaries, the registry service, its groups, the overlay and the keys.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-command-palette: dictionaries')
  const t = ctx.locale.bind(NS)
  const registry = new PaletteRegistry(recentStore(() => window.localStorage, RECENT_KEY))

  ctx.effect(() => {
    const dispose = ctx.reflect.provide('commandPalette', registry)
    // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
    return () => { void dispose() }
  }, 'ui-command-palette: service')
  // The palette closes when its plugin unloads, so no dialog outlives its registry.
  ctx.effect(() => () => { registry.close() }, 'ui-command-palette: close on unload')

  registerCoreSources(ctx, registry, t)
  registerAccountSource(ctx, registry, t)
  ctx.inject(['remote.ahelCatalog'], (inner) => { registerAppSource(inner, registry, t) })

  const injected: PaletteInjected = {
    sections: query => registry.sections(query, t('groupRecent')),
    run: (command) => { registry.run(command) },
    close: () => { registry.close() },
    hooks: { palette: registry.state, shortcuts: ctx.shortcuts.catalog },
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'command-palette', locale: NS, inject: () => injected,
  }, PaletteOverlay))

  const register = (id: string, label: () => string, aliases: string[], bindings: Defaults,
    resolve: (context: ShortcutContext) => ShortcutResolution): void => {
    ctx.effect(() => ctx.shortcuts.register({
      id: id as ShortcutCommandId, label, aliases, defaults: bindings,
      regions: ['page', 'editable'], modals: ['command-palette'], resolve,
    }), `ui-command-palette: ${id}`)
  }
  const blockedByOtherModal = (context: ShortcutContext): boolean => context.modal !== null && context.modal !== 'command-palette'

  register('palette.open', () => t('shortcutOpen'), ['command palette', 'quick open', 'search everything'],
    defaults('KeyK', ['primary'], ['primary', 'alt']),
    context => blockedByOtherModal(context) ? { status: 'blocked', reason: 'modal' } : { status: 'handled', run: () => { registry.toggle() } })

  // Desktop only: in a browser tab Primary+digit switches tabs.
  for (let n = 1; n <= 9; n++) {
    register(chatShortcutId(n), () => t('shortcutChat', { n: String(n) }), [`chat ${String(n)}`],
      defaults(`Digit${String(n)}`, ['primary']), (context) => {
        if (blockedByOtherModal(context)) return { status: 'blocked', reason: 'modal' }
        const target = sidebarChatOrder(ctx)[n - 1]
        if (target === undefined) return { status: 'blocked', reason: t('noChatAt', { n: String(n) }) }
        return { status: 'handled', run: () => { registry.close(); ctx.uiWorkspace.openSession(target) } }
      })
  }

  // Unbound by default; people bind them in the shortcut reference.
  const panelCommand = (id: string, panel: string, label: () => string, aliases: string[]): void => {
    register(id, label, aliases, {}, (context) => {
      if (blockedByOtherModal(context)) return { status: 'blocked', reason: 'modal' }
      // The sidebar row, not the main panel, follows the account's role.
      if (!ctx.slots.entries('sidebar.panellist').some(entry => entry.options.id === panel)) {
        return { status: 'blocked', reason: t('panelUnavailable') }
      }
      return { status: 'handled', run: () => { registry.close(); ctx.layout.selectPanel(panel as MainPanelId) } }
    })
  }
  panelCommand('palette.approvals', APPROVALS_PANEL, () => t('shortcutApprovals'), ['approvals'])
  panelCommand('palette.inbox', INBOX_PANEL, () => t('shortcutInbox'), ['inbox', 'handoffs'])
}
