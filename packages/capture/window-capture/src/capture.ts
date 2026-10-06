/** Platform-neutral capture of the front window through a `WindowCapturer` backend. */
import type { WindowCaptureResult } from './protocol.ts'

/** The window a backend chose to capture. */
export interface FrontWindow {
  /** Backend-owned window id: the CGWindowNumber on macOS. */
  readonly id: number
  /** Owning process id; 0 when the backend does not know it. */
  readonly processId: number
  /** Owning application name; empty when unknown. */
  readonly app: string
  /** Window title; empty when hidden or absent. */
  readonly title: string
}

/** One platform's capture operations. */
export interface WindowCapturer {
  /**
   * Find the front window, skipping windows owned by the excluded processes.
   * @param excludeProcessIds - processes whose windows are never chosen, such as Ahel Desktop itself.
   * @returns the window, or undefined when no other window is on screen.
   */
  frontWindow(excludeProcessIds: readonly number[]): Promise<FrontWindow | undefined>
  /**
   * @param window - window from `frontWindow`.
   * @returns PNG bytes of the window.
   */
  screenshot(window: FrontWindow): Promise<Uint8Array>
  /**
   * Read the window's visible text without asking for any permission.
   * @param window - window from `frontWindow`.
   * @param maxChars - text length limit.
   * @returns the text, or undefined when the platform cannot read it.
   */
  text(window: FrontWindow, maxChars: number): Promise<string | undefined>
}

/** One capture request; every field is explicit. */
export interface CaptureFrontWindowRequest {
  /** Processes whose windows are skipped. */
  readonly excludeProcessIds: readonly number[]
  /** Visible-text length limit. */
  readonly maxTextChars: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * @param bytes - candidate image.
 * @returns whether the bytes start with the PNG signature.
 */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

/**
 * Capture the front window: its PNG, app name and title, and its visible text
 * when the backend can read it. A failed text read leaves the text out and
 * keeps the image.
 * @param capturer - platform backend.
 * @param request - excluded processes and text limit.
 * @returns the capture, or the reason there is none.
 */
export async function captureFrontWindow(capturer: WindowCapturer, request: CaptureFrontWindowRequest): Promise<WindowCaptureResult> {
  let window: FrontWindow | undefined
  try {
    window = await capturer.frontWindow(request.excludeProcessIds)
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
  if (window === undefined) return { ok: false, reason: 'no-window' }
  const found = window
  const [png, text] = await Promise.all([
    capturer.screenshot(found).catch((error: unknown) => error instanceof Error ? error : new Error(String(error))),
    capturer.text(found, request.maxTextChars).catch(() => undefined),
  ])
  if (png instanceof Error) return { ok: false, reason: 'failed', message: png.message }
  if (!isPng(png)) return { ok: false, reason: 'failed', message: 'the capture tool returned no PNG image' }
  const visible = text?.trim().slice(0, request.maxTextChars) ?? ''
  return { ok: true, capture: { png, app: found.app, title: found.title, ...(visible === '' ? {} : { text: visible }) } }
}
