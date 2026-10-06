/** Pure helpers for the computer-use UI. */
import type { ComputerUseCrop, ComputerUseSessionView, ComputerUseStatus, ComputerUseView } from '@ahel/dsh-computer-use-action-gate/types'

/** Largest crop box on the card, in CSS pixels. */
export const CROP_MAX = { width: 520, height: 220 }

/** A pending interaction as the composer chain hands it over. */
interface PendingLike {
  readonly kind?: unknown
  readonly toolName?: unknown
}

/**
 * Whether a pending interaction is an approval for a computer-use tool.
 * @param pending - the composer's pending interaction.
 * @param prefix - `mcp__<server>__` of the Cua Driver server.
 * @returns true when this package's card should take the composer.
 */
export function isComputerUseApproval(pending: PendingLike | undefined, prefix: string): boolean {
  return pending?.kind === 'approval' && typeof pending.toolName === 'string' && pending.toolName.startsWith(prefix)
}

/**
 * The state of one session.
 * @param view - the latest view.
 * @param sessionId - the session.
 * @returns its state, or undefined when it has no computer-use activity.
 */
export function sessionOf(view: ComputerUseView | null, sessionId: string | undefined): ComputerUseSessionView | undefined {
  return sessionId === undefined ? undefined : view?.sessions.find(session => session.sessionId === sessionId)
}

/**
 * Box size and image transform that show only the crop rectangle.
 * @param crop - the crop.
 * @returns CSS sizes for the clipping box and the transform of the whole screenshot inside it.
 */
export function cropLayout(crop: ComputerUseCrop): { width: number; height: number; transform: string } {
  const scale = Math.min(1, CROP_MAX.width / crop.width, CROP_MAX.height / crop.height)
  return {
    width: Math.round(crop.width * scale),
    height: Math.round(crop.height * scale),
    transform: `translate(${String(-crop.x * scale)}px, ${String(-crop.y * scale)}px) scale(${String(scale)})`,
  }
}

/** Tone of a status chip. */
export function statusTone(status: ComputerUseStatus): 'neutral' | 'waiting' | 'good' | 'bad' {
  switch (status) {
    case 'read': return 'neutral'
    case 'asked':
    case 'approved': return 'waiting'
    case 'done': return 'good'
    case 'failed':
    case 'rejected':
    case 'denied':
    case 'blocked': return 'bad'
  }
}

/**
 * `14:03:09` for an activity row.
 * @param time - epoch milliseconds.
 * @returns local wall-clock time.
 */
export function clock(time: number): string {
  const date = new Date(time)
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
}

/**
 * Parse the Settings text area into a block list.
 * @param text - one app per line or comma separated.
 * @returns trimmed, unique, non-empty entries.
 */
export function parseBlockedApps(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map(item => item.trim()).filter(item => item !== ''))]
}
