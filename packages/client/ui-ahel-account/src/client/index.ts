/**
 * Browser face of the Ahel account: mounts the Host's `ahelAccount` Remote
 * namespace, keeps one live account view from its `watch` stream, and fills
 * the sidebar footer (account menu) and the Settings > Models footer (the Ahel
 * row beside bring-your-own-key providers).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { AhelAccountView } from '@deepseek-ai/dsh-ahel-account/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import ahelAccountRemote from '@deepseek-ai/dsh-ahel-account/remote'
import type { AhelAccountInjected } from './contract.ts'
import { AccountMenu } from './AccountMenu.tsx'
import { ModelsRow } from './ModelsRow.tsx'
import { en, NS, zh } from './locales.ts'

export type { AccountMenuProps, AhelAccountInjected, ModelsRowProps } from './contract.ts'
export type { AhelAccountKey } from './locales.ts'

/** Required services: the Remote mount, slots and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/** Open an absolute https URL outside the app; the desktop shell hands it to the system browser. */
function openLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Register dictionaries, the account stream and both slot occupants.
 * @param ctx - Client context with the mounted `ahelAccount` namespace.
 */
function register(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-ahel-account: dictionaries')
  let view: AhelAccountView | null = null
  const listeners = new Set<() => void>()
  const account: HostObservable<AhelAccountView | null> = {
    getSnapshot: () => view,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: AhelAccountView): void => { view = next; for (const listener of listeners) listener() }
  const stream = ctx.remote.$stream<AhelAccountView>({
    name: 'ahel account', open: signal => ctx.remote.ahelAccount.watch(signal), ended: () => new Error('ahel account stream ended'),
  })
  ctx.effect(() => () => stream.dispose(), 'ui-ahel-account: account stream')
  void (async () => {
    for await (const frame of stream) { publish(frame.value); frame.accept() }
  })().catch(() => undefined)

  const injected: AhelAccountInjected = {
    signIn: async () => {
      const result = await ctx.remote.ahelAccount.signIn()
      if (!result.ok) throw result.error
      const url = result.value.attempt?.authorizeUrl
      // The desktop shell opens the system browser itself only from the welcome window.
      if (url !== undefined && result.value.attempt?.phase === 'waiting-browser') openLink(url)
    },
    signOut: async () => {
      const result = await ctx.remote.ahelAccount.signOut()
      if (!result.ok) throw result.error
    },
    openLink,
    hooks: { account },
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'ahel-account', order: 0, locale: NS, inject: () => injected,
  }, AccountMenu))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'ahel-models', order: 0, locale: NS, inject: () => injected,
  }, ModelsRow))
}

/**
 * Mount the `ahelAccount` Remote namespace, then register the UI once it is ready.
 * @param ctx - Client runtime.
 * @returns disposer withdrawing the UI and the Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(ahelAccountRemote)
  const ui = ctx.inject(['remote.ahelAccount', 'slots', 'locale'], (inner) => { register(inner) })
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
