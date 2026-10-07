/** Registration: dictionaries, the live state stream, the three slot occupants and the stop shortcut. */
import type { Context } from '@ahel/cordis'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { ComposerChainProps } from '@ahel/dsh-client-ui-conversation/client'
import type { PendingApproval } from '@ahel/dsh-client-ui-approval/client'
import type { ShortcutCommandId } from '@ahel/dsh-client-shortcuts/client'
import type { ComputerUseView } from '@ahel/dsh-computer-use-action-gate/types'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-computer-use/remote'
import type { ComputerUseInjected } from './contract.ts'
import { ComputerUseApprovalCard } from './ApprovalCard.tsx'
import { ComputerUseDock } from './Dock.tsx'
import { ComputerUseSettingsRow } from './SettingsRow.tsx'
import { isComputerUseApproval } from './view.ts'
import { en, NS, zh } from './locales.ts'

/** The stop shortcut on every profile: Cmd/Ctrl + Option/Alt + Shift + Period. */
const STOP_BINDING = { code: 'Period', modifiers: ['primary', 'alt', 'shift'] } as const

/**
 * Register everything once the `computerUseApproval` Remote namespace is mounted.
 * @param ctx - Client context with the namespace, slots and locale.
 * @param config - client options.
 * @param config.serverName - MCP server name of the Cua Driver.
 */
export function registerComputerUse(ctx: Context, config: { serverName: string }): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-computer-use: dictionaries')
  const t = ctx.locale.bind(NS)
  const prefix = `mcp__${config.serverName}__`

  let view: ComputerUseView | null = null
  const listeners = new Set<() => void>()
  const hook: HostObservable<ComputerUseView | null> = {
    getSnapshot: () => view,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const stream = ctx.remote.$stream<ComputerUseView>({
    name: 'computer use', open: signal => ctx.remote.computerUseApproval.watch(signal), ended: () => new Error('computer use stream ended'),
  })
  ctx.effect(() => () => stream.dispose(), 'ui-computer-use: state stream')
  void (async () => {
    for await (const frame of stream) {
      view = frame.value
      for (const listener of listeners) listener()
      frame.accept()
    }
  })().catch(() => undefined)

  const injected: ComputerUseInjected = {
    card: async (callId) => {
      const result = await ctx.remote.computerUseApproval.card(callId)
      if (!result.ok) throw result.error
      return result.value
    },
    stop: async () => {
      const result = await ctx.remote.computerUseApproval.stop()
      if (!result.ok) throw result.error
    },
    setPaused: async (sessionId, paused) => {
      const result = await ctx.remote.computerUseApproval.setPaused(sessionId, paused)
      if (!result.ok) throw result.error
    },
    setBlockedApps: async (apps) => {
      const result = await ctx.remote.computerUseApproval.setBlockedApps(apps)
      if (!result.ok) throw result.error
    },
    stopKeys: '⌘⌥⇧.',
    hooks: { view: hook },
  }

  // Lower priority than the generic approval panel, so computer-use approvals get this card.
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: 0,
    select: ({ pendingInteraction }: ComposerChainProps): PendingApproval | null =>
      isComputerUseApproval(pendingInteraction, prefix) ? pendingInteraction as PendingApproval : null,
    locale: NS,
    inject: () => injected,
  }, ComputerUseApprovalCard))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'computer-use', order: -10, locale: NS, inject: () => injected,
  }, ComputerUseDock))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'computer-use-blocked-apps', order: 56, locale: NS, inject: () => injected,
  }, ComputerUseSettingsRow))

  ctx.inject(['shortcuts'], (scope) => {
    scope.effect(() => {
      try {
        return scope.shortcuts.register({
          id: 'computerUse.stop' as ShortcutCommandId,
          label: () => t('shortcut.stop'),
          aliases: ['stop computer use', 'kill switch'],
          defaults: {
            'desktop:macos': STOP_BINDING,
            'desktop:windows': STOP_BINDING,
            'desktop:linux': STOP_BINDING,
            'web:macos': STOP_BINDING,
            'web:windows': STOP_BINDING,
            'web:linux': STOP_BINDING,
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: () => view?.sessions.some(session => session.running) === true
            ? { status: 'handled', run: () => { void injected.stop().catch(() => undefined) } }
            : { status: 'pass' },
        })
      } catch (error) {
        ctx.logger.warn(`ui-computer-use: the stop shortcut was not registered: ${String(error)}`)
        return () => {}
      }
    }, 'ui-computer-use: stop shortcut')
  })
}
