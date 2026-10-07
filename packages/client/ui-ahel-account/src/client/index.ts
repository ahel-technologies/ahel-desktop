/**
 * Browser face of the Ahel account: mounts the Host's `ahelAccount` Remote
 * namespace, keeps one live account view from its `watch` stream, and fills
 * the sidebar footer (account menu, offline banner), the blank-session
 * greeting's first name, the running-status pulse mark, the Settings > Models
 * footer (the Ahel row beside bring-your-own-key providers) and header (the
 * workspace's default model), the model picker's metering source (prices,
 * default model, balance and each request's hold and settle), the starter
 * prompts below the blank-session composer, the rows for Ahel model
 * refusals in the transcript, the Discover panel over the Host's
 * `ahelCatalog` namespace, and over `ahelTeam`'s summary the balance line
 * and the Approvals panel with its badge and notifications, the Inbox
 * of teammate handoffs with its unread badge, the team header at the top of
 * the sidebar, the team strip under the welcome greeting, and the chat
 * header's Hand off button.
 */
import type { Context } from '@ahel/cordis'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import ahelAccountRemote from '@ahel/dsh-ahel-account/remote'
import type { AhelAccountInjected, AhelAccountUi } from './contract.ts'
import { AccountMenu } from './AccountMenu.tsx'
import { AhelQuotaNotice, AhelTurnError, claimAhelFailure } from './AhelNotices.tsx'
import { ModelsRow } from './ModelsRow.tsx'
import { StarterPrompts } from './StarterPrompts.tsx'
import { HeroGreeting } from './HeroGreeting.tsx'
import { BrandPulseMark } from './BrandPulseMark.tsx'
import { registerCatalog } from './catalog/apply.ts'
import { registerTeam } from './team/apply.ts'
import { registerTeamSummary } from './team/summary.ts'
import { AHEL_PROVIDER, createAhelModelSource } from './models/source.ts'
import { DefaultModelRow, type DefaultModelInjected } from './models/DefaultModelRow.tsx'
import type {} from '@ahel/dsh-client-ui-model-selection/client'
import { en, NS, zh } from './locales.ts'

export type {
  AccountMenuProps, AhelAccountInjected, AhelAccountUi, AhelFailureCode, AhelQuotaNoticeProps, AhelTurnErrorProps, HeroGreetingProps,
  ModelsRowProps, StarterPromptsProps,
} from './contract.ts'
export type { AhelAccountKey } from './locales.ts'
export type { DefaultModelInjected, DefaultModelRowProps } from './models/DefaultModelRow.tsx'
export type { AhelModelSource, DefaultModelView } from './models/source.ts'
export type { CatalogPanelId, DiscoverInjected, DiscoverPageProps } from './catalog/contract.ts'
export type {
  ApprovalAnswer, ApprovalsInjected, ApprovalsPageProps, ApprovalsPanelIconProps, InboxAnswer, InboxInjected, InboxLoad, InboxPageProps,
  InboxPanelIconProps, TeamGlanceInjected, TeamGlanceTarget, TeamHeaderProps, TeamStripProps, TeamSummary, TeamSummaryState,
} from './team/contract.ts'

declare module '@ahel/cordis' {
  interface Context {
    /** The account view, the team summary and the account actions; provided once the Ahel Remote namespaces are mounted. */
    ahelAccountUi: AhelAccountUi
  }
}

/** Required services: the Remote mount, slots, dictionaries and the main-panel layout. */
export const inject = ['remote', 'slots', 'locale', 'layout']

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
 * Carry the workspace to ahel.ai's billing page.
 * @param topUpUrl - `DesktopCredits.topUpUrl` from ahel.ai.
 * @param workspace - the workspace the balance belongs to.
 * @returns the URL to open, or null when ahel.ai sent something that is not a web page.
 */
function billingUrl(topUpUrl: string, workspace: string): string | null {
  let url: URL
  try {
    url = new URL(topUpUrl)
  } catch (_invalid) {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  url.searchParams.set('workspace', workspace)
  return url.href
}

/**
 * Register dictionaries, the account stream and both slot occupants.
 * @param ctx - Client context with the mounted `ahelAccount` and `ahelCatalog` namespaces.
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
  const team = registerTeamSummary(ctx, account)
  const modelSource = createAhelModelSource(ctx, account, team)
  // The picker reads prices, the workspace default and the balance once ui-model-selection is loaded.
  ctx.inject(['modelDirectories'], (inner) => {
    inner.effect(() => inner.modelDirectories.registerBilling({
      provider: AHEL_PROVIDER, state: modelSource.billing, refreshBalance: () => { modelSource.refreshBalance() },
    }), 'ui-ahel-account: model billing source')
  })
  const defaultModel: DefaultModelInjected = {
    setDefault: model => modelSource.setDefault(model),
    hooks: { models: modelSource.view },
  }

  const injected: AhelAccountInjected = {
    signIn: async () => {
      // A Host the hosted chat launched cannot run a loopback sign-in; reloading ahel.ai's chat page brings a fresh grant.
      if (view?.hosted) { window.location.assign(view.hosted.signInUrl); return }
      const result = await ctx.remote.ahelAccount.signIn()
      if (!result.ok) throw result.error
      const url = result.value.attempt?.authorizeUrl
      // The desktop shell opens the system browser itself only from the welcome window.
      if (url !== undefined && result.value.attempt?.phase === 'waiting-browser') openLink(url)
    },
    signOut: async () => {
      // The hosted chat's sign-in is the person's ahel.ai session; it ends on ahel.ai.
      if (view?.hosted) { openLink(view.hosted.signOutUrl); return }
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
      // The answer already carries the applied choice; the header and the summary must not wait for the watch stream.
      publish(result.value)
    },
    openLink,
    openModels: () => { ctx.emit('settings/open-section', 'models') },
    openPanel: (id) => { ctx.layout.selectPanel(id as MainPanelId) },
    openBilling: () => {
      const summary = team.state.getSnapshot().summary
      if (summary?.credits?.visible !== true) return
      const url = billingUrl(summary.credits.topUpUrl, view?.workspace ?? summary.workspace.id)
      if (url !== null) openLink(url)
    },
    hooks: { account, summary: team.state },
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'ahel-account', order: 0, locale: NS, inject: () => injected,
  }, AccountMenu))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'ahel-models', order: 0, locale: NS, inject: () => injected,
  }, ModelsRow))
  ctx.slots.inject('settings.models.header', () => ctx.slots.register({
    name: 'settings.models.header', id: 'ahel-default-model', order: 0, locale: NS, inject: () => defaultModel,
  }, DefaultModelRow))
  ctx.slots.inject('conversation.hero.dock', () => ctx.slots.register({
    name: 'conversation.hero.dock', id: 'ahel-starters', order: 0, locale: NS, inject: () => injected,
  }, StarterPrompts))
  ctx.slots.inject('conversation.hero.greeting', () => ctx.slots.register({
    name: 'conversation.hero.greeting', inject: () => injected,
  }, HeroGreeting))
  ctx.slots.inject('conversation.brand.pulse', () => ctx.slots.register({
    name: 'conversation.brand.pulse',
  }, BrandPulseMark))
  ctx.slots.inject('conversation.chat.turnError', () => ctx.slots.register({
    name: 'conversation.chat.turnError', locale: NS, inject: () => injected, select: claimAhelFailure,
  }, AhelTurnError))
  ctx.slots.inject('shell.quota-notice', () => ctx.slots.register({
    name: 'shell.quota-notice', select: owner => owner.code === 'ACCOUNT_QUOTA' ? owner.code : null,
  }, AhelQuotaNotice))
  registerCatalog(ctx, injected)
  registerTeam(ctx, injected, team)
  const ui: AhelAccountUi = {
    account,
    summary: team.state,
    selectWorkspace: id => injected.selectWorkspace(id),
    signOut: () => injected.signOut(),
    refreshSummary: () => { team.refresh() },
    openBilling: () => { injected.openBilling() },
  }
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('ahelAccountUi', ui)
    // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
    return () => { void dispose() }
  }, 'ui-ahel-account: ahelAccountUi service')
}

/**
 * Mount the `ahelAccount` Remote namespace, then register the UI once it is ready.
 * @param ctx - Client runtime.
 * @returns disposer withdrawing the UI and the Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(ahelAccountRemote)
  const ui = ctx.inject(['remote.ahelAccount', 'remote.ahelCatalog', 'remote.ahelTeam', 'slots', 'locale', 'layout'], (inner) => { register(inner) })
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
