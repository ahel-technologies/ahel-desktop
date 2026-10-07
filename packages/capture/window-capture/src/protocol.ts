/**
 * Window capture values shared by the Desktop shell, its preload bridge and
 * the composer plugin. Environment-neutral: no Node or Electron imports.
 */

/** One captured window: its image and the words that name it. */
export interface WindowCapture {
  /** PNG bytes of the window without its shadow. */
  readonly png: Uint8Array
  /** Application that owns the window, for example `Safari`; empty when the platform does not report it. */
  readonly app: string
  /** Window title; empty when the window has none or the platform hides it. */
  readonly title: string
  /** Visible text read through the platform accessibility interface; absent when it could not be read. */
  readonly text?: string
}

/**
 * Why no capture was produced. `permission`: macOS Screen Recording is not
 * granted to Ahel Desktop. `no-window`: no other application window is on
 * screen. `unsupported`: the platform has no capture backend. `failed`: the
 * capture tool failed.
 */
export type WindowCaptureFailure = 'permission' | 'no-window' | 'unsupported' | 'failed'

/** Outcome of one capture request. */
export type WindowCaptureResult =
  | { readonly ok: true; readonly capture: WindowCapture }
  | { readonly ok: false; readonly reason: WindowCaptureFailure; readonly message?: string }

/** The global capture shortcut as the Desktop shell holds it. */
export interface WindowCaptureShortcut {
  /** Whether this platform captures windows; only macOS does, and elsewhere the shortcut stays unregistered. */
  readonly supported: boolean
  /** Electron accelerator, for example `CommandOrControl+Shift+2`; null while the shortcut is off. */
  readonly accelerator: string | null
  /** Accelerator a reset restores. */
  readonly defaultAccelerator: string
  /** Whether the operating system accepted the accelerator; false when another application holds it. */
  readonly registered: boolean
}

/** Outcome of a shortcut change; a refused change keeps the previous shortcut. */
export type WindowCaptureShortcutResult =
  | { readonly ok: true; readonly shortcut: WindowCaptureShortcut }
  | { readonly ok: false; readonly reason: 'invalid' | 'taken'; readonly shortcut: WindowCaptureShortcut }

/**
 * Preload bridge exposed as `window.__DSH_WINDOW_CAPTURE__` on the Desktop
 * application document only; the served Web page has none.
 */
export interface WindowCaptureBridge {
  /** @returns the current global shortcut. */
  shortcut(): Promise<WindowCaptureShortcut>
  /**
   * Replace the global shortcut.
   * @param accelerator - Electron accelerator, or null to turn the shortcut off.
   * @returns the shortcut now in force.
   */
  setShortcut(accelerator: string | null): Promise<WindowCaptureShortcutResult>
  /** @returns a capture of the front window that is not Ahel Desktop's own. */
  capture(): Promise<WindowCaptureResult>
  /** @returns the capture the global shortcut produced, at most once per capture; null when none is waiting. */
  take(): Promise<WindowCaptureResult | null>
  /**
   * Listen for shortcut captures; call `take` to receive one.
   * @param listener - called after the shell captured a window and focused itself.
   * @returns unsubscribe.
   */
  onCaptured(listener: () => void): () => void
}

/** Default global shortcut: Cmd+Shift+2 on macOS. */
export const DEFAULT_WINDOW_CAPTURE_ACCELERATOR = 'CommandOrControl+Shift+2'

/**
 * Caption line that introduces a capture in the draft.
 * @param capture - app name and window title.
 * @returns `Window: {app} – {title}`, leaving out whichever part is empty.
 */
export function windowCaption(capture: Pick<WindowCapture, 'app' | 'title'>): string {
  const parts = [capture.app.trim(), capture.title.trim()].filter(part => part !== '')
  return `Window: ${parts.length === 0 ? 'untitled' : parts.join(' – ')}`
}

function stamp(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`
}

/**
 * Composer attachment files for one capture: the PNG, and a text file with
 * the caption and the visible text when the window's text was read.
 * @param capture - captured window.
 * @param at - capture time, used in the file names.
 * @returns the files in attachment order and the caption line.
 */
export function windowCaptureFiles(capture: WindowCapture, at: Date): { files: File[]; caption: string } {
  const caption = windowCaption(capture)
  const name = `Window ${stamp(at)}`
  const files = [new File([new Uint8Array(capture.png)], `${name}.png`, { type: 'image/png' })]
  const text = capture.text?.trim() ?? ''
  if (text !== '') files.push(new File([`${caption}\n\n${text}\n`], `${name} text.txt`, { type: 'text/plain' }))
  return { files, caption }
}
