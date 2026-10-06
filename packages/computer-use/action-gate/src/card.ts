/** Plain-language description of one write, for the approval card and the activity log. */

import { argsOf, type ResolvedTarget } from './observation.ts'

/** Longest argument JSON kept on a card. */
const ARGS_LIMIT = 4000

/** What a card says about one write. */
export interface ActionText {
  readonly summary: string
  readonly text: string | null
  readonly keys: string | null
  readonly args: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap(item => typeof item === 'string' ? [item] : []) : []
}

/** `AXButton` → `button`. */
function roleName(role: string): string {
  return role.replace(/^AX/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

function elementPhrase(target: ResolvedTarget): string {
  const element = target.element
  if (element !== null) return element.label === null ? `a ${roleName(element.role)}` : `“${element.label}” ${roleName(element.role)}`
  if (target.point !== null) return `the point (${String(Math.round(target.point.x))}, ${String(Math.round(target.point.y))})`
  return 'the focused element'
}

function inApp(target: ResolvedTarget): string {
  return target.app === null ? '' : ` in ${target.app}`
}

/**
 * Describe one write.
 * @param rawName - raw Cua tool name.
 * @param args - the call's arguments.
 * @param target - the resolved target.
 * @returns summary line, exact text or keys, and the argument JSON.
 */
export function describeAction(rawName: string, args: unknown, target: ResolvedTarget): ActionText {
  const a = argsOf(args)
  let json = JSON.stringify(a, null, 2)
  if (json.length > ARGS_LIMIT) json = `${json.slice(0, ARGS_LIMIT)}\n…`
  const base = { text: null, keys: null, args: json }
  const on = elementPhrase(target)
  switch (rawName) {
    case 'click':
      return { ...base, summary: `${text(a['button']) === 'right' ? 'Right-click' : 'Click'} ${on}${inApp(target)}` }
    case 'double_click':
      return { ...base, summary: `Double-click ${on}${inApp(target)}` }
    case 'right_click':
      return { ...base, summary: `Right-click ${on}${inApp(target)}` }
    case 'drag':
      return { ...base, summary: `Drag from ${on}${inApp(target)}` }
    case 'scroll':
      return { ...base, summary: `Scroll${text(a['direction']) === null ? '' : ` ${String(text(a['direction']))}`}${inApp(target)}` }
    case 'move_cursor':
      return { ...base, summary: `Move the pointer to ${on}${inApp(target)}` }
    case 'type_text':
      return { ...base, summary: `Type into ${on}${inApp(target)}`, text: text(a['text']) }
    case 'set_value':
      return { ...base, summary: `Set ${on}${inApp(target)}`, text: text(a['value']) }
    case 'press_key': {
      const keys = [...list(a['modifiers']), text(a['key']) ?? '?'].join('+')
      return { ...base, summary: `Press ${keys}${inApp(target)}`, keys }
    }
    case 'hotkey': {
      const keys = list(a['keys']).join('+')
      return { ...base, summary: `Press ${keys}${inApp(target)}`, keys }
    }
    case 'invoke_menu':
      return { ...base, summary: `Choose ${list(a['path']).join(' › ')}${inApp(target)}` }
    case 'launch_app':
      return { ...base, summary: `Open ${target.app ?? target.bundleId ?? 'an app'}`, text: target.urls.length === 0 ? null : target.urls.join('\n') }
    case 'bring_to_front':
      return { ...base, summary: `Bring ${target.app ?? 'a window'} to the front` }
    case 'set_window_frame':
      return { ...base, summary: `Move or resize a window${inApp(target)}` }
    case 'clipboard_write':
      return { ...base, summary: 'Put text on the clipboard', text: text(a['text']) }
    case 'browser_navigate':
      return { ...base, summary: `Open a web page${inApp(target)}`, text: text(a['url']) }
    case 'browser_type':
      return { ...base, summary: `Type into a web page${inApp(target)}`, text: text(a['text']) }
    case 'browser_click':
      return { ...base, summary: `Click in a web page${inApp(target)}` }
    case 'browser_dialog':
      return { ...base, summary: `Answer a web page dialog${inApp(target)}` }
    case 'page':
      return { ...base, summary: `Web page action ${text(a['action']) ?? ''}${inApp(target)}`.trim(), text: text(a['text']) ?? text(a['url']) }
    default:
      return { ...base, summary: `${rawName}${inApp(target)}` }
  }
}
