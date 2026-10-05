/**
 * Browser face of the Ahel account: mounts the Host's `ahelAccount` Remote
 * namespace, keeps one live account view from its `watch` stream, and fills
 * the sidebar footer (account menu, offline banner), the Settings > Models
 * footer (the Ahel row beside bring-your-own-key providers), the starter
 * prompts below the blank-session composer, and the rows for Ahel model
 * refusals in the transcript.
 */
import type { Context } from '@ahel/cordis'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import ahelAccountRemote from '@ahel/dsh-ahel-account/remote'
import type { AhelAccountInjected } from './contract.ts'
import { AccountMenu } from './AccountMenu.tsx'
import { AhelQuotaNotice, AhelTurnError, claimAhelFailure } from './AhelNotices.tsx'
import { ModelsRow } from './ModelsRow.tsx'
import { StarterPrompts } from './StarterPrompts.tsx'
import { en, NS, zh } from './locales.ts'

export type {
  AccountMenuProps, AhelAccountInjected, AhelFailureCode, AhelQuotaNoticeProps, AhelTurnErrorProps, ModelsRowProps, StarterPromptsProps,
} from './contract.ts'
export type { AhelAccountKey } from './locales.ts'

/** Required services: the Remote mount, slots and dictionaries. */
export const inject = ['remote', 'slots', 'locale']

/** The desktop shell's account hook; absent in a plain browser. */
interface DesktopAccount {
  /** @param reason - `ended` when the sign-in ended without the person signing out. */
  changed(reason: 'signed-out' | 'ended'): Promise<void>
}

/** @returns the desktop shell's account hook, absent in a plain browser. */
function desktopAccount(): DesktopAccount | undefined {
  return (globalThis as typeof globalThis & { dshDesktop?: { account?: DesktopAccount } }).dshDesktop?.account
}

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
  // Set while the person's own sign-out runs; any other sign-out means the session ended.
  let signingOut = false
  const publish = (next: AhelAccountView): void => {
    const signedOut = view?.status === 'signed-in' && next.status === 'signed-out'
    view = next
    for (const listener of listeners) listener()
    // Desktop closes the workspace and shows its welcome after a sign-out.
    if (signedOut) void desktopAccount()?.changed(signingOut ? 'signed-out' : 'ended').catch(() => undefined)
  }
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
      signingOut = true
      try {
        const result = await ctx.remote.ahelAccount.signOut()
        if (!result.ok) throw result.error
      } finally {
        signingOut = false
      }
    },
    selectWorkspace: async (id) => {
      const result = await ctx.remote.ahelAccount.selectWorkspace(id)
      if (!result.ok) throw result.error
    },
    openLink,
    openModels: () => { ctx.emit('settings/open-section', 'models') },
    hooks: { account },
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'ahel-account', order: 0, locale: NS, inject: () => injected,
  }, AccountMenu))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'ahel-models', order: 0, locale: NS, inject: () => injected,
  }, ModelsRow))
  ctx.slots.inject('conversation.hero.dock', () => ctx.slots.register({
    name: 'conversation.hero.dock', id: 'ahel-starters', order: 0, locale: NS, inject: () => injected,
  }, StarterPrompts))
  ctx.slots.inject('conversation.chat.turnError', () => ctx.slots.register({
    name: 'conversation.chat.turnError', locale: NS, inject: () => injected, select: claimAhelFailure,
  }, AhelTurnError))
  ctx.slots.inject('shell.quota-notice', () => ctx.slots.register({
    name: 'shell.quota-notice', select: owner => owner.code === 'ACCOUNT_QUOTA' ? owner.code : null,
  }, AhelQuotaNotice))
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
