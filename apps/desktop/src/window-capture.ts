/**
 * Window capture in the Electron shell: the global shortcut (default
 * Cmd+Shift+2), the capture of the front window that is not Ahel Desktop's
 * own, and the IPC the composer plugin `dsh-client-ui-window-capture` reaches
 * through the preload bridge. macOS only; elsewhere the shortcut stays
 * unregistered and the Settings row says so.
 *
 * Capture runs through `dsh-window-capture` (`screencapture -l`, the
 * CoreGraphics window list and Accessibility text when already trusted).
 * Missing Screen Recording raises the system dialog once, then opens System
 * Settings > Privacy & Security > Screen Recording; nothing here opens a
 * Keychain or password prompt.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type BrowserWindow, desktopCapturer, globalShortcut, ipcMain, nativeImage, shell, systemPreferences, type IpcMainInvokeEvent,
} from 'electron'
import { writeFileAtomic } from '@ahel/dsh-atomic-write'
import { captureFrontWindow, macWindowCapturer } from '@ahel/dsh-window-capture'
import {
  DEFAULT_WINDOW_CAPTURE_ACCELERATOR, type WindowCaptureResult, type WindowCaptureShortcut, type WindowCaptureShortcutResult,
} from '@ahel/dsh-window-capture/protocol'
import { DESKTOP_IPC, assertDesktopSender } from './ipc.ts'

/** Longest image edge sent to the model; larger captures are scaled down. */
const MAX_IMAGE_EDGE = 2000
/** Visible-text length limit. */
const MAX_TEXT_CHARS = 20_000
const MAC_TIMEOUTS = { lookupMs: 5000, screenshotMs: 15_000, textMs: 3000 }
const SCREEN_RECORDING_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/** What the shell gives the capture feature. */
export interface DesktopWindowCaptureOptions {
  /** Current product window. */
  readonly getWindow: () => BrowserWindow | undefined
  /** Show and focus the product window, creating it when it is gone. */
  readonly focus: () => void
  /** Electron userData directory holding `window-capture.json`. */
  readonly userData: string
}

function scaled(png: Uint8Array): Uint8Array {
  const image = nativeImage.createFromBuffer(Buffer.from(png))
  const size = image.getSize()
  const scale = Math.min(MAX_IMAGE_EDGE / size.width, MAX_IMAGE_EDGE / size.height, 1)
  if (image.isEmpty() || scale >= 1) return png
  return new Uint8Array(image.resize({
    width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best',
  }).toPNG())
}

async function readAccelerator(path: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'accelerator' in parsed) {
      const { accelerator } = parsed
      if (accelerator === null || typeof accelerator === 'string') return accelerator
    }
  } catch (error) {
    // A missing or unreadable preference file means the default shortcut.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('dsh desktop: window-capture.json ignored:', error)
  }
  return DEFAULT_WINDOW_CAPTURE_ACCELERATOR
}

/**
 * Register the global shortcut and the capture IPC.
 * @param options - window access, focus and the preference directory.
 * @returns teardown that releases the shortcut and the IPC handlers.
 */
export async function installDesktopWindowCapture(options: DesktopWindowCaptureOptions): Promise<{ dispose(): void }> {
  const path = join(options.userData, 'window-capture.json')
  const supported = process.platform === 'darwin'
  const capturer = supported ? macWindowCapturer(MAC_TIMEOUTS) : undefined
  let accelerator = await readAccelerator(path)
  let registered = false
  let pending: WindowCaptureResult | null = null
  let running: Promise<WindowCaptureResult> | undefined

  const capture = (): Promise<WindowCaptureResult> => running ??= (async (): Promise<WindowCaptureResult> => {
    if (capturer === undefined) return { ok: false, reason: 'unsupported' }
    const status = systemPreferences.getMediaAccessStatus('screen')
    if (status === 'not-determined') {
      // Raises the system Screen Recording dialog once; the answer applies to the next capture.
      await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined)
      return { ok: false, reason: 'permission' }
    }
    if (status !== 'granted') {
      void shell.openExternal(SCREEN_RECORDING_SETTINGS).catch(() => undefined)
      return { ok: false, reason: 'permission' }
    }
    const result = await captureFrontWindow(capturer, { excludeProcessIds: [process.pid], maxTextChars: MAX_TEXT_CHARS })
    return result.ok ? { ok: true, capture: { ...result.capture, png: scaled(result.capture.png) } } : result
  })().finally(() => { running = undefined })

  const onShortcut = (): void => {
    void capture().then((result) => {
      pending = result
      options.focus()
      const window = options.getWindow()
      if (window !== undefined && !window.isDestroyed()) window.webContents.send(DESKTOP_IPC.windowCaptured)
    }, (error: unknown) => { console.error('dsh desktop: window capture failed:', error) })
  }

  const state = (): WindowCaptureShortcut => ({
    supported, accelerator, defaultAccelerator: DEFAULT_WINDOW_CAPTURE_ACCELERATOR, registered,
  })
  /** @returns `taken` when another application holds the keys, `invalid` when Electron cannot parse them. */
  const register = (next: string | null): 'ok' | 'taken' | 'invalid' => {
    if (accelerator !== null && registered) globalShortcut.unregister(accelerator)
    registered = false
    accelerator = next
    if (next === null || !supported) return 'ok'
    try {
      registered = globalShortcut.register(next, onShortcut)
    } catch (_invalid) {
      // Electron throws on an accelerator it cannot parse.
      return 'invalid'
    }
    return registered ? 'ok' : 'taken'
  }
  register(accelerator)

  const owned = (event: IpcMainInvokeEvent): void => {
    const window = options.getWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('dsh desktop: rejected window capture from an unowned renderer')
    }
    assertDesktopSender(event, ['app'])
  }
  ipcMain.handle(DESKTOP_IPC.windowCaptureShortcut, (event) => { owned(event); return state() })
  ipcMain.handle(DESKTOP_IPC.windowCaptureSetShortcut, async (event, next: unknown): Promise<WindowCaptureShortcutResult> => {
    owned(event)
    if (!supported || (next !== null && (typeof next !== 'string' || next.length > 64))) return { ok: false, reason: 'invalid', shortcut: state() }
    const previous = accelerator
    if (next === previous && (next === null || registered)) return { ok: true, shortcut: state() }
    const outcome = register(next)
    if (outcome !== 'ok') {
      register(previous)
      return { ok: false, reason: outcome, shortcut: state() }
    }
    await writeFileAtomic(path, `${JSON.stringify({ accelerator: next })}\n`, { mode: 0o600, dirMode: 0o700 })
    return { ok: true, shortcut: state() }
  })
  ipcMain.handle(DESKTOP_IPC.windowCaptureNow, async (event) => { owned(event); return await capture() })
  ipcMain.handle(DESKTOP_IPC.windowCaptureTake, (event) => {
    owned(event)
    const result = pending
    pending = null
    return result
  })

  return {
    dispose: () => {
      if (accelerator !== null && registered) globalShortcut.unregister(accelerator)
      registered = false
      for (const channel of [DESKTOP_IPC.windowCaptureShortcut, DESKTOP_IPC.windowCaptureSetShortcut,
        DESKTOP_IPC.windowCaptureNow, DESKTOP_IPC.windowCaptureTake]) ipcMain.removeHandler(channel)
    },
  }
}
