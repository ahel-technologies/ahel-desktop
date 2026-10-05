/**
 * Finding and probing the installed `claude`, `codex` and `gemini` binaries.
 * Resolution order per CLI: its `AHEL_*_PATH` override, then a walk of the
 * inherited PATH (the Desktop Host already carries the login-shell PATH),
 * then known install locations. Probes run `--version` and the CLI's own
 * login-status command and read only exit codes and version text; no
 * credential file, keychain item or environment value is read or logged.
 * Windows paths follow the vendors' documented install locations and are
 * untested.
 * @module @ahel/dsh-llm-local-cli/detect
 */

import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { LocalCliId, LocalCliLabel, LocalCliView } from './types.ts'

/** Platform facts that decide where a CLI may live. */
export interface DetectEnvironment {
  /** Inherited environment; only PATH, the `AHEL_*_PATH` overrides, USERPROFILE and APPDATA are read. */
  readonly env: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  readonly home: string
}

/** One probe run's facts; `timedOut` and `failed` (could not start) are distinct from a non-zero exit. */
export interface ProbeResult {
  readonly exitCode: number | null
  readonly output: string
  readonly timedOut: boolean
  readonly failed: boolean
}

/** Runs one argv with a deadline and collects stdout and stderr. */
export type ProbeRunner = (argv: readonly string[], timeoutMs: number) => Promise<ProbeResult>

/** Side effects of detection, injectable for tests. */
export interface DetectDeps extends DetectEnvironment {
  isExecutable(path: string): Promise<boolean>
  run: ProbeRunner
}

/** What the bridge knows about one CLI. */
export interface CliDescriptor {
  readonly id: LocalCliId
  readonly label: LocalCliLabel
  /** Bare command name looked up on PATH. */
  readonly command: string
  /** Environment variable naming an explicit executable path. */
  readonly envOverride: string
  /** Lowest `--version` this bridge supports. */
  readonly minVersion: string
  /** Arguments of the CLI's own login-status command (exit 0 = signed in); absent when the CLI has none. */
  readonly loginStatusArgs?: readonly string[]
  readonly installUrl: string
  readonly signInHint: string
  /** Known install locations after PATH, in order. */
  extraCandidates(environment: DetectEnvironment): string[]
}

const appBundles = (home: string, app: string): string[] => [
  `/Applications/${app}.app/Contents/Resources/codex`,
  posix.join(home, 'Applications', `${app}.app`, 'Contents', 'Resources', 'codex'),
]

/** npm's global `.cmd` shim location on Windows. */
function npmShim(environment: DetectEnvironment, command: string): string[] {
  const appData = environment.env.APPDATA
  return appData === undefined ? [] : [win32.join(appData, 'npm', `${command}.cmd`)]
}

/** Descriptors in display order. */
export const CLI_DESCRIPTORS: readonly CliDescriptor[] = [
  {
    id: 'claude-code',
    label: 'Claude Code (installed)',
    command: 'claude',
    envOverride: 'AHEL_CLAUDE_PATH',
    minVersion: '2.0.0',
    loginStatusArgs: ['auth', 'status'],
    installUrl: 'https://code.claude.com/docs/en/setup',
    signInHint: 'Open Terminal and run: claude auth login',
    extraCandidates(environment) {
      if (environment.platform === 'win32') {
        const profile = environment.env.USERPROFILE ?? environment.home
        return [win32.join(profile, '.local', 'bin', 'claude.exe'), ...npmShim(environment, 'claude')]
      }
      return [posix.join(environment.home, '.claude', 'local', 'claude')]
    },
  },
  {
    id: 'codex-cli',
    label: 'Codex (installed)',
    command: 'codex',
    envOverride: 'AHEL_CODEX_PATH',
    minVersion: '0.100.0',
    loginStatusArgs: ['login', 'status'],
    installUrl: 'https://developers.openai.com/codex/cli',
    signInHint: 'Open Terminal and run: codex login',
    extraCandidates(environment) {
      if (environment.platform === 'win32') return npmShim(environment, 'codex')
      if (environment.platform !== 'darwin') return []
      return [...appBundles(environment.home, 'ChatGPT'), ...appBundles(environment.home, 'Codex')]
    },
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI (installed)',
    command: 'gemini',
    envOverride: 'AHEL_GEMINI_PATH',
    // `--output-format stream-json` first shipped in 0.11.0. Gemini has no login-status command, so login
    // stays 'unknown' and the first turn reports a missing sign-in.
    minVersion: '0.11.0',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
    signInHint: 'Open Terminal, run gemini, and choose Sign in with Google',
    extraCandidates(environment) {
      return environment.platform === 'win32' ? npmShim(environment, 'gemini') : []
    },
  },
]

/**
 * Every path to try, in resolution order, without duplicates.
 * @param descriptor - the CLI.
 * @param environment - PATH, overrides and home.
 * @returns candidate executable paths.
 */
export function candidatePaths(descriptor: CliDescriptor, environment: DetectEnvironment): string[] {
  const windows = environment.platform === 'win32'
  const path = windows ? win32 : posix
  const names = windows ? [`${descriptor.command}.exe`, `${descriptor.command}.cmd`] : [descriptor.command]
  const override = environment.env[descriptor.envOverride]
  const pathValue = environment.env.PATH ?? (windows ? environment.env.Path : undefined) ?? ''
  const fromPath = pathValue.split(path.delimiter)
    .filter(dir => dir !== '' && path.isAbsolute(dir))
    .flatMap(dir => names.map(name => path.join(dir, name)))
  const all = [...override !== undefined && override !== '' ? [override] : [], ...fromPath, ...descriptor.extraCandidates(environment)]
  return [...new Set(all)]
}

/**
 * The first semver-shaped `x.y.z` in a version banner.
 * @param text - `--version` output, e.g. `2.0.14 (Claude Code)` or `codex-cli 0.101.0`.
 * @returns the version, or undefined when none is printed.
 */
export function parseVersion(text: string): string | undefined {
  return /\d+\.\d+\.\d+/.exec(text)?.[0]
}

/**
 * Numeric `x.y.z` comparison.
 * @param a - left version.
 * @param b - right version.
 * @returns negative, zero or positive.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/**
 * The argv that runs an executable; Windows `.cmd` shims go through `cmd.exe /c`.
 * @param executable - resolved path.
 * @param args - arguments.
 * @param platform - host platform.
 * @returns argv for the subprocess seam.
 */
export function commandArgv(executable: string, args: readonly string[], platform: NodeJS.Platform): string[] {
  return platform === 'win32' && /\.cmd$/i.test(executable)
    ? ['cmd.exe', '/d', '/s', '/c', executable, ...args]
    : [executable, ...args]
}

/**
 * Default executable check: X_OK on POSIX, existence on Windows (where X_OK means F_OK).
 * @param path - candidate.
 * @returns whether the file can be run.
 */
export async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The detection facts of one CLI; enable state is added by the service. */
export type DetectedCli = Omit<LocalCliView, 'enabled'>

/**
 * Resolve, version-check and login-check one CLI.
 * @param descriptor - the CLI.
 * @param deps - environment and side effects.
 * @param timeoutMs - deadline for each probe.
 * @returns the detection facts; a timed-out probe keeps `installed: true` with `versionOk: false` and `login: 'unknown'`.
 */
export async function detectCli(descriptor: CliDescriptor, deps: DetectDeps, timeoutMs: number): Promise<DetectedCli> {
  const base = { id: descriptor.id, label: descriptor.label, installUrl: descriptor.installUrl, signInHint: descriptor.signInHint }
  let executable: string | undefined
  for (const candidate of candidatePaths(descriptor, deps)) {
    if (await deps.isExecutable(candidate)) {
      executable = candidate
      break
    }
  }
  if (executable === undefined) return { ...base, installed: false, versionOk: false, login: 'unknown' }
  const probe = await deps.run(commandArgv(executable, ['--version'], deps.platform), timeoutMs)
  const version = probe.timedOut || probe.failed ? undefined : parseVersion(probe.output)
  const found = { ...base, installed: true, path: executable, ...version === undefined ? {} : { version } }
  if (version === undefined || compareVersions(version, descriptor.minVersion) < 0) return { ...found, versionOk: false, login: 'unknown' }
  if (descriptor.loginStatusArgs === undefined) return { ...found, versionOk: true, login: 'unknown' }
  const status = await deps.run(commandArgv(executable, descriptor.loginStatusArgs, deps.platform), timeoutMs)
  const login = status.timedOut || status.failed || status.exitCode === null ? 'unknown' : status.exitCode === 0 ? 'signed-in' : 'signed-out'
  return { ...found, versionOk: true, login }
}
