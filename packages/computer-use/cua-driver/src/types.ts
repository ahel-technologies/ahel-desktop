/** Shared values of the Cua Driver computer-use provider: Host service and Settings row. */

/** MCP server id of the bundled driver; its tools are `mcp__ahel-computer__<driver tool>`. */
export const COMPUTER_USE_SERVER = 'ahel-computer'

/** Prefix of every model-facing tool name the driver contributes. */
export const COMPUTER_USE_TOOL_PREFIX = `mcp__${COMPUTER_USE_SERVER}__`

/**
 * Where the driver stands.
 * - `off`: the `computerUse.enabled` setting is off.
 * - `unsupported`: this operating system has no driver build.
 * - `unavailable`: the driver executable is missing from this installation.
 * - `starting`: the driver is starting or restarting.
 * - `ready`: the driver's tools are registered.
 * - `error`: the driver failed; `detail` says why.
 */
export type ComputerUseDriverPhase = 'off' | 'unsupported' | 'unavailable' | 'starting' | 'ready' | 'error'

/** One operating-system permission, as the Host last read it. */
export type ComputerUsePermission = 'granted' | 'missing' | 'unknown' | 'not-required'

/** Settings panes the row links to on macOS. */
export type ComputerUseSettingsPane = 'accessibility' | 'screen-recording'

/** Complete status the Settings row renders. */
export interface ComputerUseDriverStatus {
  /** The `computerUse.enabled` setting. */
  readonly enabled: boolean
  readonly phase: ComputerUseDriverPhase
  readonly platform: 'darwin' | 'win32' | 'other'
  /** macOS Accessibility for Ahel Desktop; `not-required` on Windows. */
  readonly accessibility: ComputerUsePermission
  /** macOS Screen Recording for Ahel Desktop; `not-required` on Windows. */
  readonly screenRecording: ComputerUsePermission
  /** Pinned driver release, when the executable is present. */
  readonly driverVersion?: string
  /** Number of driver tools registered while `ready`. */
  readonly toolCount?: number
  /** Last failure, in plain words. */
  readonly detail?: string
}
