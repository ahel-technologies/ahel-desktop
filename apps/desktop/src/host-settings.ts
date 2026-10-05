/** Shell reads of Host settings over the Web application's authenticated RPC. */

import { randomUUID } from 'node:crypto'

/** Narrow settings reads the shell needs before or beside the workspace document. */
export interface DesktopHostSettings {
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
}

/** @returns whether `value` is a plain object. */
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One authenticated unary call into the Host's Remote namespaces. */
export type HostInvoke = (request: { namespace: string; method: string; args: Record<string, unknown> }) => Promise<unknown>

/**
 * Authenticate the native HTTP client through the Web application's launch URL.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns a unary RPC caller over the authenticated session.
 * @throws Error when Web authentication fails.
 */
export async function connectHostRpc(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<HostInvoke> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop host: Web authentication failed')
  return async (request) => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error(`desktop host: ${method} Web request failed`)
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error(`desktop host: ${method} Web RPC failed`)
    }
    return envelope.result.value
  }
}

/**
 * Read Host settings over an authenticated RPC caller.
 * @param invoke - unary RPC caller from {@link connectHostRpc}.
 * @returns settings reads over standard RPC.
 */
export function desktopHostSettings(invoke: HostInvoke): DesktopHostSettings {
  return {
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop settings: missing settings namespaces')
      const locale: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
      if (!record(locale) || !record(locale.value)
        || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
        throw new Error('desktop settings: invalid locale preference')
      }
      return locale.value.preference ?? null
    },
  }
}

/**
 * Authenticate and return the settings reads.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns settings reads over standard RPC.
 * @throws Error when Web authentication fails.
 */
export async function connectDesktopHostSettings(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<DesktopHostSettings> {
  return desktopHostSettings(await connectHostRpc(authenticatedUrl, send))
}
