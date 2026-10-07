/**
 * Read/write classification of Cua Driver MCP tool names. The tables are the
 * whole policy: a name in neither table is denied.
 */

import type { ActionClass } from './types.ts'

/** Observations and driver housekeeping. They change nothing on the desktop, so they run without a card. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'list_apps',
  'list_windows',
  'get_window_state',
  'get_accessibility_tree',
  'get_desktop_state',
  'get_screen_size',
  'get_cursor_position',
  'get_agent_cursor_state',
  'check_permissions',
  'health_report',
  'zoom',
  'verify_state',
  'get_browser_state',
  'start_session',
  'end_session',
  'get_session',
  'get_session_state',
  'list_sessions',
])

/** Actions that change the desktop. Each one waits for a click on the approval card. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'click',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'move_cursor',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'invoke_menu',
  'launch_app',
  'bring_to_front',
  'set_window_frame',
  'clipboard_write',
  'page',
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_dialog',
])

/** Driver tools that are always refused, with the reason the model sees. */
export const REFUSED_TOOLS: ReadonlyMap<string, string> = new Map([
  ['run_actions', 'Batched actions are off. Send one action per call so each can be approved.'],
  ['kill_app', 'Quitting apps by force is not allowed.'],
  ['set_config', 'Changing the driver configuration is not allowed.'],
  ['clipboard_read', 'Reading the clipboard is not allowed.'],
  ['set_agent_cursor_enabled', 'The agent cursor stays visible while computer use runs.'],
  ['set_agent_cursor_motion', 'The agent cursor settings are fixed.'],
  ['set_agent_cursor_theme', 'The agent cursor settings are fixed.'],
  ['browser_prepare', 'Attaching to a browser profile is not allowed.'],
  ['browser_set_input_files', 'Uploading files through the browser is not allowed.'],
])

/**
 * Classify one raw Cua tool name.
 * @param rawName - the tool name without the `mcp__<server>__` prefix.
 * @returns `read`, `write`, or `unknown` (denied).
 */
export function classify(rawName: string): ActionClass {
  if (READ_TOOLS.has(rawName)) return 'read'
  if (WRITE_TOOLS.has(rawName)) return 'write'
  return 'unknown'
}
