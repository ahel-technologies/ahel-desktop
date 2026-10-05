/** Operations available to the isolated native welcome renderer. */

import type { DesktopLocale } from './locale.ts'

/** Private native welcome channels, installed only while its window exists. */
export const WELCOME_IPC = {
  continue: 'ahel-welcome:continue',
  signIn: 'ahel-welcome:sign-in',
  cancelSignIn: 'ahel-welcome:cancel-sign-in',
  signInState: 'ahel-welcome:sign-in-state',
} as const

/** Sign-in progress shown by the welcome; never carries a URL, code or token. */
export interface WelcomeSignInState {
  readonly phase: 'idle' | 'waiting-browser' | 'exchanging' | 'succeeded' | 'cancelled' | 'failed'
  /** Failure class from the account plugin (`denied`, `timeout`, `network`, `protocol`, `storage`). */
  readonly errorCode?: string
}

/** Host-owned operations used by the welcome window. */
export interface WelcomeOperations {
  /**
   * Open the workspace without signing in (bring-your-own-key use).
   * @returns completion after the workspace opens.
   */
  continue(): Promise<void>
  /**
   * Start the ahel.ai sign-in: the shell opens the system browser on the consent page.
   * @returns once the browser was asked to open.
   */
  signIn(): Promise<void>
  /**
   * Cancel the running sign-in.
   * @returns once cancelled.
   */
  cancelSignIn(): Promise<void>
}

/** The renderer receives localized copy, the operations and progress; it holds no credentials. */
export type WelcomeApi = DesktopLocale & WelcomeOperations & {
  /**
   * Observe sign-in progress pushed by the shell.
   * @param listener - progress recipient.
   * @returns unsubscribe.
   */
  onSignInState(listener: (state: WelcomeSignInState) => void): () => void
}

/**
 * Decide whether startup shows the welcome window.
 * @param signedIn - whether the ahel.ai account is signed in on this Host.
 * @returns true until the person signs in.
 */
export function needsWelcome(signedIn: boolean): boolean {
  return !signedIn
}
