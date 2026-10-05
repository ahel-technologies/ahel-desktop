/**
 * Browser face of "use what you already have": mounts the Host's `localCli`
 * Remote namespace, keeps one live list of detected CLIs from its `watch`
 * stream, and fills the Settings > Models footer (after the Ahel row) with
 * the Detected-on-this-computer rows plus a `shell.overlay` toast that
 * outlives the Settings page.
 */
import type { Context } from '@ahel/cordis'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { LocalCliView } from '@ahel/dsh-llm-local-cli/types'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import localCliRemote from '@ahel/dsh-llm-local-cli/remote'
import { DetectedRows, LocalCliToast } from './DetectedRows.tsx'
import type { LocalCliInjected, LocalCliToastState } from './DetectedRows.tsx'
import { en, NS, zh } from './locales.ts'

export type { DetectedRowsProps, LocalCliInjected, LocalCliToastProps, LocalCliToastState } from './DetectedRows.tsx'
export type { LocalCliKey } from './locales.ts'

/** Required services: the Remote mount, slots and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/**
 * A minimal observable cell.
 * @param initial - first value.
 * @returns the observable and its setter.
 */
function cell<T>(initial: T): { observable: HostObservable<T>; set: (next: T) => void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    observable: {
      getSnapshot: () => value,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    set: (next) => { value = next; for (const listener of listeners) listener() },
  }
}

/**
 * Register dictionaries, the detection stream and both slot occupants.
 * @param ctx - Client context with the mounted `localCli` namespace.
 */
function register(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-local-cli: dictionaries')
  const views = cell<LocalCliView[] | null>(null)
  const toast = cell<LocalCliToastState | null>(null)
  let seq = 0

  const stream = ctx.remote.$stream<LocalCliView[]>({
    name: 'local cli', open: signal => ctx.remote.localCli.watch(signal), ended: () => new Error('local cli stream ended'),
  })
  ctx.effect(() => () => stream.dispose(), 'ui-local-cli: detection stream')
  void (async () => {
    for await (const frame of stream) { views.set(frame.value); frame.accept() }
  })().catch(() => undefined)

  /** Apply a Remote result's list right away; the stream repeats it moments later. */
  const settle = (result: Awaited<ReturnType<typeof ctx.remote.localCli.detect>>): void => {
    if (!result.ok) throw result.error
    views.set(result.value)
  }

  const injected: LocalCliInjected = {
    detect: async () => { settle(await ctx.remote.localCli.detect()) },
    enable: async (id) => { settle(await ctx.remote.localCli.enable(id)) },
    disable: async (id) => { settle(await ctx.remote.localCli.disable(id)) },
    // The desktop shell hands https URLs to the system browser.
    openLink: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    notify: (text, tone) => { seq += 1; toast.set({ seq, text, tone }) },
    dismissToast: () => { toast.set(null) },
    hooks: { views: views.observable, toast: toast.observable },
  }
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'local-cli', order: 1, locale: NS, inject: () => injected,
  }, DetectedRows))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'local-cli.toast', locale: NS, inject: () => injected,
  }, LocalCliToast))
}

/**
 * Mount the `localCli` Remote namespace, then register the UI once it is ready.
 * @param ctx - Client runtime.
 * @returns disposer withdrawing the UI and the Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(localCliRemote)
  const ui = ctx.inject(['remote.localCli', 'slots', 'locale'], (inner) => { register(inner) })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
