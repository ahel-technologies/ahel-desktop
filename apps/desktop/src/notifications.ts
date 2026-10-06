/**
 * System notifications posted from the main process for the application document. macOS asks
 * the person for notification permission through its own dialog the first time one is shown;
 * Do Not Disturb and Focus filter them in the operating system. A click raises the window that
 * asked and reports the target it named (a Session, or a main panel) back to that document.
 */
import { BrowserWindow, Notification, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { assertDesktopSender } from './ipc.ts'

/** IPC channels shared with `preload-notifications.ts`. */
export const NOTIFICATION_IPC = {
  show: 'dsh-desktop:notification-show',
  clicked: 'dsh-desktop:notification-clicked',
} as const

/** Longest title or body accepted from the renderer. */
const MAX_TEXT = 512

/** Notifications kept alive until clicked or closed, so their click handlers are not collected. */
const live = new Set<Notification>()

interface NotificationRequest {
  readonly title: string
  readonly body: string
  readonly target: string
}

function parseRequest(input: unknown): NotificationRequest {
  const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const { title, body, target } = value
  if (typeof title !== 'string' || typeof body !== 'string' || typeof target !== 'string' || target === '' || target.length > MAX_TEXT) {
    throw new Error('dsh desktop: a notification needs a title, a body and a click target')
  }
  return { title: title.slice(0, MAX_TEXT), body: body.slice(0, MAX_TEXT), target }
}

function raise(sender: WebContents): void {
  const window = BrowserWindow.fromWebContents(sender)
  if (window === null || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Show one notification for the application main frame.
 * @param event - IPC caller; only the `ahel-app://app` main frame may post.
 * @param input - title, body and the target a click opens.
 * @returns whether the platform supports notifications.
 */
export function showNotification(event: IpcMainInvokeEvent, input: unknown): boolean {
  assertDesktopSender(event, ['app'])
  if (event.senderFrame !== event.sender.mainFrame) throw new Error('dsh desktop: rejected notification from a subframe')
  const request = parseRequest(input)
  if (!Notification.isSupported()) return false
  const sender = event.sender
  const note = new Notification({ title: request.title, body: request.body })
  live.add(note)
  note.on('click', () => {
    live.delete(note)
    if (sender.isDestroyed()) return
    raise(sender)
    sender.send(NOTIFICATION_IPC.clicked, request.target)
  })
  note.on('close', () => { live.delete(note) })
  note.show()
  return true
}

/** Register the notification IPC handler; call once before the application window loads. */
export function installDesktopNotifications(): void {
  ipcMain.handle(NOTIFICATION_IPC.show, showNotification)
}
