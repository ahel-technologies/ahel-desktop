/** The push-to-talk shortcut: one global accelerator that brings Ahel forward and starts or stops dictation. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { globalShortcut, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFileAtomic } from '@ahel/dsh-atomic-write'
import { DESKTOP_IPC } from './ipc.ts'

/** Accelerators offered in Settings > General > Dictation; no other value is accepted. */
export const DICTATION_ACCELERATORS: readonly string[] = [
  'CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space', 'CommandOrControl+Shift+D',
]
/** The shortcut before the person chooses one: Cmd+Shift+Space on macOS, Ctrl+Shift+Space elsewhere. */
export const DEFAULT_DICTATION_ACCELERATOR = 'CommandOrControl+Shift+Space'

/** What the product window is told about the shortcut. */
export interface DictationHotkeyState {
  readonly accelerator: string | null
  /** False when another application holds the accelerator. */
  readonly registered: boolean
}

/** The global-shortcut calls this module makes; tests pass a fake. */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * Read the saved choice: an offered accelerator, null for off, the default when unset or unreadable.
 * @param raw - `dictation.json` text, or null when absent.
 * @returns the accelerator to register.
 */
export function parseDictationPreference(raw: string | null): string | null {
  if (raw === null) return DEFAULT_DICTATION_ACCELERATOR
  try {
    const value: unknown = (JSON.parse(raw) as { accelerator?: unknown }).accelerator
    if (value === null) return null
    return typeof value === 'string' && DICTATION_ACCELERATORS.includes(value) ? value : DEFAULT_DICTATION_ACCELERATOR
  } catch (_unreadable) {
    return DEFAULT_DICTATION_ACCELERATOR
  }
}

/**
 * Own the shortcut: register the saved accelerator, answer the product window's get and set, and press `toggle`.
 * @param userData - Electron userData; the choice is saved in `dictation.json` there.
 * @param toggle - runs on every press: focus the window and start or stop a recording.
 * @param assertSender - rejects IPC from anything but the product window.
 * @param registry - global shortcut registry.
 * @returns a disposer that releases the accelerator.
 */
export function installDictationHotkey(userData: string, toggle: () => void, assertSender: (event: IpcMainInvokeEvent) => void,
  registry: ShortcutRegistry = globalShortcut): { ready: Promise<void>; dispose(): void } {
  const path = join(userData, 'dictation.json')
  let state: DictationHotkeyState = { accelerator: null, registered: false }
  const apply = (accelerator: string | null): DictationHotkeyState => {
    if (state.accelerator !== null && state.registered) registry.unregister(state.accelerator)
    let registered = false
    if (accelerator !== null) {
      try { registered = registry.register(accelerator, toggle) } catch (_refused) { registered = false }
    }
    state = { accelerator, registered }
    return state
  }
  const ready = readFile(path, 'utf8').then(raw => raw, (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }).then((raw) => { apply(parseDictationPreference(raw)) }, () => { apply(DEFAULT_DICTATION_ACCELERATOR) })
  ipcMain.handle(DESKTOP_IPC.dictationGet, async (event) => {
    assertSender(event)
    await ready
    return state
  })
  ipcMain.handle(DESKTOP_IPC.dictationSet, async (event, value: unknown) => {
    assertSender(event)
    await ready
    if (value !== null && (typeof value !== 'string' || !DICTATION_ACCELERATORS.includes(value))) {
      throw new Error('dsh desktop: unknown dictation shortcut')
    }
    await writeFileAtomic(path, `${JSON.stringify({ accelerator: value })}\n`, { mode: 0o600, dirMode: 0o700 })
    return apply(value)
  })
  return {
    ready,
    dispose: () => {
      ipcMain.removeHandler(DESKTOP_IPC.dictationGet)
      ipcMain.removeHandler(DESKTOP_IPC.dictationSet)
      if (state.accelerator !== null && state.registered) registry.unregister(state.accelerator)
      state = { accelerator: state.accelerator, registered: false }
    },
  }
}
