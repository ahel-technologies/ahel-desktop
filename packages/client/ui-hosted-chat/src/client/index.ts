/**
 * Browser face of the hosted chat at ahel.ai/chat. The sidebar's body becomes
 * ahel.ai's app rail (workspace switcher; Home, Chat, Apps, Discover, Inbox,
 * Team, Settings; Help, account, Theme, Log out), a chat column beside the
 * Conversation carries New chat, the Chats list and "Waiting on you", and the
 * blank chat greets with a page header and the number of apps ready. On load
 * the chat follows the workspace the chat gateway's `ahel_chat_workspace`
 * cookie names, and a switch made in the chat is pinned on ahel.ai so the next
 * load keeps it. The Chats list shows the chats started in the selected
 * workspace (the Host stamps each chat at its first step); until the account
 * and that follow have settled it shows only the New chat draft (./scope.ts).
 * Only the hosted overlay (packages/bundle/web-app/hosted/chat.patch.yml)
 * mounts this package; the desktop and plain web profiles keep their sidebar.
 * The theme follows the ahel.ai account theme cookie (./account-theme.ts).
 */
import type { Context } from '@ahel/cordis'
import type { Issue, IssueRunState } from '@ahel/dsh-ahel-account/types'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import type { ThemePreference } from '@ahel/dsh-client-ui-theme/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-ahel-account/remote'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from '@ahel/dsh-api-session-controller/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import type { HostedShellInjected } from './contract.ts'
import { followAccountTheme } from './account-theme.ts'
import { HostedAside } from './Aside.tsx'
import { BrandHomeLink, HostedGreeting, HostedHeroMark, HostedSubtitle } from './Hero.tsx'
import { HostedRail } from './Rail.tsx'
import { cell, relay } from './observable.ts'
import { type FollowState, watchChatScope } from './scope.ts'
import { en, NS, zh } from './locales.ts'

export { APP_HOME, HELP_URL, INBOX_PANEL, NAV } from './Rail.tsx'
export { APPROVALS_PANEL } from './Aside.tsx'
export type {
  BrandHomeLinkProps, HostedAsideProps, HostedGreetingProps, HostedHeroMarkProps, HostedRailProps, HostedShellInjected,
  HostedSubtitleProps,
} from './contract.ts'
export type { HostedChatKey } from './locales.ts'
export { chatScope, inChatScope, onlyDraft, watchChatScope } from './scope.ts'
export type { ChatRow, ChatScope, ChatScopeDeps, FollowState } from './scope.ts'

// The event @ahel/dsh-client-ui-issues declares and listens to; the chat column only emits it.
declare module '@ahel/cordis' {
  interface Events {
    /**
     * Show the Issues panel with one issue's detail open.
     * @mode emit
     * @param key - the issue key, for example `AHEL-137`.
     */
    'ahel-issues/open'(key: string): void
  }
}

/**
 * Cookie the chat gateway sets on every load of the chat (Path=/chat/, readable by the page) with
 * ahel.ai's active workspace id, the one it mints the grant for; an empty value states no preference.
 */
export const CHAT_WORKSPACE_COOKIE = 'ahel_chat_workspace'

/** ahel.ai route on the page's own origin that pins the active workspace for app.ahel.ai and the next chat load. */
export const PIN_WORKSPACE_PATH = '/api/chat/workspace'

/** Run states that wait for the person who asked for the run. */
const WAITING_STATES: readonly IssueRunState[] = ['waiting_input', 'waiting_approval']

/** Next theme preference of the rail's Theme row. */
const NEXT_THEME: Readonly<Record<ThemePreference, ThemePreference>> = { system: 'light', light: 'dark', dark: 'system' }

const EMPTY_SUMMARY: TeamSummaryState = { summary: null, outdated: false, error: null }
const FOLLOW_WAITING: FollowState = { kind: 'waiting' }
const FOLLOW_SETTLED: FollowState = { kind: 'settled' }
const NO_ISSUES: readonly Issue[] = []

/** Required services: slots, dictionaries, the main-panel layout and the theme. */
export const inject = ['slots', 'locale', 'layout', 'theme']

/**
 * Read one cookie of the page.
 * @param name - cookie name.
 * @returns its decoded value, or null when the page has no such cookie or it is empty.
 */
export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const raw = part.slice(at + 1).trim()
    if (raw === '') return null
    try {
      return decodeURIComponent(raw)
    } catch (_malformed) {
      // A value that is not URI-encoded names no workspace id.
      return null
    }
  }
  return null
}

/**
 * The workspace to follow on load: the cookie's, while it is one of the account's and not already selected.
 * @param view - the account view.
 * @param cookie - the `ahel_active_tenant` value, or null.
 * @returns the workspace id to select, or null to keep the current choice.
 */
export function workspaceToFollow(view: AhelAccountView, cookie: string | null): string | null {
  if (cookie === null || cookie === view.workspace) return null
  return view.profile?.workspaces.some(item => item.id === cookie) === true ? cookie : null
}

/**
 * Pin a workspace chosen in the chat as ahel.ai's active one. Failures are ignored: the chat keeps the
 * choice for this load either way.
 * @param id - the workspace id.
 */
export function pinAppWorkspace(id: string): void {
  if (typeof fetch !== 'function') return
  void fetch(PIN_WORKSPACE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: id }),
  }).catch(() => undefined)
}

/**
 * Merge the waiting runs of each state, newest first.
 * @param pages - one issue list per waiting state.
 * @returns the issues, each once.
 */
export function mergeWaiting(pages: readonly (readonly Issue[])[]): readonly Issue[] {
  const byKey = new Map<string, Issue>()
  for (const issues of pages) for (const issue of issues) byKey.set(issue.key, issue)
  const at = (issue: Issue): string => issue.run?.updatedAt ?? issue.updatedAt
  return [...byKey.values()].sort((a, b) => at(b).localeCompare(at(a)))
}

/**
 * Register the dictionaries, the rail, the chat column, the greeting and the account wiring.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-hosted-chat: dictionaries')
  ctx.effect(() => followAccountTheme(ctx), 'ui-hosted-chat: the ahel.ai account theme')

  const account = relay<AhelAccountView | null>(null)
  const summary = relay<TeamSummaryState>(EMPTY_SUMMARY)
  const waitingIssues = cell<readonly Issue[]>(NO_ISSUES)
  const chatSeat = cell<HTMLElement | null>(null)
  const follow = cell<FollowState>(FOLLOW_WAITING)
  const theme: HostObservable<ThemePreference> = {
    getSnapshot: () => ctx.theme.getTheme().preference,
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }
  let selectWorkspace: (id: string) => Promise<void> = () => Promise.reject(new Error('ui-hosted-chat: the Ahel account is not mounted'))
  let signOut: () => Promise<void> = async () => {}
  let openBilling: () => void = () => {}

  const face: HostedShellInjected = {
    selectPanel: (id) => {
      try {
        ctx.layout.selectPanel(id as MainPanelId | null)
      } catch (_unregistered) {
        // Inbox and Approvals register only while signed in, Approvals only for managers.
      }
    },
    selectWorkspace: async (id) => {
      await selectWorkspace(id)
      pinAppWorkspace(id)
    },
    signOut: () => signOut(),
    openBilling: () => { openBilling() },
    openChatSettings: () => {
      const first = [...ctx.slots.entriesOfSlot('settings.section')]
        .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))[0]?.options.id
      if (first !== undefined) ctx.emit('settings/open-section', first)
    },
    cycleTheme: () => { ctx.theme.setTheme(NEXT_THEME[ctx.theme.getTheme().preference]) },
    openIssue: (key) => { ctx.emit('ahel-issues/open', key) },
    setChatSeat: (element) => { chatSeat.set(element) },
    hooks: { account, summary, waitingIssues, theme, chatSeat },
  }

  ctx.slots.inject('sidebar.body', () => ctx.slots.register({
    name: 'sidebar.body', locale: NS, inject: () => face,
  }, HostedRail))
  ctx.slots.inject('sidebar.brand.link', () => ctx.slots.register({
    name: 'sidebar.brand.link', locale: NS,
  }, BrandHomeLink))
  ctx.slots.inject('shell.aside', () => ctx.slots.register({
    name: 'shell.aside', locale: NS, inject: () => face,
  }, HostedAside))
  // Below the shipped occupants' default priority 0, so these render in their place.
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark', priority: -1,
  }, HostedHeroMark))
  ctx.slots.inject('conversation.hero.greeting', () => ctx.slots.register({
    name: 'conversation.hero.greeting', priority: -1, locale: NS, inject: () => face,
  }, HostedGreeting))
  // The same cell as ui-ahel-account's team strip, whose stat tiles it replaces.
  ctx.slots.inject('conversation.hero.subhead', () => ctx.slots.register({
    name: 'conversation.hero.subhead', id: 'ahel-team', order: 0, priority: -1, locale: NS, inject: () => face,
  }, HostedSubtitle))

  ctx.inject(['ahelAccountUi'], (inner) => {
    const ui = inner.ahelAccountUi
    inner.effect(() => account.bind(ui.account), 'ui-hosted-chat: account view')
    inner.effect(() => summary.bind(ui.summary), 'ui-hosted-chat: team summary')
    inner.effect(() => {
      selectWorkspace = id => ui.selectWorkspace(id)
      signOut = () => ui.signOut()
      openBilling = () => { ui.openBilling() }
      return () => {
        openBilling = () => {}
        selectWorkspace = () => Promise.reject(new Error('ui-hosted-chat: the Ahel account is not mounted'))
        signOut = async () => {}
      }
    }, 'ui-hosted-chat: account actions')
    // Once per page load: the first signed-in view moves to the workspace ahel.ai shows as active.
    // The Chats list waits for this follow (./scope.ts), so it never shows the previous workspace first.
    inner.effect(() => {
      let followed = false
      let live = true
      const followNow = (): void => {
        const view = ui.account.getSnapshot()
        if (followed || view?.status !== 'signed-in' || view.profile === null) return
        followed = true
        const id = workspaceToFollow(view, readCookie(CHAT_WORKSPACE_COOKIE))
        if (id === null) {
          follow.set(FOLLOW_SETTLED)
          return
        }
        follow.set({ kind: 'moving', to: id })
        void ui.selectWorkspace(id).catch(() => undefined).finally(() => { if (live) follow.set(FOLLOW_SETTLED) })
      }
      followNow()
      const off = ui.account.subscribe(followNow)
      return () => {
        live = false
        off()
        follow.set(FOLLOW_WAITING)
      }
    }, 'ui-hosted-chat: follow the active workspace')
  })

  // Registered as soon as the Session browser exists: until the account and the follow settle, only the draft lists.
  ctx.inject(['uiWorkspace', 'sessions'], (inner) => {
    inner.effect(() => watchChatScope({
      account, summary, follow, sessions: inner.sessions.list,
      scopeSessions: filter => inner.uiWorkspace.scopeSessions(filter),
      startChat: () => { inner.uiWorkspace.startSession() },
    }), 'ui-hosted-chat: chats of the selected workspace')
  })

  ctx.inject(['ahelAccountUi', 'remote.ahelIssues'], (inner) => {
    const ui = inner.ahelAccountUi
    // Only the newest read publishes, so a slow answer never overwrites a newer one.
    let generation = 0
    const read = async (): Promise<void> => {
      const mine = ++generation
      if (ui.account.getSnapshot()?.status !== 'signed-in' || ui.summary.getSnapshot().summary === null) {
        waitingIssues.set(NO_ISSUES)
        return
      }
      const pages = await Promise.all(WAITING_STATES.map(runState =>
        inner.remote.ahelIssues.list({ runState, requestedBy: 'me', limit: 20 })))
      if (mine !== generation) return
      const issues: (readonly Issue[])[] = []
      for (const page of pages) {
        // A failed read keeps the last list; the next summary read tries again.
        if (!page.ok) return
        issues.push(page.value.issues)
      }
      waitingIssues.set(mergeWaiting(issues))
    }
    const refresh = (): void => { void read().catch(() => undefined) }
    // Each new summary (the 30 s poll, window focus, a workspace change) re-reads the waiting runs.
    inner.effect(() => {
      let last = ui.summary.getSnapshot().summary
      refresh()
      return ui.summary.subscribe(() => {
        const next = ui.summary.getSnapshot().summary
        if (next === last) return
        last = next
        refresh()
      })
    }, 'ui-hosted-chat: waiting issue runs')
  })
}
