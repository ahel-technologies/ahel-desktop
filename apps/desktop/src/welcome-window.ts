/** Native welcome window and its presentation-only renderer. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeNotice, type WelcomeOperations } from './welcome-api.ts'

/**
 * Resolve the fixed-size welcome window's native material and controls.
 * @param platform - operating system hosting Electron.
 * @param locale - shell-owned localized copy.
 * @param notice - why the welcome opened, shown above the sign-in button.
 * @returns sandboxed window options with a locale-and-notice-only preload.
 */
export function welcomeWindowOptions(
  platform: NodeJS.Platform, locale: DesktopLocale, notice: WelcomeNotice | null = null,
): BrowserWindowConstructorOptions {
  return {
    width: 600,
    height: 700,
    useContentSize: true,
    center: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: locale.messages.welcomeTitle,
    backgroundColor: platform === 'darwin' || platform === 'win32' ? '#00000000' : '#FFFFFF',
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 21, y: 21 },
      vibrancy: 'menu',
      visualEffectState: 'active',
    } as const : {}),
    ...(platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#0F1115', height: 42 },
      backgroundMaterial: 'acrylic',
    } as const : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload-welcome.cjs', import.meta.url)),
      additionalArguments: [`--ahel-welcome-locale=${locale.id}`, ...notice === null ? [] : [`--ahel-welcome-notice=${notice}`]],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  }
}

let disposeActiveHandlers: (() => void) | undefined

/**
 * Open the process's sole welcome window with desktop-owned operations.
 * Replaces IPC ownership immediately; the caller closes the previous native window.
 * @param locale - shell-owned localized copy.
 * @param operations - the sign-in and cancel actions.
 * @param notice - why the welcome opened, or null.
 * @returns the visible window; a failed load destroys it before rejecting.
 */
export async function openWelcomeWindow(
  locale: DesktopLocale, operations: WelcomeOperations, notice: WelcomeNotice | null = null,
): Promise<BrowserWindow> {
  const options = welcomeWindowOptions(process.platform, locale, notice)
  const window = new BrowserWindow(options)
  disposeActiveHandlers?.()
  let active = true
  const disposeHandlers = (): void => {
    if (!active) return
    active = false
    ipcMain.removeHandler(WELCOME_IPC.signIn)
    ipcMain.removeHandler(WELCOME_IPC.cancelSignIn)
    disposeActiveHandlers = undefined
  }
  disposeActiveHandlers = disposeHandlers
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!active || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('desktop welcome: rejected action from an unowned frame')
    }
  }
  ipcMain.handle(WELCOME_IPC.signIn, async (event) => {
    assertSender(event)
    await operations.signIn()
  })
  ipcMain.handle(WELCOME_IPC.cancelSignIn, async (event) => {
    assertSender(event)
    await operations.cancelSignIn()
  })
  window.once('closed', disposeHandlers)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(join(app.getAppPath(), 'renderer', 'welcome.html'))
  } catch (error) {
    disposeHandlers()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Another window can replace ownership during loadFile.
  if (active && !window.isDestroyed()) window.show()
  return window
}
