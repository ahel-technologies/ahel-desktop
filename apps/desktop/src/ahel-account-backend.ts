/** Native client of the Host's `ahelAccount` Remote namespace; tokens never leave the Host. */

import type { AhelAccountView, AhelProfile, AhelSignInAttemptId, AhelSignInAttemptView } from '@ahel/dsh-ahel-account/types'
import { connectHostRpc, record } from './host-settings.ts'

/** Account operations the shell drives from the welcome window and the menu. */
export interface DesktopAhelAccount {
  /** @returns the current account view. */
  state(): Promise<AhelAccountView>
  /** @returns the view once the authorize URL exists (or the attempt failed). */
  signIn(): Promise<AhelAccountView>
  /** @param id - attempt to cancel. @returns the view after cancellation. */
  cancelSignIn(id: AhelSignInAttemptId): Promise<AhelAccountView>
  /** @returns the signed-out view. */
  signOut(): Promise<AhelAccountView>
}

const PHASES = new Set(['starting', 'waiting-browser', 'exchanging', 'succeeded', 'cancelled', 'failed'])

/**
 * Validate the account view received over HTTP.
 * @param value - wire value.
 * @returns the view.
 * @throws Error for an unexpected value.
 */
export function ahelAccountView(value: unknown): AhelAccountView {
  if (!record(value) || (value.status !== 'signed-in' && value.status !== 'signed-out') || !('attempt' in value) || !('profile' in value)) {
    throw new Error('desktop account: invalid state')
  }
  const attempt = value.attempt
  if (attempt !== null && (!record(attempt) || typeof attempt.id !== 'string' || !PHASES.has(String(attempt.phase))
    || (attempt.authorizeUrl !== undefined && typeof attempt.authorizeUrl !== 'string')
    || (attempt.errorCode !== undefined && typeof attempt.errorCode !== 'string'))) {
    throw new Error('desktop account: invalid attempt')
  }
  const profile = value.profile
  let parsedProfile: AhelProfile | null = null
  if (profile !== null) {
    if (!record(profile) || typeof profile.email !== 'string' || !Array.isArray(profile.workspaces)) {
      throw new Error('desktop account: invalid profile')
    }
    const workspaces: unknown[] = profile.workspaces
    parsedProfile = {
      email: profile.email,
      name: typeof profile.name === 'string' ? profile.name : null,
      workspaces: workspaces.filter(record).map(w => ({
        id: String(w.id), name: String(w.name), slug: String(w.slug), role: String(w.role),
      })),
    }
  }
  return {
    status: value.status,
    profile: parsedProfile,
    workspace: typeof value.workspace === 'string' ? value.workspace : null,
    attempt: attempt === null ? null : {
      id: attempt.id as AhelSignInAttemptId,
      phase: attempt.phase as AhelSignInAttemptView['phase'],
      ...typeof attempt.authorizeUrl === 'string' ? { authorizeUrl: attempt.authorizeUrl } : {},
      ...typeof attempt.errorCode === 'string' ? { errorCode: attempt.errorCode as NonNullable<AhelSignInAttemptView['errorCode']> } : {},
    },
  }
}

/**
 * Accept only HTTPS (or loopback HTTP) destinations for the external browser.
 * @param value - authorize URL from the Host.
 * @returns the URL to open.
 * @throws Error for any other destination.
 */
export function browserDestination(value: string): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username !== '' || url.password !== '' || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error('desktop account: invalid browser destination')
  }
  return url.href
}

/**
 * Authenticate to the Host and bind the account operations.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns account operations over the Host RPC.
 */
export async function connectDesktopAhelAccount(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<DesktopAhelAccount> {
  const invoke = await connectHostRpc(authenticatedUrl, send)
  const call = async (method: string, args: Record<string, unknown> = {}): Promise<AhelAccountView> =>
    ahelAccountView(await invoke({ namespace: 'ahelAccount', method, args }))
  return {
    state: () => call('state'),
    signIn: () => call('signIn'),
    cancelSignIn: id => call('cancelSignIn', { id }),
    signOut: () => call('signOut'),
  }
}
