/** Operations available to the isolated native welcome renderer. */

import type { DesktopLocale } from './locale.ts'

/** Private native welcome channels, installed only while its window exists. */
export const WELCOME_IPC = {
  continue: 'ahel-welcome:continue',
} as const

/** Host-owned operations used by the welcome window. */
export interface WelcomeOperations {
  /**
   * Record that the welcome was seen and open the workspace.
   * @returns completion after the workspace opens.
   */
  continue(): Promise<void>
}

/** The renderer receives localized copy and the continue operation; it holds no credentials. */
export type WelcomeApi = DesktopLocale & WelcomeOperations

/** Name of the userData marker written once the welcome has been left. */
export const WELCOME_SEEN_MARKER = 'welcome-seen'

/**
 * Decide whether startup shows the welcome window.
 * The welcome never gates the workspace; it appears until the user leaves it once.
 * @param seen - whether the welcome-seen marker exists in userData.
 * @returns true only on a first launch.
 */
export function needsWelcome(seen: boolean): boolean {
  return !seen
}
