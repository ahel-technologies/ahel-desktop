/**
 * Bearer authentication from an OAuth grant held in the credentials seam.
 *
 * A grant is one JSON document stored as the value of a credential reference
 * (for Ahel Desktop, `AHEL_ACCOUNT`). The account plugin writes it after a
 * browser sign-in; this module reads it per request, refreshes it within
 * `refreshSkewMs` of expiry or after a 401, and writes the refreshed grant back
 * through the same reference. Refreshes of one reference are single-flight
 * within the process. A refresh the token endpoint rejects with
 * `invalid_grant` removes the reference while it still holds the rejected
 * grant, so every consumer sees one signed-out state.
 *
 * @module
 */

import type { AuthProvider } from '@modelcontextprotocol/client'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'

/** OAuth grant document stored as one credential reference's value. Field names follow the OAuth wire names. */
export interface StoredOAuthGrant {
  /** Document version. */
  version: 1
  /** Authorization server origin that issued the grant. */
  issuer: string
  /** Token endpoint used for refresh. */
  token_endpoint: string
  /** Client id registered for this grant. */
  client_id: string
  /** Current bearer token. */
  access_token: string
  /** Refresh token; absent grants cannot be refreshed. */
  refresh_token?: string
  /** Access-token expiry, epoch milliseconds. */
  expires_at: number
  /** RFC 8707 resource the grant is bound to, sent again on refresh. */
  resource?: string
  /** Owner-defined display data (the account plugin keeps the profile here); never read by this module. */
  profile?: unknown
}

/** Options shared by grant reads that may refresh. */
export interface OAuthGrantOptions {
  /** Refresh when the access token expires within this many milliseconds. */
  refreshSkewMs: number
  /** Deadline for one token-endpoint request in milliseconds. */
  requestTimeoutMs?: number
  /** Fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
}

/** Failure of a grant refresh; `rejected` means the server refused the refresh token. */
export class OAuthGrantError extends Error {
  /**
   * @param message - safe description; never carries a token or a response body.
   * @param rejected - true when the token endpoint answered `invalid_grant`.
   */
  constructor(message: string, readonly rejected: boolean) {
    super(message)
    this.name = 'OAuthGrantError'
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 256 * 1024

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * Parse a stored grant document.
 * @param text - credential value.
 * @returns the grant, or `undefined` when the value is not a version-1 grant.
 */
export function parseOAuthGrant(text: string): StoredOAuthGrant | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (_notJson) {
    // A non-JSON value is not a grant; callers treat it as absent.
    return undefined
  }
  if (!isRecord(value) || value.version !== 1 || !nonEmpty(value.issuer) || !nonEmpty(value.token_endpoint)
    || !nonEmpty(value.client_id) || !nonEmpty(value.access_token)
    || typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at)
    || (value.refresh_token !== undefined && !nonEmpty(value.refresh_token))
    || (value.resource !== undefined && !nonEmpty(value.resource))) {
    return undefined
  }
  return {
    version: 1,
    issuer: value.issuer,
    token_endpoint: value.token_endpoint,
    client_id: value.client_id,
    access_token: value.access_token,
    expires_at: value.expires_at,
    ...value.refresh_token === undefined ? {} : { refresh_token: value.refresh_token },
    ...value.resource === undefined ? {} : { resource: value.resource },
    ...value.profile === undefined ? {} : { profile: value.profile },
  }
}

/**
 * Read the grant behind one reference without refreshing it.
 * @param credentials - credentials seam.
 * @param ref - reference holding the grant document.
 * @returns the grant, or `undefined` while none is stored.
 */
export async function readOAuthGrant(credentials: CredentialProvider, ref: CredentialRef): Promise<StoredOAuthGrant | undefined> {
  const resolved = await credentials.resolve(ref)
  return resolved === undefined ? undefined : parseOAuthGrant(resolved.value)
}

/**
 * Store one grant document under a reference.
 * @param credentials - credentials seam.
 * @param ref - reference to write.
 * @param grant - grant to store.
 */
export async function writeOAuthGrant(credentials: CredentialProvider, ref: CredentialRef, grant: StoredOAuthGrant): Promise<void> {
  await credentials.set(ref, JSON.stringify(grant))
}

async function readBoundedText(response: Response): Promise<string> {
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new OAuthGrantError('token refresh: response too large', false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Exchange a grant's refresh token for a new access token. The response body
 * is never echoed into an error.
 * @param grant - grant holding the refresh token.
 * @param options - fetch, deadline and clock.
 * @returns the refreshed grant; the previous refresh token is kept when the server omits a new one.
 */
export async function refreshOAuthGrant(grant: StoredOAuthGrant, options: Omit<OAuthGrantOptions, 'refreshSkewMs'> = {}): Promise<StoredOAuthGrant> {
  if (grant.refresh_token === undefined) throw new OAuthGrantError('the sign-in has expired and holds no refresh token', true)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: grant.client_id, refresh_token: grant.refresh_token })
  if (grant.resource !== undefined) form.set('resource', grant.resource)
  let response: Response
  let text: string
  try {
    response = await fetchImpl(grant.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    })
    text = await readBoundedText(response)
  } catch (error) {
    if (error instanceof OAuthGrantError) throw error
    throw new OAuthGrantError(`token refresh: could not reach ${new URL(grant.token_endpoint).origin}`, false)
  }
  let body: unknown
  try {
    body = text.length === 0 ? null : JSON.parse(text)
  } catch (_notJson) {
    // Reported below as an unreadable response without echoing the text.
    body = null
  }
  if (!response.ok) {
    const code = isRecord(body) && (body.error === 'invalid_grant' || body.error === 'invalid_client') ? body.error : undefined
    throw new OAuthGrantError(`token refresh failed (HTTP ${String(response.status)}${code === undefined ? '' : `, ${code}`})`, code !== undefined)
  }
  if (!isRecord(body) || !nonEmpty(body.access_token)) throw new OAuthGrantError('token refresh: response carried no access_token', false)
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600
  return {
    ...grant,
    access_token: body.access_token,
    expires_at: now() + expiresIn * 1000,
    refresh_token: nonEmpty(body.refresh_token) ? body.refresh_token : grant.refresh_token,
  }
}

/** Process-wide in-flight refreshes keyed by reference, shared by every package that bundles this module. */
const REFRESHES = Symbol.for('@deepseek-ai/dsh-mcp-client/oauth-grant-refreshes')
type RefreshRegistry = Map<string, Promise<StoredOAuthGrant | undefined>>
function refreshRegistry(): RefreshRegistry {
  const holder = globalThis as typeof globalThis & { [REFRESHES]?: RefreshRegistry }
  const registry = holder[REFRESHES] ?? new Map<string, Promise<StoredOAuthGrant | undefined>>()
  holder[REFRESHES] = registry
  return registry
}

/**
 * Read a grant whose access token is valid for at least `refreshSkewMs`,
 * refreshing and writing it back first when needed. Concurrent callers for one
 * reference share one refresh.
 * @param credentials - credentials seam.
 * @param ref - reference holding the grant document.
 * @param options - skew, fetch, deadline and clock.
 * @param force - refresh even when the stored token is not near expiry (after a 401).
 * @returns the usable grant, or `undefined` while signed out.
 */
export async function currentOAuthGrant(
  credentials: CredentialProvider,
  ref: CredentialRef,
  options: OAuthGrantOptions,
  force = false,
): Promise<StoredOAuthGrant | undefined> {
  const now = options.now ?? Date.now
  const stored = await readOAuthGrant(credentials, ref)
  if (stored === undefined) return undefined
  if (!force && stored.expires_at - now() >= options.refreshSkewMs) return stored
  const registry = refreshRegistry()
  const inflight = registry.get(ref)
  if (inflight !== undefined) return inflight
  const task = (async (): Promise<StoredOAuthGrant | undefined> => {
    // Re-read inside the flight: another process may have refreshed already.
    const current = await readOAuthGrant(credentials, ref)
    if (current === undefined) return undefined
    if (current.access_token !== stored.access_token && current.expires_at - now() >= options.refreshSkewMs) return current
    try {
      const next = await refreshOAuthGrant(current, options)
      await writeOAuthGrant(credentials, ref, next)
      return next
    } catch (error) {
      const latest = await readOAuthGrant(credentials, ref)
      const rotatedElsewhere = latest !== undefined && latest.access_token !== current.access_token
      if (rotatedElsewhere && latest.expires_at - now() >= options.refreshSkewMs) return latest
      if (error instanceof OAuthGrantError && error.rejected && latest?.refresh_token === current.refresh_token) {
        await credentials.unset(ref)
      }
      throw error
    }
  })()
  registry.set(ref, task)
  try {
    return await task
  } finally {
    registry.delete(ref)
  }
}

/**
 * MCP transport auth backed by a grant in the credentials seam.
 * @param credentials - credentials seam.
 * @param ref - reference holding the grant document.
 * @param options - skew, fetch, deadline and clock.
 * @returns provider whose `token()` reads per request and whose `onUnauthorized()` forces one refresh.
 */
export function oauthGrantAuthProvider(credentials: CredentialProvider, ref: CredentialRef, options: OAuthGrantOptions): AuthProvider {
  return {
    token: async () => (await currentOAuthGrant(credentials, ref, options))?.access_token,
    onUnauthorized: async () => { await currentOAuthGrant(credentials, ref, options, true) },
  }
}
