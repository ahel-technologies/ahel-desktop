/** Platform notification sinks: the Ahel Desktop main-process bridge, else the Web Notification API. */
import type { Notifier, SystemNotification } from './watcher.ts'

/** Bridge the Desktop preload exposes as `window.dshDesktopNotifications`. */
export interface DesktopNotificationsBridge {
  show(note: { title: string; body: string; target: string }): Promise<boolean>
  onClick(listener: (target: string) => void): () => void
}

/**
 * Wrap the Desktop bridge: Electron posts the notification from the main process, asks
 * macOS for permission on first use, and on click raises the window before reporting it.
 * @param bridge - preload bridge.
 * @returns the notifier.
 */
export function desktopNotifier(bridge: DesktopNotificationsBridge): Notifier {
  return {
    show: (note) => {
      void bridge.show({ title: note.title, body: note.body, target: note.target }).catch((error: unknown) => {
        console.warn('[ui-notifications] desktop notification failed:', error)
      })
    },
    onClick: listener => bridge.onClick(listener),
  }
}

/**
 * Wrap the Web Notification API for browser clients. Permission is asked on the first
 * notification; a denied or unsupported browser shows nothing.
 * @param api - the `Notification` constructor.
 * @param focus - raises the page on click.
 * @returns the notifier.
 */
export function webNotifier(api: typeof Notification, focus: () => void): Notifier {
  const listeners = new Set<(target: string) => void>()
  const post = (note: SystemNotification): void => {
    const shown = new api(note.title, { body: note.body, tag: note.target })
    shown.onclick = () => {
      focus()
      for (const listener of listeners) listener(note.target)
      shown.close()
    }
  }
  return {
    show: (note) => {
      if (api.permission === 'granted') { post(note); return }
      if (api.permission !== 'default') return
      void api.requestPermission().then((answer) => { if (answer === 'granted') post(note) }, () => undefined)
    },
    onClick: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Sink for a runtime with no notification support. */
export const silentNotifier: Notifier = { show: () => undefined, onClick: () => () => undefined }

/**
 * Pick the platform sink for this page.
 * @param host - the page global.
 * @returns the Desktop bridge when present, else Web notifications, else nothing.
 */
export function platformNotifier(host: typeof globalThis): Notifier {
  const bridge = (host as { dshDesktopNotifications?: DesktopNotificationsBridge }).dshDesktopNotifications
  if (bridge !== undefined) return desktopNotifier(bridge)
  if (typeof host.Notification === 'function') return webNotifier(host.Notification, () => { host.focus() })
  return silentNotifier
}
