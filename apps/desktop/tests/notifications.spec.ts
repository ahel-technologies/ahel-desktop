import { beforeEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const posted: { options: { title: string; body: string }; listeners: Map<string, () => void>; shown: boolean }[] = []
  class FakeNotification {
    static isSupported = vi.fn(() => true)
    private readonly record: (typeof posted)[number]
    constructor(options: { title: string; body: string }) {
      this.record = { options, listeners: new Map(), shown: false }
      posted.push(this.record)
    }
    on(event: string, listener: () => void): this { this.record.listeners.set(event, listener); return this }
    show(): void { this.record.shown = true }
  }
  const window = { isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  return {
    posted,
    window,
    module: {
      Notification: FakeNotification,
      BrowserWindow: { fromWebContents: vi.fn(() => window) },
      ipcMain: { handle: vi.fn() },
    },
  }
})
vi.mock('electron', () => electron.module)

const { NOTIFICATION_IPC, installDesktopNotifications, showNotification } = await import('../src/notifications.ts')

function invokeEvent(url: string) {
  const mainFrame = { url }
  const sender = { mainFrame, isDestroyed: () => false, send: vi.fn() }
  return { sender, senderFrame: mainFrame } as unknown as Parameters<typeof showNotification>[0] & { sender: typeof sender }
}

beforeEach(() => { electron.posted.length = 0; vi.clearAllMocks() })

it('registers one invoke handler', () => {
  installDesktopNotifications()
  expect(electron.module.ipcMain.handle).toHaveBeenCalledWith(NOTIFICATION_IPC.show, showNotification)
})

it('posts a system notification and, on click, raises the window and opens the Session', () => {
  const event = invokeEvent('ahel-app://app/index.html')
  expect(showNotification(event, { title: 'Quarterly report', body: 'Reply ready', target: 'session-a' })).toBe(true)
  expect(electron.posted).toHaveLength(1)
  expect(electron.posted[0]?.options).toEqual({ title: 'Quarterly report', body: 'Reply ready' })
  expect(electron.posted[0]?.shown).toBe(true)

  electron.posted[0]?.listeners.get('click')?.()
  expect(electron.window.restore).toHaveBeenCalled()
  expect(electron.window.show).toHaveBeenCalled()
  expect(electron.window.focus).toHaveBeenCalled()
  expect(event.sender.send).toHaveBeenCalledWith(NOTIFICATION_IPC.clicked, 'session-a')
})

it('rejects other documents and malformed requests', () => {
  expect(() => showNotification(invokeEvent('https://example.com/'), { title: 'x', body: '', target: 's' })).toThrow()
  expect(() => showNotification(invokeEvent('ahel-app://app/'), { title: 'x' })).toThrow()
  expect(electron.posted).toHaveLength(0)
})
