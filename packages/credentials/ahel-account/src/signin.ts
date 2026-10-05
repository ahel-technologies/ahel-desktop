/**
 * OAuth 2.1 public-client sign-in against ahel.ai, copied from the `ahel` CLI
 * (`cli/src/auth/{oauth,login}.ts`): discovery, a loopback listener bound
 * before a fresh dynamic client registration, PKCE S256, one callback,
 * code exchange, then the bearer-only profile and revoke endpoints. Codes,
 * verifiers, tokens and response bodies never reach an error message.
 *
 * @module dsh-ahel-account/signin
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AhelProfile, AhelSignInErrorCode } from './types.ts'

/** Scopes requested for the desktop grant; `offline_access` yields a refresh token. */
export const SCOPE = 'openid profile email offline_access'
const CALLBACK_PATH = '/callback'
const LOOPBACK_HOST = '127.0.0.1'
const MAX_RESPONSE_BYTES = 256 * 1024

/** Sign-in failure carrying a UI-safe code and a message free of secrets. */
export class SignInError extends Error {
  /**
   * @param code - safe failure class shown through the UI dictionary.
   * @param message - log-safe description.
   */
  constructor(readonly code: AhelSignInErrorCode, message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

/** Authorization-server endpoints from RFC 8414 discovery. */
export interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
}

/** Tokens from one code exchange. */
export interface TokenResponse {
  access_token: string
  refresh_token?: string
  /** Epoch milliseconds. */
  expires_at: number
}

/** Transport inputs shared by every request. */
export interface HttpOptions {
  fetchImpl: typeof fetch
  timeoutMs: number
  signal?: AbortSignal
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const OAUTH_ERRORS: Record<string, string> = {
  invalid_grant: 'the authorization code was not accepted (invalid_grant)',
  invalid_client: 'the client registration was not accepted (invalid_client)',
  invalid_request: 'the request was malformed (invalid_request)',
  access_denied: 'sign-in was declined (access_denied)',
  server_error: 'the sign-in server hit an internal error (server_error)',
  temporarily_unavailable: 'the sign-in server is temporarily unavailable (temporarily_unavailable)',
}

/**
 * Fixed wording for an OAuth `error` value; never reflects the input.
 * @param code - remote `error` field.
 * @returns a log-safe sentence.
 */
function describeOAuthError(code: unknown): string {
  if (typeof code === 'string' && Object.hasOwn(OAUTH_ERRORS, code)) return OAUTH_ERRORS[code] ?? code
  const id = typeof code === 'string' && /^[a-z_]{1,32}$/.test(code) ? code : 'unknown'
  return `the sign-in server refused the request (${id})`
}

/**
 * One deadline-bound request whose body is read within the byte cap.
 * @param url - request URL.
 * @param init - request options; redirects are refused.
 * @param what - log-safe request label.
 * @param http - fetch, deadline and caller signal.
 * @returns HTTP status and parsed JSON body (null when empty or not JSON).
 */
export async function requestJson(
  url: string, init: RequestInit, what: string, http: HttpOptions,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const deadline = AbortSignal.timeout(http.timeoutMs)
  const signal = http.signal === undefined ? deadline : AbortSignal.any([http.signal, deadline])
  let response: Response
  try {
    response = await http.fetchImpl(url, { ...init, redirect: 'error', signal })
  } catch (_transport) {
    // The transport error may carry the URL query; report the origin only.
    throw new SignInError('network', `${what}: could not reach ${new URL(url).origin}`)
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (reader !== undefined) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new SignInError('protocol', `${what}: response too large`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof SignInError) throw error
    throw new SignInError('network', `${what}: the response was interrupted`)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  let body: unknown = null
  try {
    body = text.length === 0 ? null : JSON.parse(text)
  } catch (_notJson) {
    // Non-JSON bodies are reported by status only.
    body = null
  }
  return { status: response.status, ok: response.ok, body }
}

/**
 * Read a JSON object or fail with the status and a known OAuth error code only.
 * @returns the response object.
 */
async function requestObject(url: string, init: RequestInit, what: string, http: HttpOptions): Promise<Record<string, unknown>> {
  const { status, ok, body } = await requestJson(url, init, what, http)
  if (!ok) {
    const reason = isRecord(body) && body.error !== undefined ? `: ${describeOAuthError(body.error)}` : ''
    throw new SignInError(status === 400 || status === 401 ? 'denied' : 'network', `${what} failed (HTTP ${String(status)})${reason}`)
  }
  if (!isRecord(body)) throw new SignInError('protocol', `${what}: response was not a JSON object`)
  return body
}

/**
 * RFC 8414 discovery on the app origin.
 * @param appOrigin - authorization-server origin such as `https://ahel.ai`.
 * @param http - fetch, deadline and caller signal.
 * @returns the three endpoints the flow uses.
 */
export async function discover(appOrigin: string, http: HttpOptions): Promise<Discovery> {
  const url = `${appOrigin}/.well-known/oauth-authorization-server`
  const body = await requestObject(url, { headers: { accept: 'application/json' } }, 'OAuth discovery', http)
  const { authorization_endpoint, token_endpoint, registration_endpoint } = body
  if (!nonEmpty(authorization_endpoint) || !nonEmpty(token_endpoint) || !nonEmpty(registration_endpoint)) {
    throw new SignInError('protocol', `OAuth discovery at ${url} is missing an endpoint`)
  }
  return { authorization_endpoint, token_endpoint, registration_endpoint }
}

/**
 * RFC 7591 registration of a fresh public client for one sign-in.
 * @param endpoint - registration endpoint.
 * @param clientName - consent-screen name, e.g. `Ahel Desktop on <host>`.
 * @param redirectUri - exact loopback redirect.
 * @param http - fetch, deadline and caller signal.
 * @returns the registered client id.
 */
export async function register(endpoint: string, clientName: string, redirectUri: string, http: HttpOptions): Promise<string> {
  const body = await requestObject(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
      software_id: 'ahel-desktop',
    }),
  }, 'client registration', http)
  if (!nonEmpty(body.client_id)) throw new SignInError('protocol', 'client registration returned no client_id')
  return body.client_id
}

/** PKCE verifier and its S256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

/** @returns a 256-bit random `state`. */
export function randomState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Build the authorize URL; `prompt=consent` is sent because ahel forces it.
 * @returns the URL to open in the browser.
 */
export function authorizeUrl(input: {
  endpoint: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  resource: string
}): string {
  const url = new URL(input.endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('resource', input.resource)
  return url.toString()
}

/** One bound loopback listener awaiting exactly one callback. */
export interface LoopbackListener {
  redirectUri: string
  /** Resolves with the authorization code; rejects on denial, state mismatch, timeout or close. */
  code: Promise<string>
  close(): Promise<void>
}

const page = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>`
  + '<style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;line-height:1.5}</style></head>'
  + `<body><h1>${title}</h1><p>${body}</p></body></html>`
const PAGE_OK = page('Signed in to Ahel', 'You can close this tab and return to Ahel Desktop.')
const PAGE_FAIL = page('Sign-in not completed', 'Return to Ahel Desktop and try again.')
const PAGE_NOT_FOUND = page('Ahel Desktop', 'Nothing to see here.')

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Bind 127.0.0.1 on an OS-assigned port before registration, so the
 * registered redirect is exactly the bound one. `state` is compared in
 * constant time before any other parameter; the first callback on the exact
 * path settles the attempt and closes the listener.
 * @param state - expected `state` value.
 * @param timeoutMs - how long to wait for the browser.
 * @returns the bound listener.
 */
export async function startLoopbackListener(state: string, timeoutMs: number): Promise<LoopbackListener> {
  let settled = false
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  code.catch(() => undefined)
  const deadline: { timer?: NodeJS.Timeout } = {}
  const server: Server = createServer((request, response) => {
    const reply = (status: number, html: string): void => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', connection: 'close' })
      response.end(html)
    }
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
    if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH || settled) {
      reply(404, PAGE_NOT_FOUND)
      return
    }
    if (!safeEqual(url.searchParams.get('state') ?? '', state)) {
      reply(400, PAGE_FAIL)
      settle(new SignInError('protocol', 'the browser callback did not match this sign-in attempt (state mismatch)'))
      return
    }
    const error = url.searchParams.get('error')
    if (error !== null) {
      reply(200, PAGE_FAIL)
      settle(new SignInError('denied', error === 'access_denied' ? 'sign-in was declined in the browser' : describeOAuthError(error)))
      return
    }
    const authCode = url.searchParams.get('code')
    if (authCode === null || authCode.length === 0) {
      reply(400, PAGE_FAIL)
      settle(new SignInError('protocol', 'the browser callback carried no authorization code'))
      return
    }
    reply(200, PAGE_OK)
    settle(authCode)
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  const close = async (): Promise<void> => {
    clearTimeout(deadline.timer)
    await new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      server.closeAllConnections()
    })
  }
  function settle(outcome: string | Error): void {
    if (settled) return
    settled = true
    void close().finally(() => {
      if (typeof outcome === 'string') resolveCode(outcome)
      else rejectCode(outcome)
    })
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await close()
    throw new SignInError('protocol', 'could not bind the loopback listener on 127.0.0.1')
  }
  deadline.timer = setTimeout(() => {
    settle(new SignInError('timeout', `no browser callback within ${String(Math.round(timeoutMs / 1000))} s`))
  }, timeoutMs)
  return {
    redirectUri: `http://${LOOPBACK_HOST}:${String(address.port)}${CALLBACK_PATH}`,
    code,
    close: async () => {
      if (!settled) {
        settled = true
        rejectCode(new SignInError('cancelled', 'sign-in cancelled'))
      }
      await close()
    },
  }
}

/**
 * Exchange the authorization code; `resource` binds the token to the gateway.
 * @returns the token set.
 */
export async function exchange(
  input: { endpoint: string; code: string; redirectUri: string; clientId: string; verifier: string; resource: string; now: number },
  http: HttpOptions,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
    resource: input.resource,
  })
  const body = await requestObject(input.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  }, 'token exchange', http)
  if (!nonEmpty(body.access_token)) throw new SignInError('protocol', 'token response carried no access_token')
  const expiresIn = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600
  return {
    access_token: body.access_token,
    expires_at: input.now + expiresIn * 1000,
    ...nonEmpty(body.refresh_token) ? { refresh_token: body.refresh_token } : {},
  }
}

/**
 * GET `<app>/api/mcp/profile` with a bearer.
 * @param appOrigin - app origin.
 * @param bearer - access token.
 * @param http - fetch, deadline and caller signal.
 * @returns email, optional name and every workspace membership.
 */
export async function fetchProfile(appOrigin: string, bearer: string, http: HttpOptions): Promise<AhelProfile> {
  const { status, ok, body } = await requestJson(`${appOrigin}/api/mcp/profile`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
  }, 'profile request', http)
  if (!ok) throw new SignInError(status === 401 ? 'denied' : 'network', `profile request failed (HTTP ${String(status)})`)
  const user = isRecord(body) ? body.user : undefined
  const memberships = isRecord(body) ? body.memberships : undefined
  if (!isRecord(user) || !nonEmpty(user.email) || !Array.isArray(memberships)) {
    throw new SignInError('protocol', 'profile response had unexpected fields')
  }
  const workspaces = memberships.filter(isRecord).flatMap(m =>
    nonEmpty(m.id) && typeof m.name === 'string' && typeof m.slug === 'string' && typeof m.role === 'string'
      ? [{ id: m.id, name: m.name, slug: m.slug, role: m.role }]
      : [])
  return { email: user.email, name: nonEmpty(user.name) ? user.name : null, workspaces }
}

/**
 * POST `<app>/api/mcp/revoke` with a bearer: tombstones this grant's user/client pair.
 * @param appOrigin - app origin.
 * @param bearer - access token of the grant to revoke.
 * @param http - fetch, deadline and caller signal.
 */
export async function revoke(appOrigin: string, bearer: string, http: HttpOptions): Promise<void> {
  const { status, ok } = await requestJson(`${appOrigin}/api/mcp/revoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
  }, 'revoke request', http)
  if (!ok) throw new SignInError('network', `revoke request failed (HTTP ${String(status)})`)
}
