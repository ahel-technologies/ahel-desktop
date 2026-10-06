/**
 * System notifications when a chat needs the person and the window is not focused: a reply
 * is ready, an approval or question card is waiting, or a teammate handed over a chat.
 * Ahel Desktop posts them from the Electron main process; a browser uses Web notifications.
 */
import type { Context as ClientContext } from '@ahel/cordis'
import type { SessionId } from '@ahel/dsh-session/types'
import { createSnapshotStore } from '@ahel/dsh-client-store'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-api-session-controller/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-session/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import { en, NS, zh, type NotificationsKey } from './locales.ts'
import { InboxNotifications } from './inbox.ts'
import { platformNotifier } from './notifier.ts'
import { inboxReader, lastResponse, normalizeSettings, text, waitOf } from './reading.ts'
import { NotificationsRow, type NotificationsRowInjected } from './NotificationsRow.tsx'
import { DEFAULT_SETTINGS, SessionNotifications, type NotificationSettings, type PendingWait, type SystemNotification } from './watcher.ts'

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** System notification copy and its Settings row. */
    notifications: NotificationsKey
  }
}

export type { NotificationsRowInjected, NotificationsRowProps } from './NotificationsRow.tsx'

/** Required services: Session list and events, Session waits, navigation, layout, Settings slot and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'uiWorkspace', 'layout', 'slots', 'locale']

/** localStorage key of the per-device preference. */
const SETTINGS_KEY = 'dsh.ui-notifications.settings'

/** Click target prefix naming a main panel instead of a Session. */
const PANEL_PREFIX = 'panel:'

/**
 * Whether the application window has the person's attention.
 * @returns true while the document is visible and focused.
 */
function windowFocused(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Client plugin body: register copy and the Settings row, then watch Sessions and the Inbox.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-notifications: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = createSnapshotStore<NotificationSettings>(DEFAULT_SETTINGS, { persist: { name: SETTINGS_KEY } })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'notifications',
    order: 20,
    locale: NS,
    inject: (): NotificationsRowInjected => ({
      hooks: { notificationSettings: settings },
      setNotificationSettings: (next) => { settings.set(normalizeSettings(next)) },
    }),
  }, NotificationsRow))

  const row = (id: SessionId) => ctx.sessions.list.getSnapshot().byId[id]
  ctx.effect(() => {
    const notifier = platformNotifier(globalThis)
    const post = (note: SystemNotification): void => {
      if (!normalizeSettings(settings.getSnapshot()).enabled || windowFocused()) return
      notifier.show(note)
    }
    const offClick = notifier.onClick((target) => {
      if (!target.startsWith(PANEL_PREFIX)) { ctx.uiWorkspace.openSession(target as SessionId); return }
      try {
        ctx.layout.selectPanel(target.slice(PANEL_PREFIX.length) as MainPanelId)
      } catch (error) {
        console.warn('[ui-notifications] panel is not available:', error)
      }
    })

    const sessions = new SessionNotifications({
      post,
      copy: {
        replyReady: () => t('note.replyReady'),
        failed: reason => t('note.failed', { reason }),
        approval: summary => (summary === '' ? t('note.approvalPlain') : t('note.approval', { summary })),
        question: question => (question === '' ? t('note.questionPlain') : t('note.question', { question })),
      },
      notifiable: (id) => {
        const entry = row(id)
        return entry?.origin !== 'subagent' && entry?.parentId === undefined
      },
      title: id => text(row(id)?.displayTitle) ?? t('note.untitled'),
      finalResponse: id => lastResponse(ctx.sessions.list.getSnapshot().projectionsBySession[id]?.values ?? row(id)?.projectionValues),
    })
    const offStatus = ctx.remote.$on('api-session/status', (id, running) => { sessions.status(id, running) })
    const offError = ctx.remote.$on('api-session/error', (id, message) => { sessions.failed(id, message) })
    const reconcileWaits = (): void => {
      const waits = new Map<SessionId, PendingWait>()
      for (const [id, status] of ctx.uiSession.sessionStatus.getSnapshot()) {
        const interaction = status.pendingInteraction
        const wait = interaction === undefined ? undefined : waitOf(interaction, value => ctx.locale.resolveText(value))
        if (wait !== undefined) waits.set(id, wait)
      }
      sessions.pending(waits)
    }
    const offWaits = ctx.uiSession.sessionStatus.subscribe(reconcileWaits)
    reconcileWaits()

    const read = inboxReader(ctx.remote)
    const inbox = read === undefined ? undefined : new InboxNotifications({
      read,
      handoff: from => t('note.handoff', { from: from === '' ? t('note.someone') : from }),
      post,
    })
    const attention = (): void => {
      if (inbox === undefined) return
      if (windowFocused()) inbox.foreground()
      else if (normalizeSettings(settings.getSnapshot()).enabled) inbox.background()
    }
    const page = typeof window === 'undefined' ? undefined : window
    page?.addEventListener('focus', attention)
    page?.addEventListener('blur', attention)
    page?.document.addEventListener('visibilitychange', attention)
    attention()

    return () => {
      page?.removeEventListener('focus', attention)
      page?.removeEventListener('blur', attention)
      page?.document.removeEventListener('visibilitychange', attention)
      inbox?.dispose()
      offStatus()
      offError()
      offWaits()
      offClick()
      sessions.dispose()
    }
  }, 'ui-notifications: Session and Inbox watchers')
}
