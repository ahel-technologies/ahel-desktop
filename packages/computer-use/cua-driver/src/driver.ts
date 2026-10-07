/**
 * The bundled `cua-driver` executable: where it lives, the environment it runs
 * in, and its embedded daemon. The daemon is a direct child of the Host, so
 * macOS charges Accessibility and Screen Recording to Ahel Desktop (the
 * responsible process) and the driver never prompts on its own.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Executable name inside the packaged app's `Resources/cua-driver/` folder. */
export function driverExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
}

/** Inputs of {@link resolveDriverCommand}; the defaults are the running process. */
export interface DriverLocation {
  /** Explicit path from the profile entry; empty means the bundled driver. */
  readonly configured: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  /** The Host's executable: Ahel Desktop's Electron binary in Node mode. */
  readonly execPath: string
  /** Electron's resources folder when the runtime exposes it. */
  readonly resourcesPath: string | undefined
}

/** Where a driver executable came from. */
export interface DriverCommand {
  readonly path: string
  /**
   * - `configured`: the profile's `command` or `AHEL_CUA_DRIVER_PATH`, run as given.
   * - `bundled`: the copy packaged in `Resources/cua-driver/`, covered by the app's signature.
   */
  readonly source: 'configured' | 'bundled'
}

/**
 * Find the driver: the profile's `command`, then `AHEL_CUA_DRIVER_PATH`, then
 * the copy packaged in `Resources/cua-driver/`.
 * @param location - configuration and process facts.
 * @returns the executable and its source, or undefined when this installation has none.
 */
export function resolveDriverCommand(location: DriverLocation): DriverCommand | undefined {
  if (location.configured !== '') return { path: location.configured, source: 'configured' }
  const override = location.env.AHEL_CUA_DRIVER_PATH
  if (override !== undefined && override !== '') return { path: override, source: 'configured' }
  const name = driverExecutableName(location.platform)
  const resources = location.resourcesPath ?? (location.platform === 'darwin'
    // <App>.app/Contents/MacOS/<exe> → <App>.app/Contents/Resources
    ? join(dirname(location.execPath), '..', 'Resources')
    : join(dirname(location.execPath), 'resources'))
  const candidate = join(resources, 'cua-driver', name)
  return existsSync(candidate) ? { path: candidate, source: 'bundled' } : undefined
}

/**
 * The driver's environment. Embedded mode keeps TCC on the host; telemetry,
 * update checks and Cua's own home stay off or private to Ahel Desktop.
 * @param base - the Host environment.
 * @param home - private driver home (config, sessions, recordings).
 * @param hostBundleId - Ahel Desktop's bundle id, echoed by check_permissions.
 * @param extra - profile-supplied tuning variables (for example CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS).
 * @returns the child environment.
 */
export function driverEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  home: string,
  hostBundleId: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    // Electron's Node-mode switch must not leak into a non-Electron child.
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return {
    ...env,
    ...extra,
    CUA_DRIVER_EMBEDDED: '1',
    CUA_DRIVER_HOST_BUNDLE_ID: hostBundleId,
    CUA_DRIVER_RS_HOME: home,
    DO_NOT_TRACK: '1',
    CUA_TELEMETRY: '0',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    CUA_DRIVER_RS_UPDATE_CHECK: 'false',
  }
}

/** A running embedded daemon. */
export interface DaemonHandle {
  /** Private socket the MCP proxy connects to. */
  readonly socket: string
  /** Resolves when the daemon exits, for any reason. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  /** Last bytes the daemon wrote, for diagnostics. */
  output(): string
  /** Stop the daemon and remove its private folder; idempotent. */
  stop(): Promise<void>
}

/** Options of {@link startDaemon}. */
export interface DaemonOptions {
  readonly command: string
  readonly env: Readonly<Record<string, string>>
  /** Longest wait for the socket to appear. */
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

const OUTPUT_LIMIT = 4096
const POLL_MS = 50

/**
 * Spawn `cua-driver serve --embedded --socket <private>` and wait until its socket exists.
 * The socket lives in a fresh 0700 folder under the system temp directory, kept
 * short because Unix socket paths are limited to about 100 bytes on macOS.
 * @param options - executable, environment and startup budget.
 * @returns the running daemon.
 */
export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const folder = mkdtempSync(join(tmpdir(), 'ahel-cua-'))
  const socket = join(folder, 'd.sock')
  let output = ''
  let child: ChildProcess
  try {
    child = spawn(options.command, ['serve', '--embedded', '--socket', socket], {
      env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
  } catch (error: unknown) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
  const append = (chunk: Buffer): void => { output = (output + chunk.toString('utf8')).slice(-OUTPUT_LIMIT) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  let spawnError: Error | undefined
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('error', (error) => { spawnError = error; resolve({ code: null, signal: null }) })
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  let stopping: Promise<void> | undefined
  const handle: DaemonHandle = {
    socket,
    exited,
    output: () => output,
    stop: () => stopping ??= (async () => {
      if (child.exitCode === null && child.signalCode === null && spawnError === undefined) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => { child.kill('SIGKILL') }, 3000)
        await exited
        clearTimeout(timer)
      }
      rmSync(folder, { recursive: true, force: true })
    })(),
  }
  const state = { done: false }
  void exited.then(() => { state.done = true })
  const deadline = Date.now() + options.timeoutMs
  while (!existsSync(socket)) {
    if (state.done || spawnError !== undefined) {
      await handle.stop()
      const reason = spawnError?.message ?? `exited before it was ready${output.trim() === '' ? '' : `: ${output.trim()}`}`
      throw new Error(`computer use: the driver ${reason}`)
    }
    if (options.signal?.aborted === true || Date.now() > deadline) {
      await handle.stop()
      throw new Error(options.signal?.aborted === true
        ? 'computer use: driver start was cancelled'
        : `computer use: the driver did not open its socket within ${String(options.timeoutMs)} ms`)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
  return handle
}

/**
 * Create the driver's private home (sessions, config, recordings) once.
 * @param path - folder under the Harness home.
 * @returns the same path.
 */
export function ensureDriverHome(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}
