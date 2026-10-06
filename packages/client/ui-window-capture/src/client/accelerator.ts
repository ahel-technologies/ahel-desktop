/** Electron accelerators recorded from key presses and shown as key labels. */

/** The key-press fields a recording reads. */
export type AcceleratorKeyEvent = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'',
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
}

function keyOf(code: string): string | undefined {
  const letter = /^Key([A-Z])$/u.exec(code)
  if (letter !== null) return letter[1]
  const digit = /^(?:Digit|Numpad)([0-9])$/u.exec(code)
  if (digit !== null) return digit[1]
  if (/^F([1-9]|1[0-9]|2[0-4])$/u.test(code)) return code
  return NAMED[code]
}

/**
 * Turn one key press into an Electron accelerator.
 * @param event - the key press.
 * @param mac - whether the Meta key is Command.
 * @returns the accelerator; `undefined` while only modifiers are down; `null` without Cmd, Ctrl or Option/Alt.
 */
export function acceleratorFromKey(event: AcceleratorKeyEvent, mac: boolean): string | null | undefined {
  const key = keyOf(event.code)
  if (key === undefined) return undefined
  if (!event.metaKey && !event.ctrlKey && !event.altKey) return null
  const parts: string[] = []
  if (event.metaKey) parts.push(mac ? 'Command' : 'Super')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  return [...parts, key].join('+')
}

const MAC_LABELS: Readonly<Record<string, string>> = {
  Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
}

/**
 * @param accelerator - Electron accelerator.
 * @param mac - whether to use macOS symbols; capture runs on macOS only, so other platforms show the accelerator parts as written.
 * @returns one label per key, in order.
 */
export function acceleratorKeys(accelerator: string, mac: boolean): string[] {
  return accelerator.split('+').map(part => (mac ? MAC_LABELS[part] : undefined) ?? part)
}
