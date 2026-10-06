/**
 * Composer attachment files for one capture. A copy of the protocol module's
 * helpers: the client bundle may import only types across plugins, so the
 * value lives here (packages/client/tsdown.client.ts, client bundle purity).
 */
import type { WindowCapture } from '@ahel/dsh-window-capture/protocol'

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
