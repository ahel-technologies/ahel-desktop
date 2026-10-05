/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation. HMR hot-swaps by
 * disposing the old instance and creating a new one; identical `serverName`
 * reproduces identical public tool names.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_MAX_INSTRUCTION_BYTES, RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
import { registerServerContext } from './server-context.ts'
import { oauthGrantAuthProvider, readOAuthGrant } from './oauth.ts'
import type { AuthProvider } from '@modelcontextprotocol/client'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export { createMcpToolDefinition, publicToolName } from './tools.ts'
export { liveResultMeta, MCP_APP_MIME_TYPE, MCP_APPS_EXTENSION, readToolUi } from './apps.ts'
export type { McpAppResultMeta, McpToolDescriptor, McpToolUi, McpToolVisibility } from './apps.ts'
export type { McpResult, McpToolDefinitionOptions } from './tools.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
export {
  currentOAuthGrant, oauthGrantAuthProvider, OAuthGrantError, parseOAuthGrant, readOAuthGrant, refreshOAuthGrant, writeOAuthGrant,
} from './oauth.ts'
export type { OAuthGrantOptions, StoredOAuthGrant } from './oauth.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls and resource requests (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per registration scope. Agent-scoped MCP
 * servers may reuse a namespace in another Agent, while global instances and
 * duplicates inside one Agent remain mutually exclusive.
 */
const activeServerNames = new WeakMap<object, Set<string>>()

// ---- Config ----

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /**
   * Bearer authentication from an OAuth grant stored under a credential
   * reference (see {@link StoredOAuthGrant}). The server connects only while
   * the reference holds a grant, and disconnects (unregistering its tools)
   * when the reference is removed.
   */
  auth?: GrantAuthConfig
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Grant-backed bearer authentication for one Streamable HTTP server. */
export interface GrantAuthConfig {
  /** Credential reference whose value is the grant document, e.g. `AHEL_ACCOUNT`. */
  credentialRef: string
  /** Refresh the access token when it expires within this many milliseconds. */
  refreshSkewMs: number
  /** Deadline for one token-refresh request in milliseconds. */
  refreshTimeoutMs: number
  /** Query parameter that carries the grant's selected workspace; the server reconnects when the selection changes. */
  workspaceParam?: string
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

type StdioConfigInput = Omit<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type StreamableHttpConfigInput = Omit<StreamableHttpConfig, 'headers' | 'auth' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
  & { auth?: Pick<GrantAuthConfig, 'credentialRef'> & Partial<GrantAuthConfig> }
type ConfigInput = StdioConfigInput | StreamableHttpConfigInput

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    auth: z.union([
      z.object({
        credentialRef: z.string().required().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
        refreshSkewMs: z.number().min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
        refreshTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
        workspaceParam: z.string().pattern(/^[A-Za-z][A-Za-z0-9_-]*$/),
      }),
      z.const(undefined),
    ]),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
]) as z<ConfigInput, Config>

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Fail loud at load: reconnect misconfiguration (including programmatic
  // construction that bypassed Schemastery) rejects THIS instance before any
  // effect registers.
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)
  if (config.transport === 'streamable-http' && config.auth !== undefined) {
    applyGrantGate(ctx, config, config.auth, reconnect)
    return
  }
  await connect(ctx, config, reconnect)
}

/**
 * Hold one connection session while the configured reference stores a grant.
 * Presence is re-read on every committed change to that reference, so a
 * sign-in connects and a sign-out disposes the session and its tools.
 */
function applyGrantGate(ctx: Context, config: StreamableHttpConfig, auth: GrantAuthConfig, reconnect: ResolvedReconnectPolicy): void {
  const ref = credentialRef(auth.credentialRef)
  ctx.inject(['credentials'], (authCtx) => {
    const authProvider = oauthGrantAuthProvider(authCtx.credentials, ref, {
      refreshSkewMs: auth.refreshSkewMs,
      requestTimeoutMs: auth.refreshTimeoutMs,
    })
    let session: Fiber | undefined
    let sessionUrl: string | undefined
    let queue = Promise.resolve()
    const sync = (): void => {
      queue = queue.then(async () => {
        const grant = await readOAuthGrant(authCtx.credentials, ref)
        const url = grant === undefined ? undefined : endpointFor(config.url, auth.workspaceParam, grant.workspace)
        if (session !== undefined && url !== sessionUrl) {
          const stopping = session
          session = undefined
          sessionUrl = undefined
          await stopping.dispose()
        }
        if (url !== undefined && session === undefined) {
          const sessionConfig = { ...config, url }
          sessionUrl = url
          session = authCtx.plugin({ name: 'mcp-client-session', apply: (sessionCtx: Context) => connect(sessionCtx, sessionConfig, reconnect, authProvider) })
        }
      }).catch((error: unknown) => {
        authCtx.logger.warn(`mcp-client(${config.serverName}): ${auth.credentialRef} could not be read: ${String(error)}`)
      })
    }
    authCtx.on('credentials/reference-updated', (updated) => { if (updated === ref) sync() })
    sync()
  })
}

/**
 * The server URL for one grant: the selected workspace rides as a query parameter when configured.
 * @param base - configured server URL.
 * @param param - query parameter name, or undefined to send none.
 * @param workspace - the grant's selected workspace.
 * @returns the URL to connect.
 */
function endpointFor(base: string, param: string | undefined, workspace: string | undefined): string {
  if (param === undefined || workspace === undefined) return base
  const url = new URL(base)
  url.searchParams.set(param, workspace)
  return url.href
}

/**
 * Connect one MCP server and publish its initial tool generation.
 * @param ctx - context owning the connection and its tool registrations.
 * @param config - resolved transport and server namespace configuration.
 * @param reconnect - resolved reconnect policy.
 * @param authProvider - bearer source for a grant-authenticated server.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
async function connect(ctx: Context, config: Config, reconnect: ResolvedReconnectPolicy, authProvider?: AuthProvider): Promise<void> {
  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    const owner = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(owner)
    if (!names) {
      names = new Set()
      activeServerNames.set(owner, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`,
      )
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-client.serverName')

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  const connection = startConnection(ctx, config, reconnect, authProvider)
  registerServerContext(ctx, config.serverName, connection)
  let stopping: Promise<void> | undefined
  const dispose = (): Promise<void> => stopping ??= connection.dispose()
  // Cordis announces unload before awaiting an unfinished apply(). Closing
  // the transport here releases startup requests that are still awaiting a reply.
  // oxlint-disable-next-line typescript/no-misused-promises -- Cordis contains observer failures; the effect also awaits this promise.
  ctx.on('internal/plugin', (fiber) => {
    if (fiber !== ctx.fiber || fiber.uid !== null) return
    return dispose()
  }, { global: true })
  ctx.effect(() => dispose, 'mcp-client.connection')

  // Block plugin activation on the initial connection + tool discovery so
  // Cordis consumers observe the tools immediately after the fiber activates.
  // When failOnStartupError is true, a failed initial attempt rejects the
  // fiber (Cordis rolls it back); otherwise the error is logged and the
  // supervisor enters its reconnect loop.
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}
