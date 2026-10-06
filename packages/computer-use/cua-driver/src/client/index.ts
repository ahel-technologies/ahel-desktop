/**
 * Settings > General > Computer use (beta), browser half. The row turns the
 * `computerUse.enabled` setting on and off and shows the driver phase and any
 * missing macOS permission over the Host's `computerUseDriver` Remote.
 */

import type { Context as ClientContext } from '@ahel/cordis'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
export type {} from '@ahel/dsh-computer-use-cua-driver/remote'
import type { ComputerUseSettingsPane, ComputerUseDriverStatus } from '../types.ts'
import { ComputerUseRow } from './ComputerUseRow.tsx'
import type { ComputerUseRowInjected, ComputerUseRowState } from './ComputerUseRow.tsx'
import { en, zh, type ComputerUseSettingsLocaleKey } from './locales.ts'

export type { ComputerUseRowInjected, ComputerUseRowProps, ComputerUseRowState } from './ComputerUseRow.tsx'
export type { ComputerUseSettingsLocaleKey } from './locales.ts'

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Computer use settings row copy. */
    'settings.computerUse': ComputerUseSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.computerUse'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote']

/**
 * Register the row once the Host serves the `computerUseDriver` namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'computer-use-cua-driver: dictionaries')
  ctx.inject(['remote.computerUseDriver', 'slots'], (inner) => { register(inner) })
}

function register(ctx: ClientContext): void {
  let state: ComputerUseRowState = { status: undefined, busy: false, failed: false }
  const listeners = new Set<() => void>()
  const row: HostObservable<ComputerUseRowState> = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: Partial<ComputerUseRowState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  const stream = ctx.remote.$stream<ComputerUseDriverStatus>({
    name: 'computer use status', open: signal => ctx.remote.computerUseDriver.watch(signal), ended: () => new Error('computer use status stream ended'),
  })
  ctx.effect(() => () => stream.dispose(), 'computer-use-cua-driver: status stream')
  void (async () => {
    for await (const frame of stream) {
      publish({ status: frame.value })
      frame.accept()
    }
  })().catch(() => undefined)

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    publish({ busy: true, failed: false })
    try {
      await action()
    } catch (_unreachable) {
      // The Remote call failed (Host gone or the profile write refused); the row says so.
      publish({ failed: true })
    } finally {
      publish({ busy: false })
    }
  }
  const injected: ComputerUseRowInjected = {
    hooks: { row },
    setEnabled: enabled => run(() => ctx.remote.computerUseDriver.setEnabled(enabled)),
    openSettings: (pane: ComputerUseSettingsPane) => run(() => ctx.remote.computerUseDriver.openSystemSettings(pane)),
    recheck: () => run(() => ctx.remote.computerUseDriver.recheck()),
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'computer-use', order: 55, locale: NS, inject: () => injected,
  }, ComputerUseRow))
}
