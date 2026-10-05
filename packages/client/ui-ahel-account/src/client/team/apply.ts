/**
 * Team assembly: the `ahel-approvals` main panel, its sidebar row for
 * owners and team leads with the pending-count badge, and a system
 * notification when a new held call arrives; the `ahel-inbox` main panel and
 * its sidebar row with the unread badge, whose Open seeds a new session; and
 * the session menu's "Share with teammate" with its dialog.
 */
import type { Context } from '@ahel/cordis'
import type { AhelAccountView, HandoffSessionDraft } from '@ahel/dsh-ahel-account/types'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
// Type-only: the `ahel-team/*` Remote failure codes.
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import type { RemoteFailure } from '@ahel/dsh-api-remotes/client'
import type { AhelAccountInjected } from '../contract.ts'
import { NS } from '../locales.ts'
import { ApprovalsPanelIcon, InboxPanelIcon } from '../catalog/PanelIcons.tsx'
import { ApprovalsPage } from './ApprovalsPage.tsx'
import { InboxPage } from './InboxPage.tsx'
import { ShareHandoffDialog, ShareHandoffMenuItem, type ShareHandoffInjected, type ShareRequest } from './ShareHandoff.tsx'
import type { ApprovalsInjected, InboxAnswer, InboxInjected, InboxLoad, TeamSummary, TeamSummaryState } from './contract.ts'

/** Main panel and sidebar row id of the Approvals page. */
const APPROVALS_ID = 'ahel-approvals' as MainPanelId

/** ahel.ai's organization settings, where approval rules and the web list live. */
const WEB_APPROVALS = 'https://ahel.ai/app/settings/organization#approvals'

/** Main panel and sidebar row id of the Inbox page. */
const INBOX_ID = 'ahel-inbox' as MainPanelId

/** ahel.ai's handoffs page. */
const WEB_HANDOFFS = 'https://ahel.ai/app/handoffs'

/** Roles that answer held calls on ahel.ai (`canManageOrg`). */
const MANAGER_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN'])

/**
 * The signed-in person's role in the selected workspace.
 * @param view - the live account view.
 * @param state - the latest summary, which names the workspace ahel.ai picked when none is selected.
 * @returns the role, or undefined while unknown.
 */
function selectedRole(view: AhelAccountView | null, state: TeamSummaryState): string | undefined {
  if (view?.status !== 'signed-in') return undefined
  const id = view.workspace ?? state.summary?.workspace.id
  if (id === undefined) return undefined
  return view.profile?.workspaces.find(item => item.id === id)?.role
    ?? (state.summary?.workspace.id === id ? state.summary.workspace.role : undefined)
}

/**
 * Register the Approvals panel, its managers-only sidebar row and the new-call notifications.
 * @param ctx - Client context with `remote.ahelTeam`, `slots`, `locale` and `layout`.
 * @param account - the account face built by the package's `register`.
 * @param summary - the shared summary poll.
 */
export function registerTeam(ctx: Context, account: AhelAccountInjected, summary: TeamSummary): void {
  const t = ctx.locale.bind(NS)
  const face: ApprovalsInjected = {
    decide: async (id, decision, note) => {
      const result = await ctx.remote.ahelTeam.decideApproval(id, decision, note)
      summary.refresh()
      if (result.ok) return { ok: true, status: result.value.status }
      const { code, message } = result.error
      if (code === 'ahel-team/outdated') return { ok: false, outdated: true, final: false, message: null }
      const final = code === 'ahel-team/refused' || code === 'ahel-team/forbidden'
      // These carry ahel.ai's own sentence; the rest are transport failures.
      const own = final || (code === 'ahel-team/unreachable' && result.error.details.status !== null)
      return { ok: false, outdated: false, final, message: own ? message : null }
    },
    refresh: () => { summary.refresh() },
    signIn: () => account.signIn(),
    openWebApprovals: () => {
      const url = new URL(WEB_APPROVALS)
      const workspace = account.hooks.account.getSnapshot()?.workspace ?? summary.state.getSnapshot().summary?.workspace.id
      if (workspace !== undefined) url.searchParams.set('workspace', workspace)
      account.openLink(url.href)
    },
    hooks: { account: account.hooks.account, summary: summary.state },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: APPROVALS_ID, locale: NS, inject: () => face,
  }, ApprovalsPage))

  // Members never see the row: it follows the selected workspace's role.
  ctx.slots.inject('sidebar.panellist', () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const view = account.hooks.account.getSnapshot()
      const state = summary.state.getSnapshot()
      const role = selectedRole(view, state)
      // While the default workspace's summary reloads its role is unknown; keep the row as it is.
      if (role === undefined && view?.status === 'signed-in' && view.workspace === null && state.summary === null) return
      const show = role !== undefined && MANAGER_ROLES.has(role)
      if (show && dispose === undefined) {
        dispose = ctx.slots.register({
          name: 'sidebar.panellist', id: APPROVALS_ID, order: -5, locale: NS, label: () => t('approvals'), inject: () => face,
        }, ApprovalsPanelIcon)
      } else if (!show && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    }
    reconcile()
    const offAccount = account.hooks.account.subscribe(reconcile)
    const offSummary = summary.state.subscribe(reconcile)
    return () => {
      offAccount()
      offSummary()
      dispose?.()
      dispose = undefined
    }
  })

  ctx.effect(() => watchNewApprovals(ctx, account, summary), 'ui-ahel-account: approval notifications')
  registerShare(ctx, account, summary)
  // Only the Inbox needs the session navigation; Approvals do not wait for it.
  ctx.inject(['uiWorkspace'], (inner) => { registerInbox(inner, account, summary) })
}

/**
 * Carry the selected workspace to an ahel.ai page.
 * @param href - the page.
 * @param account - the account face.
 * @param summary - the shared summary poll.
 * @returns the URL, or null when it is not a web page.
 */
function webUrl(href: string, account: AhelAccountInjected, summary: TeamSummary): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch (_invalid) {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const workspace = account.hooks.account.getSnapshot()?.workspace ?? summary.state.getSnapshot().summary?.workspace.id
  if (workspace !== undefined && !url.searchParams.has('workspace')) url.searchParams.set('workspace', workspace)
  return url.href
}

/**
 * Sort an `ahel-team/*` failure for the Inbox.
 * @param error - the Remote failure.
 * @returns the load failure; `refused` carries ahel.ai's own sentence.
 */
function inboxFailure(error: RemoteFailure): Extract<InboxLoad, { ok: false }> {
  switch (error.code) {
    case 'ahel-team/outdated': return { ok: false, reason: 'outdated', message: null }
    case 'ahel-team/signed-out': return { ok: false, reason: 'signed-out', message: null }
    case 'ahel-team/forbidden':
    case 'ahel-team/refused': return { ok: false, reason: 'refused', message: error.message }
    case 'ahel-team/unreachable': return { ok: false, reason: 'failed', message: error.details.status === null ? null : error.message }
    default: return { ok: false, reason: 'failed', message: null }
  }
}

/**
 * The Inbox face's answer for a failed open or done.
 * @param error - the Remote failure.
 * @returns whether ahel.ai is outdated and its sentence, if it gave one.
 */
function inboxAnswer(error: RemoteFailure): InboxAnswer {
  const failure = inboxFailure(error)
  return { ok: false, outdated: failure.reason === 'outdated', message: failure.message }
}

/**
 * Register the Inbox panel and its signed-in sidebar row with the unread badge.
 * @param ctx - Client context with `remote.ahelTeam`, `slots`, `locale` and `uiWorkspace`.
 * @param account - the account face.
 * @param summary - the shared summary poll.
 */
function registerInbox(ctx: Context, account: AhelAccountInjected, summary: TeamSummary): void {
  const t = ctx.locale.bind(NS)
  const face: InboxInjected = {
    load: async () => {
      const result = await ctx.remote.ahelTeam.inbox()
      return result.ok ? { ok: true, list: result.value } : inboxFailure(result.error)
    },
    open: async (row) => {
      const result = await ctx.remote.ahelTeam.openHandoff(row.id)
      // Opening marks it read, so the badge drops.
      summary.refresh()
      if (!result.ok) return inboxAnswer(result.error)
      const read = result.value
      const from = read.from === '' ? row.from : read.from
      // Without a workspace to open in, startSession says so itself (`draft.workspaceRequired`).
      ctx.uiWorkspace.startSession(undefined, {
        prompt: `${t('handoffSeed', { from, title: read.title })}\n\n${read.text}`,
        clearPreviousDraft: true,
      })
      return { ok: true }
    },
    markDone: async (id) => {
      const result = await ctx.remote.ahelTeam.markHandoffDone(id)
      summary.refresh()
      return result.ok ? { ok: true } : inboxAnswer(result.error)
    },
    openUrl: (href) => {
      const url = webUrl(href, account, summary)
      if (url !== null) account.openLink(url)
    },
    openWebInbox: () => {
      const url = webUrl(WEB_HANDOFFS, account, summary)
      if (url !== null) account.openLink(url)
    },
    signIn: () => account.signIn(),
    hooks: { account: account.hooks.account, summary: summary.state },
  }

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: INBOX_ID, locale: NS, inject: () => face,
  }, InboxPage))

  ctx.slots.inject('sidebar.panellist', () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const show = account.hooks.account.getSnapshot()?.status === 'signed-in'
      if (show && dispose === undefined) {
        dispose = ctx.slots.register({
          name: 'sidebar.panellist', id: INBOX_ID, order: -4, locale: NS, label: () => t('inbox'), inject: () => face,
        }, InboxPanelIcon)
      } else if (!show && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    }
    reconcile()
    const off = account.hooks.account.subscribe(reconcile)
    return () => {
      off()
      dispose?.()
      dispose = undefined
    }
  })
}

/** Prefill when the chat could not be read. */
const NO_DRAFT: HandoffSessionDraft = { title: '', goal: '', changes: '' }

/**
 * Register "Share with teammate" in the session menu while signed in, and its dialog.
 * @param ctx - Client context with `remote.ahelTeam` and `slots`.
 * @param account - the account face.
 * @param summary - the shared summary poll, re-read after a share.
 */
function registerShare(ctx: Context, account: AhelAccountInjected, summary: TeamSummary): void {
  let request: ShareRequest | null = null
  let nonce = 0
  const listeners = new Set<() => void>()
  const shareRequest: HostObservable<ShareRequest | null> = {
    getSnapshot: () => request,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const setRequest = (next: ShareRequest | null): void => {
    request = next
    for (const listener of listeners) listener()
  }
  const face: ShareHandoffInjected = {
    requestShare: (sessionId, displayTitle) => { setRequest({ sessionId, displayTitle, nonce: ++nonce }) },
    settleShare: () => { setRequest(null) },
    draft: async (sessionId) => {
      const result = await ctx.remote.ahelTeam.sessionDraft(sessionId)
      return result.ok ? result.value : NO_DRAFT
    },
    prepare: async (draft) => {
      const result = await ctx.remote.ahelTeam.prepareHandoff(draft)
      return result.ok ? { ok: true, value: result.value } : inboxFailure(result.error)
    },
    share: async (share) => {
      const result = await ctx.remote.ahelTeam.shareHandoff(share)
      if (!result.ok) return inboxFailure(result.error)
      summary.refresh()
      return { ok: true, value: result.value }
    },
    openUrl: (href) => {
      const url = webUrl(href, account, summary)
      if (url !== null) account.openLink(url)
    },
    hooks: { shareRequest },
  }

  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const show = account.hooks.account.getSnapshot()?.status === 'signed-in'
      if (show && dispose === undefined) {
        dispose = ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item', id: 'ahel-share', order: 350, locale: NS, inject: () => face,
        }, ShareHandoffMenuItem)
      } else if (!show && dispose !== undefined) {
        dispose()
        dispose = undefined
        setRequest(null)
      }
    }
    reconcile()
    const off = account.hooks.account.subscribe(reconcile)
    return () => {
      off()
      dispose?.()
      dispose = undefined
    }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'ahel-share', locale: NS, inject: () => face,
  }, ShareHandoffDialog))
}

/**
 * Post a system notification for each held call that arrives while the app runs.
 * The first read after launch, sign-in or a workspace change only seeds what is
 * already waiting, so a restart never repeats old calls.
 * @param ctx - Client context with `locale` and `layout`.
 * @param account - the account face.
 * @param summary - the shared summary poll.
 * @returns the unsubscribe.
 */
function watchNewApprovals(ctx: Context, account: AhelAccountInjected, summary: TeamSummary): () => void {
  const t = ctx.locale.bind(NS)
  const supported = typeof Notification !== 'undefined'
  let seen = new Set<string>()
  // Workspace the seen ids belong to; null until the next read seeds them.
  let seededFor: string | null = null
  let asked = false
  const shown = new Set<Notification>()

  const changed = (): void => {
    const view = account.hooks.account.getSnapshot()
    if (view?.status !== 'signed-in') { seededFor = null; return }
    const current = summary.state.getSnapshot().summary
    // The poll clears the summary on a workspace change, so the next read seeds again.
    if (current === null || current.approvals === null || !MANAGER_ROLES.has(current.workspace.role)) { seededFor = null; return }
    const approvals = current.approvals
    const ids = approvals.rows.map(row => row.id)
    if (seededFor !== current.workspace.id) {
      seededFor = current.workspace.id
      seen = new Set(ids)
      if (supported && !asked && Notification.permission === 'default') {
        asked = true
        void Notification.requestPermission().catch(() => undefined)
      }
      return
    }
    for (const row of approvals.rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      if (!supported || Notification.permission !== 'granted') continue
      const requester = row.requester?.name ?? row.requester?.email ?? t('approvalSomeone')
      const note = new Notification(t('approvalNeeded'), { body: t('approvalNeededBody', { what: row.what, requester }), tag: row.id })
      shown.add(note)
      note.onclick = () => {
        window.focus()
        ctx.layout.selectPanel(APPROVALS_ID)
        note.close()
      }
      note.onclose = () => { shown.delete(note) }
    }
  }
  const offSummary = summary.state.subscribe(changed)
  const offAccount = account.hooks.account.subscribe(changed)
  changed()
  return () => {
    offSummary()
    offAccount()
    for (const note of shown) note.onclick = null
    shown.clear()
  }
}
