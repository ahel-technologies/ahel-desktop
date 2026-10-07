/**
 * The ahel.ai account for Ahel Desktop: one browser sign-in whose OAuth grant
 * is stored under one credential reference (`AHEL_ACCOUNT` by default). The
 * Ahel MCP server (`dsh-mcp-client` with `auth.credentialRef`) and the
 * Ahel-metered model provider (`dsh-llm-ahel`) both authenticate with that
 * grant. Sign-in registers a fresh public client per attempt, because ahel.ai
 * tombstones revoked grants per (user, client) forever.
 *
 * The Remote namespace `ahelAccount` exposes the view, sign-in, cancel,
 * sign-out, profile and watch; `accessToken()` and `setOpener()` stay
 * Host-only. The child namespace `ahelCatalog` browses the ahel.ai catalog
 * and reads and writes the person's installs with the same grant.
 * The child namespace `ahelTeam` reads and answers held calls, connects
 * vault apps, and sends and reads teammate handoffs over `/api/desktop/*`.
 *
 * @module @ahel/dsh-ahel-account
 */

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import type { Context, Volatile } from '@ahel/cordis'
import type {} from '@ahel/dsh-config-editor'
import Schema from '@ahel/schemastery'
import { brandString } from '@ahel/dsh-brand'
import { credentialRef } from '@ahel/dsh-credentials'
import type { CredentialRef } from '@ahel/dsh-credentials'
import { currentOAuthGrant, OAuthGrantError, readOAuthGrant, refreshOAuthGrant, writeOAuthGrant } from '@ahel/dsh-mcp-client'
import type { StoredOAuthGrant } from '@ahel/dsh-mcp-client'
import { Remote, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import { AhelCatalog } from './catalog.ts'
import { AhelTeam } from './team.ts'
import { AhelIssues } from './issues.ts'
import {
  authorizeUrl, createPkce, discover, exchange, fetchProfile, randomState, register, revoke, SignInError, startLoopbackListener,
} from './signin.ts'
import type { HttpOptions, LoopbackListener } from './signin.ts'
import type { AhelAccountView, AhelHostedPages, AhelProfile, AhelSignInAttemptId, AhelSignInAttemptView } from './types.ts'

export { AhelCatalog } from './catalog.ts'
export type { CatalogConfig } from './catalog.ts'
export { AhelTeam } from './team.ts'
export type { TeamConfig } from './team.ts'
export { AhelIssues } from './issues.ts'
export type { IssuesConfig } from './issues.ts'
export type {
  Issue, IssueActivity, IssueActivityKind, IssueActorType, IssueAssignee, IssueAssignees, IssueComment, IssueDraft, IssueInboxItem,
  IssuePage, IssuePatch, IssuePriority, IssueProject, IssueQuery, IssueRun, IssueRunReport, IssueRunState, IssueStatus, IssueWriteAnswer,
} from './issues-types.ts'
export type {
  CatalogBrowsePage, CatalogBrowseQuery, CatalogCapability, CatalogFactPart, CatalogGroup, CatalogInstalled, CatalogInstallResult,
  CatalogConcept, CatalogPart, CatalogRow, CatalogRowState, CatalogRowTile, CatalogSort, CatalogSwitchResult, KnowledgeProduct,
  KnowledgeSource,
} from './types.ts'
export type {
  AhelIcon, AhelJson, ApprovalDecision, ApprovalRow, DesktopCredits, DesktopMember, DesktopSummary, HandoffDraft,
  HandoffEvidence, HandoffList, HandoffRead, HandoffReceivedRow, HandoffReview, HandoffSectionId, HandoffSectionRow,
  HandoffSections, HandoffSent, HandoffSentRow, HandoffShare, KeyConnectAnswer, KeyConnectField, KeyConnectSaved, KeyConnectView,
  VaultDisconnected, VaultSignIn, VaultSignInList,
} from './types.ts'
export type {
  AhelAccountView, AhelHostedPages, AhelProfile, AhelSignInAttemptId, AhelSignInAttemptView, AhelSignInErrorCode, AhelWorkspace,
} from './types.ts'

declare module '@ahel/cordis' {
  interface Context {
    ahelAccount: AhelAccount
  }
}

/** Deployment choices for the account plugin. */
export interface Config {
  /** Authorization server and API origin. HTTP is accepted only on loopback hosts. */
  appOrigin?: string
  /** RFC 8707 resource the grant is bound to; the Ahel MCP gateway. */
  resource?: string
  /** Credential reference holding the grant document. */
  credentialRef?: string
  /** Client name sent at registration; the host name is appended for the consent screen. */
  clientName?: string
  /** How long a sign-in waits for the browser callback, in milliseconds. */
  signInTimeoutMs?: number
  /** Deadline for each ahel.ai request, in milliseconds. */
  requestTimeoutMs?: number
  /** Refresh the access token when it expires within this many milliseconds. */
  refreshSkewMs?: number
  /** Selected ahel.ai workspace id, sent as `?workspace=` by the Ahel MCP server and models; unset uses the account default. */
  workspace?: Volatile<string | undefined>
  /** Path on `appOrigin` read to tell whether ahel.ai is reachable; any HTTP answer counts. */
  healthPath?: string
  /** Wait between reachability reads while ahel.ai answers, in milliseconds. */
  reachableIntervalMs?: number
  /** Wait between reachability reads while ahel.ai does not answer, in milliseconds. */
  unreachableIntervalMs?: number
  /**
   * Environment variable read once at load for a launch grant handed over by
   * ahel.ai's hosted chat: JSON `{"client_id", "refresh_token"}`. Empty disables it.
   */
  launchTokenEnv?: string
  /** Path on `appOrigin` a launched Host's Sign in opens: the chat gateway replaces the Host with one holding a fresh grant. */
  hostedSignInPath?: string
  /** Path on `appOrigin` a launched Host's Sign out opens. */
  hostedSignOutPath?: string
}

/** Validated configuration. */
export const Config = Schema.object({
  appOrigin: Schema.string().default('https://ahel.ai'),
  resource: Schema.string().default('https://mcp.ahel.ai/mcp'),
  credentialRef: Schema.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('AHEL_ACCOUNT'),
  clientName: Schema.string().default('Ahel Desktop'),
  signInTimeoutMs: Schema.number().min(1).max(3_600_000).default(300_000),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  refreshSkewMs: Schema.number().min(0).max(3_600_000).default(60_000),
  workspace: Schema.string().volatile(),
  healthPath: Schema.string().pattern(/^\//).default('/api/health/live'),
  reachableIntervalMs: Schema.number().min(1_000).max(3_600_000).default(60_000),
  unreachableIntervalMs: Schema.number().min(1_000).max(3_600_000).default(5_000),
  launchTokenEnv: Schema.string().pattern(/^([A-Za-z_][A-Za-z0-9_]*)?$/).default('AHEL_LAUNCH_TOKEN'),
  hostedSignInPath: Schema.string().pattern(/^\//).default('/chat/?signin=1'),
  hostedSignOutPath: Schema.string().pattern(/^\//).default('/app/settings'),
})

/** Opens the authorize URL in the person's browser (Electron `shell.openExternal`). */
export type ExternalOpener = (url: string) => Promise<void> | void

interface Attempt {
  view: AhelSignInAttemptView
  controller: AbortController
  listener?: LoopbackListener
  done: Promise<void>
}

/**
 * Parse an origin, refusing credentials in the URL and plain HTTP off loopback.
 * @param value - configured origin.
 * @param field - config field name for the error.
 * @returns the normalized origin.
 */
function secureOrigin(value: string, field: string): string {
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username !== '' || url.password !== '' || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error(`ahel-account: ${field} must be an https origin (http only on loopback), got ${value}`)
  }
  return url.origin
}

/** The hosting gateway's launch grant: a refresh token minted for a first-party client. */
interface LaunchGrant {
  client_id: string
  refresh_token: string
}

/**
 * Parse a launch grant without echoing its text into an error.
 * @param text - the environment value.
 * @returns the client id and refresh token.
 */
function parseLaunchGrant(text: string): LaunchGrant {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (_notJson) {
    // The value is a secret; the error names only its shape.
    throw new Error('ahel-account: the launch token is not JSON')
  }
  const record = typeof value === 'object' && value !== null ? value as Partial<Record<keyof LaunchGrant, unknown>> : {}
  if (typeof record.client_id !== 'string' || record.client_id === '' || typeof record.refresh_token !== 'string' || record.refresh_token === '') {
    throw new Error('ahel-account: the launch token needs client_id and refresh_token')
  }
  return { client_id: record.client_id, refresh_token: record.refresh_token }
}

function isProfile(value: unknown): value is AhelProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Partial<Record<keyof AhelProfile, unknown>>
  return typeof profile.email === 'string' && (profile.name === null || typeof profile.name === 'string') && Array.isArray(profile.workspaces)
}

/** Account service; the default export loads it as a plugin. */
export class AhelAccount extends TypertRemoteService {
  static inject = ['credentials']
  static Config = Config
  private readonly appOrigin: string
  private readonly resource: string
  private readonly ref: CredentialRef
  private readonly clientName: string
  private readonly signInTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly refreshSkewMs: number
  private readonly workspaceRef: Volatile<string | undefined>
  private readonly owner: Context
  private attempt: Attempt | undefined
  private opener: ExternalOpener | undefined
  private readonly listeners = new Set<() => void>()
  private closed = false
  private reachable = true
  /** Settles once a launch grant from the environment was stored or refused. */
  private launched: Promise<void> = Promise.resolve()
  /** ahel.ai's pages when the hosted chat launched this Host. */
  private hosted: AhelHostedPages | null = null

  /**
   * @param ctx - Host context with the credentials service.
   * @param config - deployment options.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'ahelAccount')
    // The Loader hands a live volatile reference; parsing it again would replace it.
    const { workspace, ...plain } = config
    const resolved = Config(plain)
    this.workspaceRef = workspace ?? resolved.workspace
    this.owner = ctx
    this.appOrigin = secureOrigin(resolved.appOrigin, 'appOrigin')
    this.resource = new URL(resolved.resource).href
    this.ref = credentialRef(resolved.credentialRef)
    this.clientName = resolved.clientName
    this.signInTimeoutMs = resolved.signInTimeoutMs
    this.requestTimeoutMs = resolved.requestTimeoutMs
    this.refreshSkewMs = resolved.refreshSkewMs
    const launchToken = resolved.launchTokenEnv === '' ? undefined : process.env[resolved.launchTokenEnv]
    let adopted = Promise.resolve(false)
    if (launchToken !== undefined && launchToken !== '') {
      // Read once: later loads and child processes never see the token.
      Reflect.deleteProperty(process.env, resolved.launchTokenEnv)
      this.hosted = {
        signInUrl: new URL(resolved.hostedSignInPath, this.appOrigin).href,
        signOutUrl: new URL(resolved.hostedSignOutPath, this.appOrigin).href,
      }
      adopted = this.adoptLaunchGrant(launchToken).then(() => true, (error: unknown) => {
        this.ctx.logger.warn(`ahel-account: the launch token was not accepted: ${error instanceof Error ? error.message : String(error)}`)
        return false
      })
      this.launched = adopted.then(() => undefined)
    }
    // A grant kept from an earlier boot carries the profile read at its sign-in; read it again once.
    void adopted.then(fresh => fresh ? undefined : this.refreshProfile()).catch((error: unknown) => {
      this.ctx.logger.info(`ahel-account: the profile could not be re-read: ${error instanceof Error ? error.message : String(error)}`)
    })
    ctx.plugin(AhelCatalog, { appOrigin: this.appOrigin, resource: this.resource })
    ctx.plugin(AhelTeam, { appOrigin: this.appOrigin })
    ctx.plugin(AhelIssues, { appOrigin: this.appOrigin })
    ctx.on('credentials/reference-updated', (ref) => { if (ref === this.ref) this.changed() })
    ctx.on('loader/volatile-update', () => {
      this.changed()
      void this.mirrorWorkspace().catch((error: unknown) => {
        this.ctx.logger.warn(`ahel-account: the workspace could not be applied: ${String(error)}`)
      })
    })
    ctx.effect(() => () => {
      this.closed = true
      this.attempt?.controller.abort()
      for (const listener of this.listeners) listener()
    }, 'ahel-account.lifetime')
    const health = new URL(resolved.healthPath, this.appOrigin).href
    ctx.effect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()
      const probe = async (): Promise<void> => {
        let reachable = true
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.requestTimeoutMs)])
          const response = await fetch(health, { redirect: 'manual', signal })
          await response.body?.cancel()
        } catch (_unreachable) {
          // Only a failed connection or a timeout reaches here; every HTTP answer means ahel.ai is up.
          reachable = controller.signal.aborted
        }
        if (controller.signal.aborted) return
        if (reachable !== this.reachable) {
          this.reachable = reachable
          this.changed()
        }
        timer = setTimeout(() => { void probe() }, reachable ? resolved.reachableIntervalMs : resolved.unreachableIntervalMs)
      }
      void probe()
      return () => { controller.abort(); clearTimeout(timer) }
    }, 'ahel-account.reachability')
  }

  /**
   * Read the stored-account presence, its profile and the latest attempt.
   * @returns a snapshot without tokens.
   */
  @Remote
  async state(): Promise<AhelAccountView> {
    await this.launched
    const grant = await readOAuthGrant(this.ctx.credentials, this.ref)
    const profile = grant !== undefined && isProfile(grant.profile) ? grant.profile : null
    return {
      status: grant === undefined ? 'signed-out' : 'signed-in',
      profile,
      attempt: this.attempt?.view ?? null,
      workspace: profile === null ? null : this.selectedWorkspace(profile) ?? null,
      reachable: this.reachable,
      hosted: this.hosted,
    }
  }

  /**
   * Choose the ahel.ai workspace the MCP server and Ahel models act in, and
   * save it in settings.
   * @param id - one of the profile's workspace ids, or null for the account default.
   * @returns the view after the choice is applied.
   */
  @Remote
  async selectWorkspace(id: string | null): Promise<AhelAccountView> {
    const view = await this.state()
    if (id !== null && view.profile?.workspaces.some(workspace => workspace.id === id) !== true) {
      throw new Error('ahel-account: that workspace is not one of this account\'s workspaces')
    }
    const entry = this.owner.fiber.entry
    const editor = this.ctx.get('configEditor')
    if (entry === undefined || editor === undefined) throw new Error('ahel-account: choosing a workspace needs a profile-backed Host')
    await editor.edit(entry, (current) => {
      const next = { ...current }
      if (id === null) Reflect.deleteProperty(next, 'workspace')
      else next.workspace = id
      return next
    })
    await this.mirrorWorkspace()
    this.changed()
    return this.state()
  }

  /**
   * Host-only: the selected workspace id while it is one of the signed-in person's workspaces.
   * @returns the id, or undefined for the account default.
   */
  async workspace(): Promise<string | undefined> {
    await this.launched
    const grant = await readOAuthGrant(this.ctx.credentials, this.ref)
    return grant !== undefined && isProfile(grant.profile) ? this.selectedWorkspace(grant.profile) : undefined
  }

  /**
   * Join the running attempt or start a browser sign-in. Resolves once the
   * authorize URL exists (or the attempt failed), without waiting for the
   * person to approve; the opener, when set, has been asked to open it.
   * @returns the view with `attempt.authorizeUrl` for a shell that opens the browser itself.
   */
  @Remote
  async signIn(): Promise<AhelAccountView> {
    this.refuseHosted()
    const running = this.attempt
    if (running !== undefined && ['starting', 'waiting-browser', 'exchanging'].includes(running.view.phase)) return this.state()
    let ready!: () => void
    const readyPromise = new Promise<void>((resolve) => { ready = resolve })
    const attempt: Attempt = {
      view: { id: brandString<AhelSignInAttemptId>(randomUUID()), phase: 'starting' },
      controller: new AbortController(),
      done: Promise.resolve(),
    }
    this.attempt = attempt
    attempt.done = this.run(attempt, ready)
    this.changed()
    await readyPromise
    return this.state()
  }

  /**
   * Cancel only the named attempt.
   * @param id - attempt to cancel.
   * @returns the view after the attempt settled.
   */
  @Remote
  async cancelSignIn(id: AhelSignInAttemptId): Promise<AhelAccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      attempt.controller.abort()
      await attempt.listener?.close()
      await attempt.done
    }
    return this.state()
  }

  /**
   * Revoke the grant on ahel.ai, then delete the stored credential. A failed
   * revoke is logged and never keeps the local grant.
   * @returns the signed-out view.
   */
  @Remote
  async signOut(): Promise<AhelAccountView> {
    this.refuseHosted()
    const attempt = this.attempt
    if (attempt !== undefined) await this.cancelSignIn(attempt.view.id)
    const grant = await readOAuthGrant(this.ctx.credentials, this.ref)
    if (grant !== undefined) {
      let bearer = grant.access_token
      try {
        bearer = (await this.currentGrant())?.access_token ?? bearer
        await revoke(this.appOrigin, bearer, this.http())
      } catch (error) {
        this.ctx.logger.warn(`ahel-account: revoke on ${this.appOrigin} failed; the local sign-in is removed anyway: ${error instanceof Error ? error.message : String(error)}`)
      }
      await this.ctx.credentials.unset(this.ref)
    }
    return this.state()
  }

  /**
   * Read name, email and workspaces live from ahel.ai.
   * @returns the profile, or null while signed out.
   */
  @Remote
  async profile(): Promise<AhelProfile | null> {
    const token = await this.accessToken()
    return token === undefined ? null : fetchProfile(this.appOrigin, token, this.http())
  }

  /**
   * Subscribe to complete views, starting with the current one.
   * @param signal - subscription lifetime; ending it never cancels a sign-in.
   * @returns views as account state changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<AhelAccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) {
          dirty = false
          yield await this.state()
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Host-only: a bearer valid for at least `refreshSkewMs`, refreshed and
   * written back first when needed. A refresh ahel.ai rejects signs the
   * account out.
   * @returns the access token, or undefined while signed out.
   */
  async accessToken(): Promise<string | undefined> {
    return (await this.currentGrant())?.access_token
  }

  /**
   * Host-only: the Ahel MCP gateway URL this grant's bearer is bound to; Host
   * callers send the bearer to this URL and nowhere else.
   * @returns the configured `resource`.
   */
  gateway(): string {
    return this.resource
  }

  /**
   * Host-only: after ahel.ai refused the current bearer, refresh it once. A
   * refresh ahel.ai rejects signs the account out, like `accessToken()`.
   */
  async revalidate(): Promise<void> {
    try {
      const options = { refreshSkewMs: this.refreshSkewMs, requestTimeoutMs: this.requestTimeoutMs }
      await currentOAuthGrant(this.ctx.credentials, this.ref, options, true)
    } catch (error) {
      if (!(error instanceof OAuthGrantError && error.rejected)) throw error
    }
  }

  /**
   * Host-only: set the browser opener used by later sign-ins. Without one,
   * the authorize URL is logged and returned in the view.
   * @param opener - the shell's external opener.
   * @returns a disposer that restores the previous opener.
   */
  setOpener(opener: ExternalOpener): () => void {
    const previous = this.opener
    this.opener = opener
    return () => { if (this.opener === opener) this.opener = previous }
  }

  /** A launched Host's grant belongs to the person's ahel.ai session, which only ahel.ai starts and ends. */
  private refuseHosted(): void {
    if (this.hosted !== null) throw new Error('ahel-account: the hosted chat signs in and out on ahel.ai')
  }

  private selectedWorkspace(profile: AhelProfile): string | undefined {
    const id = this.workspaceRef.get()
    return id !== undefined && profile.workspaces.some(workspace => workspace.id === id) ? id : undefined
  }

  /** Copy the selection into the stored grant, where the grant-authenticated MCP server reads it. */
  private async mirrorWorkspace(): Promise<void> {
    const grant = await readOAuthGrant(this.ctx.credentials, this.ref)
    if (grant === undefined) return
    const id = isProfile(grant.profile) ? this.selectedWorkspace(grant.profile) : undefined
    if (grant.workspace === id) return
    const next: StoredOAuthGrant = { ...grant }
    if (id === undefined) delete next.workspace
    else next.workspace = id
    await writeOAuthGrant(this.ctx.credentials, this.ref, next)
  }

  private async currentGrant(): Promise<StoredOAuthGrant | undefined> {
    await this.launched
    try {
      const options = { refreshSkewMs: this.refreshSkewMs, requestTimeoutMs: this.requestTimeoutMs }
      return await currentOAuthGrant(this.ctx.credentials, this.ref, options)
    } catch (error) {
      if (error instanceof OAuthGrantError && error.rejected) return undefined
      throw error
    }
  }

  /**
   * Exchange a gateway-minted refresh token once and store the result as this
   * account's grant, replacing any grant the volume kept from an earlier pod.
   * The exchange rotates the token, so the environment copy dies with it.
   */
  private async adoptLaunchGrant(text: string): Promise<void> {
    const launch = parseLaunchGrant(text)
    const http = this.http()
    const discovery = await discover(this.appOrigin, http)
    const refreshed = await refreshOAuthGrant({
      version: 1,
      issuer: this.appOrigin,
      token_endpoint: discovery.token_endpoint,
      client_id: launch.client_id,
      access_token: '',
      expires_at: 0,
      refresh_token: launch.refresh_token,
      resource: this.resource,
    }, { requestTimeoutMs: this.requestTimeoutMs })
    const profile = await fetchProfile(this.appOrigin, refreshed.access_token, http)
    const grant: StoredOAuthGrant = { ...refreshed, profile }
    const workspace = this.selectedWorkspace(profile)
    if (workspace !== undefined) grant.workspace = workspace
    await writeOAuthGrant(this.ctx.credentials, this.ref, grant)
    this.changed()
  }

  /** Replace the stored grant's profile with ahel.ai's current one, keeping every other field of the grant. */
  private async refreshProfile(): Promise<void> {
    const grant = await this.currentGrant()
    if (grant === undefined) return
    const profile = await fetchProfile(this.appOrigin, grant.access_token, this.http())
    const latest = await readOAuthGrant(this.ctx.credentials, this.ref)
    if (this.closed || latest === undefined || JSON.stringify(latest.profile) === JSON.stringify(profile)) return
    await writeOAuthGrant(this.ctx.credentials, this.ref, { ...latest, profile })
    this.changed()
  }

  private http(signal?: AbortSignal): HttpOptions {
    return { fetchImpl: fetch, timeoutMs: this.requestTimeoutMs, ...signal === undefined ? {} : { signal } }
  }

  private update(attempt: Attempt, view: Omit<AhelSignInAttemptView, 'id'>): void {
    if (this.attempt !== attempt) return
    attempt.view = { id: attempt.view.id, ...view }
    this.changed()
  }

  private async run(attempt: Attempt, ready: () => void): Promise<void> {
    const signal = attempt.controller.signal
    const cancelled = (): boolean => signal.aborted
    const http = this.http(signal)
    try {
      const discovery = await discover(this.appOrigin, http)
      const state = randomState()
      const pkce = createPkce()
      const listener = await startLoopbackListener(state, this.signInTimeoutMs)
      attempt.listener = listener
      if (signal.aborted) throw new SignInError('cancelled', 'sign-in cancelled')
      const clientId = await register(discovery.registration_endpoint, `${this.clientName} on ${hostname()}`, listener.redirectUri, http)
      const url = authorizeUrl({
        endpoint: discovery.authorization_endpoint,
        clientId,
        redirectUri: listener.redirectUri,
        challenge: pkce.challenge,
        state,
        resource: this.resource,
      })
      this.update(attempt, { phase: 'waiting-browser', authorizeUrl: url })
      ready()
      await this.open(url)
      const code = await listener.code
      this.update(attempt, { phase: 'exchanging', authorizeUrl: url })
      const tokens = await exchange({
        endpoint: discovery.token_endpoint,
        code,
        redirectUri: listener.redirectUri,
        clientId,
        verifier: pkce.verifier,
        resource: this.resource,
        now: Date.now(),
      }, http)
      const profile = await fetchProfile(this.appOrigin, tokens.access_token, http)
      const grant: StoredOAuthGrant = {
        version: 1,
        issuer: this.appOrigin,
        token_endpoint: discovery.token_endpoint,
        client_id: clientId,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
        resource: this.resource,
        profile,
        ...tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token },
      }
      const workspace = this.selectedWorkspace(profile)
      if (workspace !== undefined) grant.workspace = workspace
      if (cancelled()) throw new SignInError('cancelled', 'sign-in cancelled')
      try {
        await writeOAuthGrant(this.ctx.credentials, this.ref, grant)
      } catch (error) {
        throw new SignInError('storage', `the sign-in could not be stored: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.update(attempt, { phase: 'succeeded' })
    } catch (error) {
      const code = signal.aborted ? 'cancelled' : error instanceof SignInError ? error.code : 'protocol'
      if (code !== 'cancelled') this.ctx.logger.warn(`ahel-account: sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
      this.update(attempt, { phase: code === 'cancelled' ? 'cancelled' : 'failed', errorCode: code })
    } finally {
      ready()
      await attempt.listener?.close()
    }
  }

  private async open(url: string): Promise<void> {
    if (this.opener === undefined) {
      this.ctx.logger.info(`ahel-account: open this URL to sign in to Ahel: ${url}`)
      return
    }
    try {
      await this.opener(url)
    } catch (error) {
      this.ctx.logger.warn(`ahel-account: the browser could not be opened (${String(error)}); open this URL to sign in: ${url}`)
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
    void this.state().then(
      (view) => { this.ctx.emit('ahel-account/changed', view) },
      (error: unknown) => { this.ctx.logger.warn(`ahel-account: state could not be read: ${String(error)}`) },
    )
  }
}

export default AhelAccount
