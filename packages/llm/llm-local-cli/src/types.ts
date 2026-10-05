/** Client-safe view of the coding CLIs installed on this computer; no credential or environment value crosses it. */

/** The CLIs Ahel Desktop can run on the person's own sign-in. */
export type LocalCliId = 'claude-code' | 'codex-cli' | 'gemini-cli'

/** Every {@link LocalCliId}, in display order. */
export const LOCAL_CLI_IDS: readonly LocalCliId[] = ['claude-code', 'codex-cli', 'gemini-cli']

/** Plain-text row label; vendors bill the person directly, so labels name the installed tool, never Ahel. */
export type LocalCliLabel = 'Claude Code (installed)' | 'Codex (installed)' | 'Gemini CLI (installed)'

/**
 * One detected (or missing) CLI.
 * `login` comes from the CLI's own status command exit code; `unknown` when the CLI has none or the probe timed out.
 */
export interface LocalCliView {
  readonly id: LocalCliId
  readonly label: LocalCliLabel
  readonly installed: boolean
  /** Resolved executable path, when installed. */
  readonly path?: string
  /** First semver printed by `--version`, when it answered. */
  readonly version?: string
  /** The version answered and meets the minimum this bridge supports. */
  readonly versionOk: boolean
  readonly login: 'signed-in' | 'signed-out' | 'unknown'
  /** The person turned this CLI on in Settings > Models (stored in this plugin's config). */
  readonly enabled: boolean
  /** Vendor install page. */
  readonly installUrl: string
  /** How the person signs in to the CLI themselves; Ahel Desktop never signs in for them. */
  readonly signInHint: string
}
