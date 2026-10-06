/**
 * macOS Accessibility and Screen Recording for Ahel Desktop.
 *
 * Reads run in a short `osascript` child of the Host. Like the embedded
 * driver, that child stays in Ahel Desktop's responsibility chain, so macOS
 * answers for Ahel Desktop. Nothing here raises a prompt, touches the Keychain
 * or asks for a password; a missing grant opens System Settings. A fresh process
 * answers every read, so a grant or revocation (including the monthly Screen
 * Recording re-confirmation on macOS 15 and later) shows on the next check.
 */

import { execFile } from 'node:child_process'
import type { ComputerUseSettingsPane } from './types.ts'

/** Live macOS grants of the responsible app. */
export interface MacPermissions {
  readonly accessibility: boolean
  readonly screenRecording: boolean
}

const OSASCRIPT = '/usr/bin/osascript'

// CGPreflightScreenCaptureAccess has no JXA bridge metadata, so it is bound by signature.
const PREFLIGHT = [
  'ObjC.import("ApplicationServices")',
  'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []])',
  'JSON.stringify({ accessibility: $.AXIsProcessTrusted(), screenRecording: $.CGPreflightScreenCaptureAccess() })',
].join('; ')

/** Runs one JXA script and returns its stdout; injectable for tests. */
export type ScriptRunner = (script: string, timeoutMs: number) => Promise<string>

/** Default runner: `/usr/bin/osascript -l JavaScript -e <script>`. */
export const runOsaScript: ScriptRunner = (script, timeoutMs) => new Promise((resolve, reject) => {
  execFile(OSASCRIPT, ['-l', 'JavaScript', '-e', script], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => {
    if (error !== null) reject(new Error(`computer use: osascript failed: ${error.message}`, { cause: error }))
    else resolve(stdout)
  })
})

function parse(output: string): MacPermissions {
  const value = JSON.parse(output.trim()) as { accessibility?: unknown; screenRecording?: unknown }
  return { accessibility: value.accessibility === true, screenRecording: value.screenRecording === true }
}

/**
 * Read both grants without any prompt.
 * @param run - script runner.
 * @returns the live grants.
 */
export async function readMacPermissions(run: ScriptRunner = runOsaScript): Promise<MacPermissions> {
  return parse(await run(PREFLIGHT, 10_000))
}

/**
 * Deep link into System Settings > Privacy & Security for one pane.
 * @param pane - the permission to show.
 * @returns the `x-apple.systempreferences:` URL.
 */
export function systemSettingsUrl(pane: ComputerUseSettingsPane): string {
  return pane === 'accessibility'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

/**
 * Open System Settings at one Privacy & Security pane.
 * @param pane - the permission to show.
 * @returns after `open` hands the URL to macOS.
 */
export function openSystemSettings(pane: ComputerUseSettingsPane): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', [systemSettingsUrl(pane)], { timeout: 10_000 }, (error) => {
      if (error !== null) reject(new Error(`computer use: could not open System Settings: ${error.message}`, { cause: error }))
      else resolve()
    })
  })
}
