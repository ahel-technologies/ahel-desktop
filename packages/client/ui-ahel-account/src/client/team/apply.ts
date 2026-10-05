/**
 * Approvals assembly: the `ahel-approvals` main panel, its sidebar row for
 * owners and team leads with the pending-count badge, and a system
 * notification when a new held call arrives.
 */
import type { Context } from '@ahel/cordis'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
// Type-only: the `ahel-team/*` Remote failure codes.
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type { AhelAccountInjected } from '../contract.ts'
import { NS } from '../locales.ts'
import { ApprovalsPanelIcon } from '../catalog/PanelIcons.tsx'
import { ApprovalsPage } from './ApprovalsPage.tsx'
import type { ApprovalsInjected, TeamSummary, TeamSummaryState } from './contract.ts'

/** Main panel and sidebar row id of the Approvals page. */
const APPROVALS_ID = 'ahel-approvals' as MainPanelId

/** ahel.ai's organization settings, where approval rules and the web list live. */
const WEB_APPROVALS = 'https://ahel.ai/app/settings/organization#approvals'

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
