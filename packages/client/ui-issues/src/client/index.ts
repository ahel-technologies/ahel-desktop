/**
 * Browser face of team issues: over the Host's `ahelIssues` Remote namespace
 * (mounted with the Ahel account), the Issues main panel (board and list,
 * detail drawer, New Issue), its sidebar row with the count of open issues
 * assigned to the person, the New issue row, and Run with Ahel, which seeds
 * a new chat with the issue and reports the chat's state as the issue's run.
 * The feed re-reads every 60 s while the window has focus and on focus.
 * Other packages open an issue with the `ahel-issues/open` event.
 */
import type { Context } from '@ahel/cordis'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type { WorkspaceView } from '@ahel/dsh-api-workspace-controller/client'
import type { SessionListState } from '@ahel/dsh-api-session-controller/client'
import type { SessionId } from '@ahel/dsh-session/types'
import type { WorkspaceId } from '@ahel/dsh-workspace/types'
import type {} from '@ahel/dsh-ahel-account/remote'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-session/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import type { IssuesInjected } from './contract.ts'
import { createIssuesFeed, type IssuesAccount } from './feed.ts'
import { IssuesPage, NewIssuePage } from './IssuesPage.tsx'
import { IssuesPanelIcon, NewIssuePanelIcon } from './PanelIcons.tsx'
import { issueUrl, runSeed } from './model.ts'
import { startRun, type RunHost, type RunSession } from './run.ts'
import { en, NS, zh } from './locales.ts'

export type {
  AssigneeFilter, IssueDetailLoad, IssuesAnswer, IssuesFilter, IssuesInjected, IssuesPageProps, IssuesPanelIconProps, IssuesPhase,
  IssuesState,
} from './contract.ts'
export type { IssuesKey } from './locales.ts'

declare module '@ahel/cordis' {
  interface Events {
    /**
     * Show the desktop Issues panel with one issue's detail open, for example from an Inbox row.
     * @mode emit
     * @param key - the issue key, for example `AHEL-137`.
     */
    'ahel-issues/open'(key: string): void
  }
}

/** Required services: the Remote mount, slots, dictionaries and the main-panel layout. */
export const inject = ['remote', 'slots', 'locale', 'layout']

/** Main panel and sidebar row id of the Issues page. */
const ISSUES_ID = 'ahel-issues' as MainPanelId

/** Sidebar row id of New issue; its panel opens New Issue over the board. */
const NEW_ISSUE_ID = 'ahel-issue-new' as MainPanelId

/** Poll period while the window has focus. */
const POLL_MS = 60_000

/** Window focus re-reads at most this often. */
const FOCUS_REFRESH_MS = 5_000

/** Sidebar order: between Approvals (-5) and Inbox (-4). */
const NEW_ISSUE_ORDER = -4.6
const ISSUES_ORDER = -4.5

/**
 * The folder whose chats changed last, as New Session picks it.
 * @param workspaces - the folders.
 * @param sessions - the chats by id.
 * @returns its id, or undefined without folders.
 */
function recentWorkspace(workspaces: readonly WorkspaceView[], sessions: SessionListState['byId']): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Date.parse(workspace.createdAt)
    for (const id of workspace.sessionIds) latest = Math.max(latest, sessions[id]?.updatedAt ?? Number.NEGATIVE_INFINITY)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/**
 * Register the feed, the panels, the sidebar rows and Run with Ahel.
 * @param ctx - Client context with the mounted `ahelIssues` and `ahelAccount` namespaces and the Session services.
 */
function register(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  const account = async (): Promise<IssuesAccount> => {
    const result = await ctx.remote.ahelAccount.state()
    if (!result.ok || result.value.status !== 'signed-in') return { signedIn: false, role: null }
    const view = result.value
    const workspaces = view.profile?.workspaces ?? []
    const selected = view.workspace === null
      ? workspaces.length === 1 ? workspaces[0] : undefined
      : workspaces.find(row => row.id === view.workspace)
    return { signedIn: true, role: selected?.role ?? null }
  }
  const feed = createIssuesFeed(ctx.remote.ahelIssues, account)

  const runHost: RunHost = {
    openChat: async () => {
      const target = recentWorkspace(ctx.workspaces.list.getSnapshot().items, ctx.sessions.list.getSnapshot().byId)
      if (target === undefined) return null
      let opened: SessionId | undefined
      await ctx.uiWorkspace.openWorkspace(target, (id) => { opened = id })
      if (opened === undefined) return null
      const reference = ctx.sessions.retain(opened, { source: 'issueRun' })
      try {
        const { session, eventSource } = await reference.ready
        const binding: RunSession = {
          session,
          eventSource,
          send: (text) => {
            const handle = session.beginSubmission({ mode: 'queue', text, attachments: [] })
            return session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
          },
        }
        return { sessionId: opened, binding, release: () => { reference.release() } }
      } catch (error) {
        reference.release()
        throw error
      }
    },
    waiting: id => ctx.uiSession.sessionStatus.getSnapshot().get(id as SessionId)?.pendingInteraction !== undefined,
    subscribeWaiting: listener => ctx.uiSession.sessionStatus.subscribe(listener),
  }

  const openLink = (url: string): void => { if (/^https?:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer') }

  const face: IssuesInjected = {
    refresh: feed.refresh,
    setFilter: feed.setFilter,
    openIssue: feed.openIssue,
    compose: feed.compose,
    dismissOffer: feed.dismissOffer,
    create: feed.create,
    update: feed.update,
    remove: feed.remove,
    detail: feed.detail,
    comment: feed.comment,
    createProject: feed.createProject,
    run: async (issue) => {
      try {
        const started = await startRun(runHost, runSeed(issue, t), (report) => { feed.report(issue.key, report) },
          (summary) => { feed.agentComment(issue.key, summary) })
        if (started.ok) { feed.openIssue(null); return { ok: true } }
        return { ok: false, message: started.reason === 'no-workspace' ? t('noWorkspace') : started.message }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : null }
      }
    },
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId as SessionId) },
    showBoard: () => { ctx.layout.selectPanel(ISSUES_ID) },
    openLink,
    viewOnWeb: (key) => {
      void ctx.remote.ahelAccount.state().then((result) => {
        openLink(issueUrl(key, result.ok ? result.value.workspace : null))
      }).catch(() => { openLink(issueUrl(key)) })
    },
    hooks: { issues: feed.state },
  }

  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ISSUES_ID, locale: NS, inject: () => face }, IssuesPage))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NEW_ISSUE_ID, locale: NS, inject: () => face }, NewIssuePage))

  // Both rows show only while signed in.
  ctx.slots.inject('sidebar.panellist', () => {
    let dispose: (() => void) | undefined
    const reconcile = (): void => {
      const show = feed.state.getSnapshot().phase !== 'signed-out'
      if (show && dispose === undefined) {
        const offNew = ctx.slots.register({
          name: 'sidebar.panellist', id: NEW_ISSUE_ID, order: NEW_ISSUE_ORDER, locale: NS, label: () => t('newIssue'), inject: () => face,
        }, NewIssuePanelIcon)
        const offIssues = ctx.slots.register({
          name: 'sidebar.panellist', id: ISSUES_ID, order: ISSUES_ORDER, locale: NS, label: () => t('issues'), inject: () => face,
        }, IssuesPanelIcon)
        dispose = () => { offNew(); offIssues() }
      } else if (!show && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    }
    reconcile()
    const off = feed.state.subscribe(reconcile)
    return () => {
      off()
      dispose?.()
      dispose = undefined
    }
  })

  ctx.on('ahel-issues/open', (key) => {
    feed.openIssue(key)
    ctx.layout.selectPanel(ISSUES_ID)
  })

  // Reads: now, every 60 s while focused, and on focus.
  let lastRead = 0
  const read = (): void => {
    lastRead = Date.now()
    feed.refresh()
  }
  read()
  ctx.effect(() => {
    const timer = setInterval(() => { if (document.hasFocus()) read() }, POLL_MS)
    const onFocus = (): void => { if (Date.now() - lastRead >= FOCUS_REFRESH_MS) read() }
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, 'ui-issues: poll')
}

/**
 * Register dictionaries, then the UI once the Ahel account's Remote namespaces and the Session services are ready.
 * @param ctx - Client runtime.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-issues: dictionaries')
  ctx.inject(['remote.ahelIssues', 'remote.ahelAccount', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession'], (inner) => { register(inner) })
}
