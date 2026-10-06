/** The desktop push-to-talk shortcut: the shell's bridge and the composer that answers it. */

/** Shortcut state the desktop shell reports. */
export interface DictationHotkeyState {
  /** Electron accelerator, or null while the shortcut is off. */
  readonly accelerator: string | null
  /** False when another application holds the accelerator. */
  readonly registered: boolean
}

/** `window.dshDesktop.dictation`, present only in Ahel Desktop's product window. */
export interface DesktopDictationBridge {
  get(): Promise<DictationHotkeyState>
  set(accelerator: string | null): Promise<DictationHotkeyState>
  /** @returns a disposer; the listener runs each time the shortcut is pressed. */
  onToggle(listener: () => void): () => void
}

/** Accelerators offered in Settings; the shell accepts no others. */
export const DICTATION_ACCELERATORS: readonly string[] = [
  'CommandOrControl+Shift+Space', 'CommandOrControl+Alt+Space', 'CommandOrControl+Shift+D',
]

/** @returns the desktop bridge, or undefined in a browser. */
export function desktopDictation(): DesktopDictationBridge | undefined {
  return (globalThis as typeof globalThis & { dshDesktop?: { dictation?: DesktopDictationBridge } }).dshDesktop?.dictation
}

/**
 * Show an accelerator the way the platform writes shortcuts.
 * @param accelerator - Electron accelerator.
 * @param mac - whether to use macOS symbols.
 * @returns e.g. `⌘⇧Space` or `Ctrl+Shift+Space`.
 */
export function presentAccelerator(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+')
  if (!mac) return parts.map(part => part === 'CommandOrControl' ? 'Ctrl' : part).join('+')
  const symbols: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
  return parts.map(part => symbols[part] ?? part).join('')
}

/** One mounted composer able to start or stop a recording. */
interface Answerer {
  /** Whether this composer is on screen. */
  visible(): boolean
  toggle(): void
}

/**
 * Routes each shortcut press to the most recently mounted composer that is
 * on screen, so a press never starts two recordings.
 */
export class DictationToggles {
  private readonly answerers: Answerer[] = []

  /** @returns a disposer removing the composer. */
  add(answerer: Answerer): () => void {
    this.answerers.push(answerer)
    return () => {
      const at = this.answerers.indexOf(answerer)
      if (at >= 0) this.answerers.splice(at, 1)
    }
  }

  /** Toggle the front composer; a press with none on screen does nothing. */
  press(): void {
    const front = this.answerers.findLast(answerer => answerer.visible())
    front?.toggle()
  }
}
