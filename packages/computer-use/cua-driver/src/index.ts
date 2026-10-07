/**
 * Computer use through the bundled Cua Driver, Host half.
 *
 * While `computerUse.enabled` is on, the Host spawns the pinned `cua-driver`
 * in embedded mode (daemon plus stdio MCP proxy, both direct children) and
 * mounts it as MCP server `ahel-computer`, so the driver's tools reach the
 * tools pipeline unchanged as `mcp__ahel-computer__<tool>`. Every result's
 * `structuredContent` is appended to the model text. The Settings row reads
 * and drives this service over the `computerUseDriver` Remote.
 * @module @ahel/dsh-computer-use-cua-driver
 */

import type { Context, Fiber } from '@ahel/cordis'
import z from '@ahel/schemastery'
import { Remote, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import { ComputerUseProviderName } from '@ahel/dsh-computer-use/brand'
import type {} from '@ahel/dsh-computer-use'
import * as McpClient from '@ahel/dsh-mcp-client'
import type { PostToolDecision } from '@ahel/dsh-tools'
import { dshHomePath } from '@ahel/dsh-home-paths'
import { dirname } from 'node:path'
import { driverEnvironment, driverExecutableName, ensureDriverHome, resolveDriverCommand, startDaemon, type DaemonHandle, type DriverCommand } from './driver.ts'
import { probeTool } from './probe.ts'
import { openSystemSettings, readMacPermissions, runOsaScript, type MacPermissions, type ScriptRunner } from './permissions.ts'
import { withStructuredContent } from './structured.ts'
import { assetKey, fetchBytes, installDriver, installedVersion, PINNED_DRIVER_VERSION, PINNED_RELEASE, type Fetcher } from './release.ts'
import { COMPUTER_USE_SERVER, COMPUTER_USE_TOOL_PREFIX, type ComputerUsePermission, type ComputerUseSettingsPane, type ComputerUseDriverStatus } from './types.ts'

export type * from './types.ts'
export { COMPUTER_USE_SERVER, COMPUTER_USE_TOOL_PREFIX } from './types.ts'
export { PINNED_DRIVER_VERSION, PINNED_RELEASE } from './release.ts'
export type { DriverAsset, DriverRelease } from './release.ts'

declare module '@ahel/cordis' {
  interface Context {
    computerUseDriver: CuaDriverComputerUse
  }
}

/**
 * Driver tools the provider always refuses: they download and install code
 * (Cua's optional perception extension is AGPL) or call GitHub for updates.
 * Ahel Desktop ships one pinned driver and nothing else.
 */
export const REFUSED_DRIVER_TOOLS: readonly string[] = ['install_extension', 'install_ffmpeg', 'check_for_update']

/** Profile options; the person's switch lives in `computerUse.enabled`, not here. */
export interface Config {
  /** Driver executable; empty selects the copy packaged in Resources/cua-driver. */
  command: string
  /** Bundle id the driver echoes in check_permissions; advisory only. */
  hostBundleId: string
  /** Longest wait for the driver daemon's socket. */
  startupTimeoutMs: number
  /** Per-call MCP timeout. */
  toolCallTimeoutMs: number
  /** Longest structuredContent JSON appended to one model result. */
  structuredContentMaxChars: number
  /** Extra trusted-launch variables for the driver, such as CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS. */
  environment: Record<string, string>
  /** Restarts after the driver stops unexpectedly, before the row reports an error. */
  maxRestarts: number
}

const RESTART_DELAYS_MS = [1000, 5000, 30_000]

/** Owns the driver's lifetime, its permission status, and the Settings Remote. */
export default class CuaDriverComputerUse extends TypertRemoteService {
  static inject = ['computerUse', 'tools']
  static Config: z<Partial<Config>, Config> = z.object({
    command: z.string().default(''),
    hostBundleId: z.string().default('ai.ahel.desktop'),
    startupTimeoutMs: z.number().min(1).default(15_000),
    toolCallTimeoutMs: z.number().min(1).default(60_000),
    structuredContentMaxChars: z.number().min(256).default(60_000),
    environment: z.dict(String).default({}),
    maxRestarts: z.number().min(0).step(1).default(3),
  })

  /** Script runner for macOS permission reads; tests replace it. */
  static osaScript: ScriptRunner = runOsaScript
  /** Opens one System Settings pane; tests replace it. */
  static openPane: (pane: ComputerUseSettingsPane) => Promise<void> = openSystemSettings
  /** Downloads the pinned release when this installation has no bundled driver; tests replace it. */
  static fetch: Fetcher = fetchBytes
  /** Operating system the provider plans for; tests pin it so every CI host runs the macOS path. */
  static platform: NodeJS.Platform = process.platform

  private status: ComputerUseDriverStatus
  private readonly listeners = new Set<() => void>()
  private session: Fiber | undefined
  private generation = 0
  private restarts = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private readonly platform: ComputerUseDriverStatus['platform']

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'computerUseDriver')
    const platform = CuaDriverComputerUse.platform
    this.platform = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'other'
    const notRequired = this.platform === 'darwin' ? 'unknown' : 'not-required'
    this.status = { enabled: false, phase: 'off', platform: this.platform, accessibility: notRequired, screenRecording: notRequired }
    ctx.on('computer-use/enabled', () => { this.sync() })
    ctx.tools.guard((exec) => {
      if (!exec.name.startsWith(COMPUTER_USE_TOOL_PREFIX)) return undefined
      const raw = exec.name.slice(COMPUTER_USE_TOOL_PREFIX.length)
      return REFUSED_DRIVER_TOOLS.includes(raw)
        ? `${raw} is not available in Ahel Desktop: it would download or install code outside the app.`
        : undefined
    })
    ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
      const decision = await next()
      if (!exec.name.startsWith(COMPUTER_USE_TOOL_PREFIX) || result.isError) return decision
      if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision
      const content = withStructuredContent(result.value, decision.content ?? result.content, this.config.structuredContentMaxChars)
      if (content === undefined) return decision
      return { kind: 'accept', content, ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts } }
    })
    ctx.effect(() => {
      this.sync()
      return () => {
        this.closed = true
        clearTimeout(this.restartTimer)
        for (const listener of this.listeners) listener()
      }
    }, 'computer-use-cua-driver.lifetime')
  }

  /**
   * Read the current status.
   * @returns the switch, driver phase and macOS permissions.
   */
  @Remote
  current(): ComputerUseDriverStatus {
    return this.status
  }

  /**
   * Stream the status now and after every change.
   * @param signal - subscriber lifetime.
   * @returns status snapshots until cancellation or service disposal.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<ComputerUseDriverStatus> {
    let update = Promise.withResolvers<void>()
    const changed = (): void => { update.resolve() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        yield this.status
        await update.promise
        update = Promise.withResolvers<void>()
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Turn computer use on or off for this profile (the `computerUse.enabled`
   * setting). Turning it on reads the macOS grants and, when one is missing,
   * opens System Settings at that pane. It raises no macOS prompt.
   * @param enabled - the requested value.
   * @returns the status after the write.
   */
  @Remote
  async setEnabled(enabled: boolean): Promise<ComputerUseDriverStatus> {
    await this.ctx.computerUse.setEnabled(enabled)
    if (enabled && this.platform === 'darwin') {
      const live = await this.readPermissions()
      const pane = live === undefined ? undefined : !live.accessibility ? 'accessibility' : !live.screenRecording ? 'screen-recording' : undefined
      if (pane !== undefined) await this.openSystemSettings(pane)
    }
    return this.status
  }

  /**
   * Re-read the macOS grants. A grant that changed while the driver runs
   * restarts the driver, because macOS caches grants per process.
   * @returns the status after the check.
   */
  @Remote
  async recheck(): Promise<ComputerUseDriverStatus> {
    const before = this.status
    const live = await this.readPermissions()
    if (live !== undefined && this.session !== undefined
      && (state(live.accessibility) !== before.accessibility || state(live.screenRecording) !== before.screenRecording)) {
      this.restart()
    }
    return this.status
  }

  /**
   * Open System Settings at the Privacy & Security pane for one permission.
   * @param pane - the permission to show.
   */
  @Remote
  async openSystemSettings(pane: ComputerUseSettingsPane): Promise<void> {
    if (this.platform !== 'darwin') return
    try {
      await CuaDriverComputerUse.openPane(pane)
    } catch (error: unknown) {
      this.ctx.logger.warn(`computer use: ${message(error)}`)
    }
  }

  private sync(): void {
    if (this.closed) return
    const enabled = this.ctx.computerUse.enabled
    this.set({ enabled })
    if (enabled && this.session === undefined && this.restartTimer === undefined) {
      this.restarts = 0
      this.start()
    } else if (!enabled) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
      this.stopSession()
      this.set({ phase: 'off', toolCount: undefined, detail: undefined })
    }
  }

  private start(): void {
    if (this.platform === 'other') {
      this.set({ phase: 'unsupported' })
      return
    }
    const found = resolveDriverCommand({
      configured: this.config.command,
      env: process.env,
      platform: CuaDriverComputerUse.platform,
      execPath: process.execPath,
      resourcesPath: (process as { resourcesPath?: string }).resourcesPath,
    })
    // Only macOS downloads the pinned release when nothing is bundled; Windows ships it bundled once its smoke exists.
    if (found === undefined && this.platform !== 'darwin') {
      this.set({ phase: 'unavailable', detail: 'This installation has no computer-use driver.' })
      return
    }
    const generation = ++this.generation
    this.set({ phase: 'starting', detail: undefined, driverVersion: PINNED_DRIVER_VERSION })
    const fiber = this.ctx.plugin({
      name: 'computer-use-cua-driver-session',
      inject: ['computerUse', 'tools'],
      apply: async (session: Context) => this.runSession(session, await this.verifiedDriver(found), generation),
    })
    this.session = fiber
    Promise.resolve(fiber).then(() => {
      if (generation !== this.generation) return
      this.restarts = 0
      this.set({ phase: 'ready', toolCount: this.toolCount() })
    }, (error: unknown) => {
      if (generation !== this.generation) return
      this.session = undefined
      this.set({ phase: 'error', toolCount: undefined, detail: message(error) })
    })
  }

  private async runSession(session: Context, command: string, generation: number): Promise<void> {
    if (this.platform === 'darwin') await this.readPermissions()
    const env = driverEnvironment(process.env, ensureDriverHome(dshHomePath('computer-use', 'cua-driver')),
      this.config.hostBundleId, this.config.environment)
    const daemon = await startDaemon({ command, env, timeoutMs: this.config.startupTimeoutMs })
    session.effect(() => () => daemon.stop(), 'computer-use-cua-driver.daemon')
    void daemon.exited.then(() => { this.daemonExited(daemon, generation) })
    const proxyArgs = ['mcp', '--embedded', '--socket', daemon.socket]
    if (this.platform === 'darwin') await this.readDriverPermissions(command, proxyArgs, env)
    const connection = McpClient.Config({
      transport: 'stdio',
      serverName: COMPUTER_USE_SERVER,
      command,
      args: proxyArgs,
      env,
      toolCallTimeoutMs: this.config.toolCallTimeoutMs,
      failOnStartupError: true,
      // The daemon, not the proxy, holds driver state: a lost daemon restarts the whole session.
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 5000, maxAttempts: 3 },
    })
    // One effect orders MCP teardown before the provider slot is released.
    let child!: Fiber
    session.effect(function* () {
      yield session.computerUse.register(ComputerUseProviderName('cua-driver'))
      child = session.plugin(McpClient, connection)
      yield child.dispose
    }, 'computer-use-cua-driver.connection')
    await child.await()
  }

  /**
   * The executable to run, checked against the pin: a configured path runs as
   * given; a bundled copy must carry the pinned version marker (its bytes are
   * covered by the app's code signature, which re-signing changes); otherwise
   * the pinned release is downloaded once into the Harness home and its
   * archive and executable hashes are checked.
   */
  private async verifiedDriver(found: DriverCommand | undefined): Promise<string> {
    if (found?.source === 'configured') return found.path
    if (found?.source === 'bundled') {
      const version = installedVersion(dirname(found.path))
      if (version !== PINNED_DRIVER_VERSION) {
        throw new Error(`The bundled driver is ${version ?? 'unversioned'}, not the pinned ${PINNED_DRIVER_VERSION}.`)
      }
      return found.path
    }
    const platform = CuaDriverComputerUse.platform
    const asset = PINNED_RELEASE.assets[assetKey(platform, process.arch)]
    if (asset === undefined) throw new Error(`No pinned driver build for ${assetKey(platform, process.arch)}.`)
    this.set({ detail: `Getting driver ${PINNED_DRIVER_VERSION}.` })
    const path = await installDriver({
      release: PINNED_RELEASE,
      asset,
      cacheDir: dshHomePath('computer-use', 'downloads'),
      outputDir: dshHomePath('computer-use', 'driver', PINNED_DRIVER_VERSION),
      executable: driverExecutableName(platform),
      fetch: CuaDriverComputerUse.fetch,
    })
    this.set({ detail: undefined })
    return path
  }

  private daemonExited(daemon: DaemonHandle, generation: number): void {
    if (this.closed || generation !== this.generation || this.session === undefined) return
    const output = daemon.output().trim()
    this.stopSession()
    if (!this.ctx.computerUse.enabled) return
    if (this.restarts >= this.config.maxRestarts) {
      this.set({ phase: 'error', toolCount: undefined,
        detail: `The computer-use driver stopped${output === '' ? '' : `: ${output.split('\n').at(-1) ?? ''}`}` })
      return
    }
    const delay = RESTART_DELAYS_MS[Math.min(this.restarts, RESTART_DELAYS_MS.length - 1)] ?? 30_000
    this.restarts += 1
    this.set({ phase: 'starting', toolCount: undefined, detail: 'The computer-use driver stopped; restarting.' })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (!this.closed && this.ctx.computerUse.enabled && this.session === undefined) this.start()
    }, delay)
  }

  private restart(): void {
    this.stopSession()
    if (this.ctx.computerUse.enabled) this.start()
  }

  private stopSession(): void {
    const session = this.session
    if (session === undefined) return
    this.session = undefined
    this.generation += 1
    void session.dispose()
  }

  private toolCount(): number {
    return this.ctx.tools.schemas().filter(schema => schema.name.startsWith(COMPUTER_USE_TOOL_PREFIX)).length
  }

  /** Fresh macOS grants through osascript; also used before the driver runs. */
  private async readPermissions(): Promise<MacPermissions | undefined> {
    if (this.platform !== 'darwin') return undefined
    try {
      const live = await readMacPermissions(CuaDriverComputerUse.osaScript)
      this.set({ accessibility: state(live.accessibility), screenRecording: state(live.screenRecording) })
      return live
    } catch (error: unknown) {
      this.ctx.logger.warn(`computer use: permission check failed: ${message(error)}`)
      return undefined
    }
  }

  /** The driver's own view: embedded check_permissions reports Ahel Desktop's grants. */
  private async readDriverPermissions(command: string, args: string[], env: Record<string, string>): Promise<void> {
    try {
      const result = await probeTool({ command, args, env, timeoutMs: 15_000 }, 'check_permissions', { prompt: false })
      const structured = result.structuredContent
      if (structured === undefined) return
      const source = structured.source as { attribution?: unknown } | undefined
      if (source?.attribution !== undefined && source.attribution !== 'host') {
        this.ctx.logger.warn(`computer use: the driver reports ${JSON.stringify(source.attribution)} attribution, not host`)
      }
      this.set({
        accessibility: state(structured.accessibility === true),
        screenRecording: state(structured.screen_recording === true),
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(`computer use: driver permission check failed: ${message(error)}`)
    }
  }

  private set(patch: { [K in keyof ComputerUseDriverStatus]?: ComputerUseDriverStatus[K] | undefined }): void {
    const next: Record<string, unknown> = { ...this.status }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) Reflect.deleteProperty(next, key)
      else next[key] = value
    }
    this.status = next as unknown as ComputerUseDriverStatus
    for (const listener of this.listeners) listener()
  }
}

function state(granted: boolean): ComputerUsePermission {
  return granted ? 'granted' : 'missing'
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
