/**
 * Ahel spike: OAuth 2.1 (PKCE + dynamic client registration) for Streamable
 * HTTP MCP servers such as `https://ahel.ai/mcp`.
 *
 * The provider keeps one pending authorization URL per server so reconnect
 * attempts do not churn the PKCE verifier, logs that URL for the person to
 * open, and runs a loopback callback server on 127.0.0.1 that exchanges the
 * returned code. Tokens and the registered client live in a private JSON file
 * under `$DSH_HOME/mcp-oauth/` (mode 600). Phase 2 should move this into the
 * credentials seam and open the browser from the Desktop shell.
 *
 * @module
 */

import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  auth,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client'

/** OAuth settings for one Streamable HTTP server. */
export interface OAuthConfig {
  /** Run the browser sign-in flow when the server answers 401. */
  enabled: boolean
  /** Loopback port for the redirect URI (`http://127.0.0.1:<port>/callback`). */
  callbackPort: number
  /** Client name sent during dynamic client registration. */
  clientName: string
}

interface PersistedState {
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  verifier?: string
  pendingUrl?: string
  pendingAt?: number
}

interface Logger {
  info(message: string): void
  warn(message: string): void
}

/** A pending authorization URL stays valid for this long before a fresh one replaces it. */
const PENDING_TTL_MS = 10 * 60_000

const providers = new Map<string, OAuthClientProvider>()

function stateDirectory(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'mcp-oauth')
}

/**
 * Return the shared OAuth provider for one server, creating it on first use.
 * @param serverName - Local MCP server namespace, used as the state file name.
 * @param serverUrl - MCP endpoint URL (the protected resource).
 * @param config - OAuth settings from the plugin config.
 * @param logger - Plugin logger used to surface the sign-in URL.
 * @returns Provider passed to the Streamable HTTP transport as `authProvider`.
 */
export function oauthProviderFor(serverName: string, serverUrl: string, config: OAuthConfig, logger: Logger): OAuthClientProvider {
  const key = `${serverName}\u0000${serverUrl}`
  const existing = providers.get(key)
  if (existing !== undefined) return existing

  const directory = stateDirectory()
  const file = join(directory, `${serverName}.json`)
  const urlFile = join(directory, `${serverName}.authorize-url.txt`)
  const redirectUrl = `http://127.0.0.1:${String(config.callbackPort)}/callback`
  let callbackServer: Server | undefined

  const read = (): PersistedState => {
    if (!existsSync(file)) return {}
    try { return JSON.parse(readFileSync(file, 'utf8')) as PersistedState } catch { return {} }
  }
  const write = (state: PersistedState): void => {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 })
    chmodSync(file, 0o600)
  }
  const pendingFresh = (state: PersistedState): boolean =>
    state.pendingUrl !== undefined && state.pendingAt !== undefined && Date.now() - state.pendingAt < PENDING_TTL_MS

  const startCallbackServer = (): void => {
    if (callbackServer !== undefined) return
    callbackServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUrl)
      if (url.pathname !== '/callback') {
        response.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      if (code === null) {
        response.writeHead(400, { 'content-type': 'text/plain' }).end(`Sign-in failed: ${url.searchParams.get('error') ?? 'no code'}`)
        return
      }
      const iss = url.searchParams.get('iss')
      auth(provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) })
        .then(() => {
          const state = read()
          delete state.pendingUrl
          delete state.pendingAt
          delete state.verifier
          write(state)
          logger.info(`mcp-client(${serverName}): OAuth sign-in complete; the next reconnect attempt uses the new token`)
          response.writeHead(200, { 'content-type': 'text/plain' }).end('Signed in. You can close this tab and return to Ahel Desktop.')
          callbackServer?.close()
          callbackServer = undefined
        })
        .catch((error: unknown) => {
          logger.warn(`mcp-client(${serverName}): OAuth code exchange failed: ${String(error)}`)
          response.writeHead(500, { 'content-type': 'text/plain' }).end('Sign-in failed while exchanging the code. Check the Ahel Desktop log.')
        })
    })
    callbackServer.on('error', (error) => {
      logger.warn(`mcp-client(${serverName}): OAuth callback server error: ${String(error)}`)
      callbackServer = undefined
    })
    callbackServer.listen(config.callbackPort, '127.0.0.1')
  }

  const clientMetadata: OAuthClientMetadata = {
    client_name: config.clientName,
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'openid profile email offline_access',
  }

  const provider: OAuthClientProvider = {
    get redirectUrl() { return redirectUrl },
    get clientMetadata() { return clientMetadata },
    clientInformation: () => read().client,
    saveClientInformation: (client) => { write({ ...read(), client }) },
    tokens: () => read().tokens,
    saveTokens: (tokens) => { write({ ...read(), tokens }) },
    saveCodeVerifier: (verifier) => {
      const state = read()
      // Keep the verifier that matches the URL already shown to the person.
      if (pendingFresh(state)) return
      write({ ...state, verifier })
    },
    codeVerifier: () => {
      const verifier = read().verifier
      if (verifier === undefined) throw new Error('mcp-client: no PKCE verifier is pending')
      return verifier
    },
    redirectToAuthorization: (authorizationUrl) => {
      startCallbackServer()
      let state = read()
      if (!pendingFresh(state)) {
        state = { ...state, pendingUrl: authorizationUrl.href, pendingAt: Date.now() }
        write(state)
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileSync(urlFile, `${state.pendingUrl ?? authorizationUrl.href}\n`, { mode: 0o600 })
      logger.warn(`mcp-client(${serverName}): sign-in required. Open this URL in a browser: ${state.pendingUrl ?? authorizationUrl.href}`)
    },
    invalidateCredentials: (scope) => {
      const state = read()
      if (scope === 'all' || scope === 'client') delete state.client
      if (scope === 'all' || scope === 'tokens') delete state.tokens
      if (scope === 'all' || scope === 'verifier') delete state.verifier
      write(state)
    },
  }
  providers.set(key, provider)
  return provider
}
