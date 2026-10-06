/** Preload half of the notification bridge: `window.dshDesktopNotifications` for the application main frame. */
import { contextBridge, ipcRenderer } from 'electron'
import { NOTIFICATION_IPC } from './notifications.ts'

/** Bridge shape read by `@ahel/dsh-client-ui-notifications`. */
export interface DesktopNotificationsBridge {
  show(note: { title: string; body: string; target: string }): Promise<boolean>
  onClick(listener: (target: string) => void): () => void
}

/**
 * Create the bridge over the main-process notification channels.
 * @returns the bridge.
 */
export function createNotificationsBridge(): DesktopNotificationsBridge {
  return {
    show: note => ipcRenderer.invoke(NOTIFICATION_IPC.show, {
      title: note.title, body: note.body, target: note.target,
    }) as Promise<boolean>,
    onClick: (listener) => {
      const handle = (_event: Electron.IpcRendererEvent, target: unknown): void => {
        if (typeof target === 'string') listener(target)
      }
      ipcRenderer.on(NOTIFICATION_IPC.clicked, handle)
      return () => { ipcRenderer.off(NOTIFICATION_IPC.clicked, handle) }
    },
  }
}

if (location.protocol === 'ahel-app:' && location.hostname === 'app' && process.isMainFrame) {
  contextBridge.exposeInMainWorld('dshDesktopNotifications', createNotificationsBridge())
}
