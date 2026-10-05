/**
 * "Use what you already have": finds the Claude Code, Codex and Gemini CLIs
 * the person installed and signed into themselves, and stores which of them
 * they turned on. This package never reads, stores or forwards a CLI
 * credential; probes run the unmodified binaries through `ctx.subprocess`
 * (scrubbed environment, cwd = the OS temp directory) and read exit codes and
 * version text only.
 *
 * The Remote namespace `localCli` exposes list, detect, enable, disable and
 * watch. Every change is also emitted as `local-cli/changed`; each CLI that
 * is installed, recent enough and turned on is served as a model route
 * (`claude-code`, `codex-cli`) that runs the CLI headless, see `./bridge.ts`.
 *
 * @module @ahel/dsh-llm-local-cli
 */

import { homedir, tmpdir } from 'node:os'
import type { Context, Volatile } from '@ahel/cordis'
import type {} from '@ahel/dsh-agent-default-model'
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-config-editor'
import type { AdapterRegistrationHandle } from '@ahel/dsh-llm'
import type {} from '@ahel/dsh-subprocess'
import Schema from '@ahel/schemastery'
import { Remote, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import type { BridgeHost, LocalCliAdapter } from './bridge.ts'
import { ClaudeCodeAdapter } from './claude.ts'
import { CodexCliAdapter } from './codex.ts'
import { CLI_DESCRIPTORS, detectCli, isExecutableFile } from './detect.ts'
import type { DetectDeps, DetectedCli, ProbeResult } from './detect.ts'
import { LOCAL_CLI_IDS } from './types.ts'
import type { LocalCliId, LocalCliView } from './types.ts'

export type { LocalCliId, LocalCliLabel, LocalCliView } from './types.ts'
export { LOCAL_CLI_IDS } from './types.ts'
export { CLI_DESCRIPTORS, candidatePaths, commandArgv, compareVersions, parseVersion } from './detect.ts'
export { LOCAL_CLI_SIGNED_OUT_CODE, LocalCliAdapter } from './bridge.ts'
export type { BridgeHost, CliEvent, CliInvocation, InvocationRequest, LocalCliModel } from './bridge.ts'
export { AHEL_MCP_URL, CLAUDE_MODELS, ClaudeCodeAdapter, ahelMcpConfig, claudeArgs, parseClaudeLine } from './claude.ts'
export { CODEX_MODELS, CodexCliAdapter, codexArgs, codexPrompt, parseCodexLine } from './codex.ts'
export { renderTranscript, systemText } from './transcript.ts'
export type { RenderedPrompt } from './transcript.ts'
export type { CliDescriptor, DetectEnvironment, ProbeResult, ProbeRunner } from './detect.ts'

declare module '@ahel/cordis' {
  interface Context {
    localCli: LocalCli
  }

  interface Events {
    /**
     * The detected CLIs or their enable state changed.
     * @param views - the complete list, in `LOCAL_CLI_IDS` order.
     * @mode emit
     */
    'local-cli/changed'(views: readonly LocalCliView[]): void
  }
}

/** Plugin configuration. */
export interface Config {
  /** Which CLIs the person turned on, by id; written by `enable` and `disable`. */
  enabled?: Volatile<Readonly<Record<string, boolean>>>
  /** Deadline for each `--version` or login-status probe, in milliseconds. */
  probeTimeoutMs?: number
}

/** Validated configuration. */
export const Config = Schema.object({
  enabled: Schema.dict(Schema.boolean()).default({}).volatile(),
  probeTimeoutMs: Schema.number().min(100).max(60_000).default(5_000),
})

/** A detection requested within this long of the last one reuses its result. */
const DETECT_DEBOUNCE_MS = 2_000
/** Probe output kept in memory; a version banner is a few bytes. */
const PROBE_OUTPUT_MAX_BYTES = 64 * 1024

const isLocalCliId = (value: unknown): value is LocalCliId => (LOCAL_CLI_IDS as readonly unknown[]).includes(value)

/** Local CLI detection service; the default export loads it as a plugin. */
export class LocalCli extends TypertRemoteService {
  static inject = ['llm', 'subprocess']
  static Config = Config
  private readonly owner: Context
  private readonly enabledRef: Volatile<Readonly<Record<string, boolean>>>
  private readonly probeTimeoutMs: number
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private detected: readonly DetectedCli[] | undefined
  private running: Promise<readonly DetectedCli[]> | undefined
  private lastDetectAt = 0
  /** Model routes by CLI; a CLI without an entry is detected but not yet served. */
  private readonly adapters: Partial<Record<LocalCliId, LocalCliAdapter>>
  private readonly routes = new Map<LocalCliId, { handle: AdapterRegistrationHandle; active: boolean }>()

  /**
   * @param ctx - Host context with the subprocess service.
   * @param config - enable state and probe deadline.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'localCli')
    // The Loader hands a live volatile reference; parsing it again would replace it.
    const { enabled, ...plain } = config
    const resolved = Config(plain)
    this.enabledRef = enabled ?? resolved.enabled
    this.owner = ctx
    this.probeTimeoutMs = resolved.probeTimeoutMs
    const host = (id: LocalCliId): BridgeHost => ({
      spawn: spec => this.ctx.subprocess.spawn(spec),
      executable: () => {
        const cli = this.detected?.find(entry => entry.id === id)
        return cli?.installed === true && cli.versionOk ? cli.path : undefined
      },
      ahelToken: async () => {
        try {
          return await this.owner.get('ahelAccount')?.accessToken()
        } catch (_refreshFailed) {
          // A failed refresh leaves the turn without Ahel tools rather than failing it.
          return undefined
        }
      },
      platform: process.platform,
    })
    this.adapters = {
      'claude-code': new ClaudeCodeAdapter(host('claude-code'), 'Claude Code (installed)'),
      'codex-cli': new CodexCliAdapter(host('codex-cli'), 'Codex (installed)'),
    }
    ctx.on('local-cli/changed', (views) => { this.publishRoutes(views) })
    ctx.on('loader/volatile-update', () => { this.changed() })
    ctx.effect(() => () => {
      this.lifetime.abort()
      for (const listener of this.listeners) listener()
    }, 'local-cli.lifetime')
    void this.detect().catch((error: unknown) => {
      this.ctx.logger.warn(`local-cli: detection failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * The last detection with the current enable state; waits for the first detection.
   * @returns one view per CLI, in display order.
   */
  @Remote
  async list(): Promise<LocalCliView[]> {
    return this.views(this.detected ?? await (this.running ?? this.probeAll()))
  }

  /**
   * Re-probe every CLI concurrently. A call during a running detection joins
   * it; one within two seconds of the last reuses its result.
   * @returns the fresh views.
   */
  @Remote
  async detect(): Promise<LocalCliView[]> {
    if (this.running !== undefined) return this.views(await this.running)
    if (this.detected !== undefined && Date.now() - this.lastDetectAt < DETECT_DEBOUNCE_MS) return this.views(this.detected)
    return this.views(await this.probeAll())
  }

  /**
   * Turn a CLI on and save the choice in settings.
   * @param id - the CLI.
   * @returns the views after the change.
   */
  @Remote
  async enable(id: LocalCliId): Promise<LocalCliView[]> {
    const views = await this.setEnabled(id, true)
    const view = views.find(entry => entry.id === id)
    // The CLI just turned on becomes the default model while its route is served.
    if (this.adapters[id] !== undefined && view?.installed === true && view.versionOk) {
      await this.owner.get('agentDefaultModel')?.saveSelection({ provider: id, model: 'default' })
    }
    return views
  }

  /**
   * Turn a CLI off and save the choice in settings.
   * @param id - the CLI.
   * @returns the views after the change.
   */
  @Remote
  async disable(id: LocalCliId): Promise<LocalCliView[]> {
    const views = await this.setEnabled(id, false)
    // A saved default naming the route just removed would leave new chats without a model.
    const defaults = this.owner.get('agentDefaultModel')
    if (defaults?.configuredSelection()?.provider === id) await defaults.clearSelection()
    return views
  }

  /**
   * Subscribe to complete lists, starting with the current one.
   * @param signal - subscription lifetime.
   * @returns the list after every detection and enable change.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<LocalCliView[]> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.lifetime.signal.aborted && !signal.aborted) {
        if (dirty) {
          dirty = false
          yield await this.list()
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  private async setEnabled(id: LocalCliId, value: boolean): Promise<LocalCliView[]> {
    if (!isLocalCliId(id)) throw new Error(`local-cli: unknown CLI ${String(id)}`)
    const entry = this.owner.fiber.entry
    const editor = this.ctx.get('configEditor')
    if (entry === undefined || editor === undefined) throw new Error('local-cli: turning a CLI on or off needs a profile-backed Host')
    await editor.edit(entry, (current) => {
      const previous = typeof current.enabled === 'object' && current.enabled !== null ? current.enabled as Record<string, unknown> : {}
      return { ...current, enabled: { ...previous, [id]: value } }
    })
    this.changed()
    return this.list()
  }

  /** Serve each installed, recent enough and enabled CLI as a model route; withdraw the others. */
  private publishRoutes(views: readonly LocalCliView[]): void {
    for (const view of views) {
      const adapter = this.adapters[view.id]
      if (adapter === undefined) continue
      const active = view.installed && view.versionOk && view.enabled
      const route = this.routes.get(view.id)
      try {
        if (route === undefined) {
          if (active) this.routes.set(view.id, { handle: this.owner.llm.registerAdapter([view.id], adapter), active })
        } else if (route.active !== active) {
          route.handle.replace(active ? [view.id] : [])
          route.active = active
        }
      } catch (error) {
        this.ctx.logger.warn(`local-cli: the ${view.label} route could not be ${active ? 'added' : 'removed'}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private views(detected: readonly DetectedCli[]): LocalCliView[] {
    const enabled = this.enabledRef.get()
    return detected.map(cli => ({ ...cli, enabled: enabled[cli.id] === true }))
  }

  private probeAll(): Promise<readonly DetectedCli[]> {
    const deps: DetectDeps = {
      env: process.env,
      platform: process.platform,
      home: homedir(),
      isExecutable: isExecutableFile,
      run: (argv, timeoutMs) => this.runProbe(argv, timeoutMs),
    }
    const running = Promise.all(CLI_DESCRIPTORS.map(descriptor => detectCli(descriptor, deps, this.probeTimeoutMs)))
      .then((detected) => {
        this.detected = detected
        this.lastDetectAt = Date.now()
        this.changed()
        return detected
      })
      .finally(() => { if (this.running === running) this.running = undefined })
    this.running = running
    return running
  }

  private async runProbe(argv: readonly string[], timeoutMs: number): Promise<ProbeResult> {
    const deadline = AbortSignal.timeout(timeoutMs)
    try {
      const handle = this.ctx.subprocess.spawn({
        argv,
        cwd: tmpdir(),
        stdio: { stdin: 'ignore', stdout: { maxBytes: PROBE_OUTPUT_MAX_BYTES }, stderr: { maxBytes: PROBE_OUTPUT_MAX_BYTES } },
        graceMs: 1_000,
        signal: AbortSignal.any([deadline, this.lifetime.signal]),
      })
      const outcome = await handle.done
      const output = `${handle.collected.stdout?.readFrom(0).text ?? ''}\n${handle.collected.stderr?.readFrom(0).text ?? ''}`
      return { exitCode: outcome.exitCode, output, timedOut: deadline.aborted, failed: false }
    } catch {
      return { exitCode: null, output: '', timedOut: deadline.aborted, failed: true }
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
    if (this.detected !== undefined) this.ctx.emit('local-cli/changed', this.views(this.detected))
  }
}

export default LocalCli
