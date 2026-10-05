vi.mock('../src/web-document.ts', () => ({ authenticateWebHost: async () => 'test-cookie', serveWebDocument: vi.fn(), forwardWebRequest: vi.fn() }))
/** Welcome startup reads the ahel.ai account from the Host before transitioning to the workspace; it never gates it. */

import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'
import type { DesktopLocale } from '../src/locale.ts'
import type { WelcomeOperations } from '../src/welcome-api.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'

const state = vi.hoisted(() => ({
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  dialogLocale: undefined as (() => DesktopLocale) | undefined,
  beforeRead: vi.fn(async () => {}),
  beforeWelcome: vi.fn(async () => {}),
  seen: false,
  markers: [] as string[],
  quit: vi.fn(),
  startHost: vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:3080/?token=test', injections: [] }),
  stopHost: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  loadWorkspace: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
  showWorkspace: vi.fn(),
  showInactiveWorkspace: vi.fn(),
  focusWorkspace: vi.fn(),
  moveTopWorkspace: vi.fn(),
  openDevTools: vi.fn(),
  closeWelcome: vi.fn(),
  welcomeLocale: undefined as DesktopLocale | undefined,
  preference: 'zh',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  contents: undefined as { mainFrame: { url: string } } | undefined,
  windowOptions: undefined as BrowserWindowConstructorOptions | undefined,
  menu: vi.fn(),
  operations: undefined as WelcomeOperations | undefined,
  closedWelcome: undefined as (() => void) | undefined,
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
}))

vi.mock('../src/crash-report.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/crash-report.ts')>(),
  writeCrashReport: vi.fn(async () => undefined),
  pruneCrashReports: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    name: 'Harness',
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: vi.fn(),
    whenReady: () => Promise.resolve(),
    getLocale: () => 'en',
    getVersion: () => '1.0.0',
    setAboutPanelOptions: vi.fn(),
    getAppPath: () => '/development-app',
    getPath: (name: string) => name === 'userData' ? '/desktop-user-data' : `/development-${name}`,
    setAppLogsPath: vi.fn(),
    setName: vi.fn(),
    getPreferredSystemLanguages: () => ['en-US'],
    on: (name: string, callback: (...args: unknown[]) => void) => { state.appListeners.set(name, callback) },
    quit: state.quit,
    exit: vi.fn(),
  },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: class {
    constructor(options: BrowserWindowConstructorOptions) { state.windowOptions = options }
    private ready: (() => void) | undefined
    webContents = { mainFrame: { url: 'ahel-app://app/' }, setWindowOpenHandler: vi.fn(),
      on: vi.fn(), once: vi.fn(), send: vi.fn(), openDevTools: state.openDevTools }
    static getAllWindows() { return [] }
    once(name: string, callback: () => void) { if (name === 'ready-to-show') this.ready = callback; return this }
    on() { return this }
    isDestroyed() { return false }
    isMinimized() { return false }
    restore = vi.fn()
    focus = state.focusWorkspace
    moveTop = state.moveTopWorkspace
    hide = vi.fn()
    show = state.showWorkspace
    showInactive = state.showInactiveWorkspace
    async loadURL(url: string) { state.contents = this.webContents; await state.loadWorkspace(url); this.ready?.() }
  },
  net: { fetch: vi.fn() },
  nativeTheme: state.nativeTheme,
  session: { defaultSession: {
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeSendHeaders: vi.fn() },
  } },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  ipcMain: {
    handle: (name: string, callback: (...args: unknown[]) => unknown) => { state.handlers.set(name, callback) },
    on: (name: string, callback: (...args: unknown[]) => void) => { state.listeners.set(name, callback) },
  },
  dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: state.menu, setApplicationMenu: vi.fn() },
  nativeImage: { createFromPath: (path: string) => ({ path }) },
}))
// The Windows tray relabels through Menu as well; keep the menu call counts below platform-neutral.
vi.mock('../src/tray.ts', () => ({ DesktopTray: class { relabel() {} dispose() {} } }))

vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ profile: '/profile' }) }))
vi.mock('../src/login-shell-environment.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/login-shell-environment.ts')>(),
  readDesktopLoginShellEnvironment: async (base: NodeJS.ProcessEnv) => ({ environment: base, failures: [] }),
}))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
  applyRelease = vi.fn(async () => {})
  canRecoverProfile = vi.fn(() => true)
} }))
vi.mock('../src/host-process.ts', () => ({
  DesktopHostProcess: class {
    start = state.startHost
    stop = state.stopHost
  },
}))
vi.mock('../src/host-settings.ts', () => ({
  connectDesktopHostSettings: async () => ({
    readLocalePreference: async () => {
      await state.beforeRead()
      return state.preference
    },
  }),
}))
vi.mock('../src/ahel-account-backend.ts', () => ({
  browserDestination: (url: string) => url,
  connectDesktopAhelAccount: async () => ({
    state: async () => ({ status: state.seen ? 'signed-in' : 'signed-out', profile: null, attempt: null }),
  }),
}))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  writeFile: vi.fn(async (path: string) => { state.markers.push(path) }),
}))
vi.mock('../src/update-dialog.ts', () => ({ DesktopUpdateDialog: class {
  constructor(_preload: string, locale: () => DesktopLocale) { state.dialogLocale = locale }
  dispose() {}
} }))
vi.mock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: class {
  state = { phase: 'idle' }
  check = vi.fn(async () => this.state)
  dispose = vi.fn()
} }))
vi.mock('../src/welcome-window.ts', () => ({
  openWelcomeWindow: async (locale: DesktopLocale, operations: WelcomeOperations) => {
    state.welcomeLocale = locale
    state.operations = operations
    await state.beforeWelcome()
    const window = { once: vi.fn((name: string, callback: () => void) => { if (name === 'closed') state.closedWelcome = callback }),
      close: state.closeWelcome, isDestroyed: () => false, show: vi.fn(), focus: vi.fn(), webContents: { send: vi.fn() } }
    return window
  },
}))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubDevelopmentEnvironment(): void {
  vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3')
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '/development-profile')
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', '/runtime/node')
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', '/runtime/pnpm')
  vi.stubEnv('DSH_DESKTOP_DSH_DIR', '/runtime/dsh')
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', undefined)
  vi.stubEnv('DSH_DESKTOP_OPEN_DEVTOOLS', '0')
  vi.stubEnv('DSH_DESKTOP_UPDATE_JOURNAL_DIR', undefined)
}

function reset(seen: boolean): void {
  vi.resetModules()
  vi.clearAllMocks()
  state.preference = 'zh'
  state.seen = seen
  state.markers = []
  state.operations = undefined
  state.closedWelcome = undefined
}

it.each([false, true])('shows the first-launch welcome without carrying update focus into Continue (Windows update=%s)', async (updated) => {
  reset(false)
  if (updated) vi.stubGlobal('process', { ...process, platform: 'win32', argv: ['desktop', '--updated'] })
  vi.useFakeTimers()
  stubDevelopmentEnvironment()
  const reading = Promise.withResolvers<undefined>()
  const loading = Promise.withResolvers<undefined>()
  state.beforeRead.mockReturnValueOnce(reading.promise)
  state.beforeWelcome.mockReturnValueOnce(loading.promise)
  const activate = () => {
    state.appListeners.get('second-instance')!()
    state.appListeners.get('open-url')!({ preventDefault: vi.fn() }, 'ahel://open')
  }
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.beforeRead).toHaveBeenCalledOnce() })
  try {
    activate()
    expect(state.showWorkspace).not.toHaveBeenCalled()
    reading.resolve(undefined)
    await vi.waitFor(() => { expect(state.beforeWelcome).toHaveBeenCalledOnce() })
    activate()
    expect(state.showWorkspace).not.toHaveBeenCalled()
  } finally {
    reading.resolve(undefined)
    loading.resolve(undefined)
  }
  await vi.waitFor(() => { expect(state.operations).toBeDefined() })
  expect(state.startHost).toHaveBeenCalledOnce()
  expect(state.loadWorkspace).toHaveBeenCalledExactlyOnceWith('ahel-app://app/')
  expect(state.showWorkspace).not.toHaveBeenCalled()
  state.loadWorkspace.mockClear()
  expect(state.welcomeLocale).toMatchObject({ id: 'zh-CN' })
  expect(state.dialogLocale!().id).toBe('zh-CN')
  await state.operations!.continue()
  expect(state.markers).toEqual([])
  expect(state.loadWorkspace).not.toHaveBeenCalled()
  expect(state.showWorkspace).toHaveBeenCalledOnce()
  expect(state.moveTopWorkspace).not.toHaveBeenCalled()
  expect(state.focusWorkspace).not.toHaveBeenCalled()
  expect(state.windowOptions).toMatchObject({
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 }, vibrancy: 'sidebar' } : {}),
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  expect(state.closeWelcome).toHaveBeenCalledOnce()
  state.closedWelcome!()
  expect(state.showWorkspace).toHaveBeenCalledOnce()
  activate()
  expect(state.showWorkspace).toHaveBeenCalledTimes(3)
  expect(state.quit).not.toHaveBeenCalled()
  expect(state.stopHost).not.toHaveBeenCalled()
  const contents = state.contents as { mainFrame: { url: string }; send: ReturnType<typeof vi.fn> }
  expect(contents.send).toHaveBeenCalledWith(DESKTOP_IPC.enterWorkspace)
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const bootstrap = state.handlers.get(DESKTOP_IPC.localeBootstrap)!
  expect(await bootstrap(event)).toEqual({ languages: ['en-US'], preference: 'zh' })
  state.preference = 'en'
  expect(await bootstrap(event)).toEqual({ languages: ['en-US'], preference: 'en' })
  const changed = state.listeners.get(DESKTOP_IPC.localeChanged)!
  const initialMenus = state.menu.mock.calls.length
  changed({ ...event, senderFrame: {} }, 'en')
  changed(event, 42)
  expect(state.menu).toHaveBeenCalledTimes(initialMenus)
  changed(event, 'en')
  expect(state.dialogLocale!().id).toBe('en')
  expect(state.menu).toHaveBeenCalledTimes(initialMenus + 1)
})

it('opens the workspace when the welcome is closed instead of quitting', async () => {
  reset(false)
  stubDevelopmentEnvironment()
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.operations).toBeDefined() })
  expect(state.showWorkspace).not.toHaveBeenCalled()
  state.closedWelcome!()
  await vi.waitFor(() => { expect(state.showWorkspace).toHaveBeenCalledOnce() })
  expect(state.markers).toEqual([])
  expect(state.quit).not.toHaveBeenCalled()
})

it('opens the workspace directly when the ahel.ai account is signed in', async () => {
  reset(true)
  stubDevelopmentEnvironment()
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.showWorkspace).toHaveBeenCalledOnce() })
  expect(state.beforeWelcome).not.toHaveBeenCalled()
  expect(state.operations).toBeUndefined()
  expect(state.markers).toEqual([])
})
