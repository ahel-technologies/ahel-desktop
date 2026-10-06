/**
 * macOS capture backend: the front window from the CoreGraphics window list,
 * its image from `screencapture -l`, and its visible text from the
 * Accessibility API when Ahel Desktop is already trusted.
 *
 * The window lookup script and the `screencapture` arguments are adapted from
 * T3 Code (https://github.com/pingdotgg/t3code, revision f21d6da51c9a,
 * `apps/desktop/src/snapShot/ActiveWindow.ts` and `MacSnapShot.ts`),
 * Copyright (c) 2026 T3 Tools Inc., MIT License; the notice is kept in
 * `LICENSE-t3code` next to this package's manifest.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FrontWindow, WindowCapturer } from './capture.ts'

const OSASCRIPT = '/usr/bin/osascript'
const SCREENCAPTURE = '/usr/sbin/screencapture'

/** Time limits of the three child processes, in milliseconds. */
export interface MacCaptureTimeouts {
  readonly lookupMs: number
  readonly screenshotMs: number
  readonly textMs: number
}

// The frontmost application's first on-screen layer-0 window, front to back;
// when that application is excluded (Ahel Desktop itself), the first other
// window. Window titles need Screen Recording.
const LOOKUP_SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
function run(argv) {
  const exclude = String(argv[0] || '').split(',').filter(Boolean).map(Number);
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const frontPid = front.isNil() ? -1 : front.processIdentifier;
  const list = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID);
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject(list)) || [];
  const usable = windows.filter(w => {
    const b = w.kCGWindowBounds || {};
    return w.kCGWindowLayer === 0 && exclude.indexOf(w.kCGWindowOwnerPID) < 0 && w.kCGWindowAlpha !== 0
      && (b.Width || 0) >= 40 && (b.Height || 0) >= 40;
  });
  const w = usable.find(item => item.kCGWindowOwnerPID === frontPid) || usable[0];
  if (!w) return '';
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(w.kCGWindowOwnerPID);
  return JSON.stringify({
    id: w.kCGWindowNumber,
    processId: w.kCGWindowOwnerPID,
    app: String((app.isNil() ? '' : ObjC.unwrap(app.localizedName)) || w.kCGWindowOwnerName || ''),
    title: String(w.kCGWindowName || ''),
  });
}`

// AXIsProcessTrusted never prompts; an untrusted app gets no text. Secure
// text fields are skipped. The walk stops at the character, node and time limits.
const TEXT_SCRIPT = `
ObjC.import('ApplicationServices');
ObjC.bindFunction('AXUIElementCreateApplication', ['id', ['int']]);
ObjC.bindFunction('AXUIElementCopyAttributeValue', ['int', ['id', 'id', 'id*']]);
ObjC.bindFunction('AXUIElementSetMessagingTimeout', ['int', ['id', 'float']]);
function run(argv) {
  if (!$.AXIsProcessTrusted()) return '';
  const pid = Number(argv[0]), max = Number(argv[1]), deadline = Date.now() + Number(argv[2]);
  const app = $.AXUIElementCreateApplication(pid);
  $.AXUIElementSetMessagingTimeout(app, 0.25);
  const value = (el, name) => {
    const ref = Ref();
    if ($.AXUIElementCopyAttributeValue(el, $(name), ref) !== 0) return undefined;
    return ref[0];
  };
  const window = value(app, 'AXFocusedWindow') || value(app, 'AXMainWindow');
  if (window === undefined) return '';
  const lines = [];
  let size = 0, nodes = 0;
  const visit = (el, depth) => {
    if (size >= max || depth > 40 || ++nodes > 4000 || Date.now() > deadline) return;
    const role = value(el, 'AXRole');
    if (role !== undefined && ObjC.unwrap(role) === 'AXSecureTextField') return;
    for (const name of ['AXValue', 'AXTitle', 'AXDescription']) {
      const raw = value(el, name);
      const text = raw === undefined ? undefined : ObjC.unwrap(raw);
      if (typeof text !== 'string' || text.trim() === '') continue;
      if (lines[lines.length - 1] !== text.trim()) { lines.push(text.trim()); size += text.length + 1; }
      break;
    }
    const children = value(el, 'AXChildren');
    if (children === undefined) return;
    const count = children.count;
    for (let i = 0; i < count; i++) visit(children.objectAtIndex(i), depth + 1);
  };
  visit(window, 0);
  return lines.join('\\n').slice(0, max);
}`

function run(file: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) reject(new Error(error.message, { cause: error }))
      else resolve(stdout)
    })
  })
}

function parseFrontWindow(output: string): FrontWindow | undefined {
  if (output.trim() === '') return undefined
  const parsed: unknown = JSON.parse(output)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('window lookup returned no object')
  const { id, processId, app, title } = parsed as Record<string, unknown>
  if (typeof id !== 'number' || typeof processId !== 'number' || typeof app !== 'string' || typeof title !== 'string') {
    throw new Error('window lookup returned an unexpected value')
  }
  return { id, processId, app, title }
}

/**
 * @param timeouts - child-process time limits.
 * @returns the macOS backend.
 */
export function macWindowCapturer(timeouts: MacCaptureTimeouts): WindowCapturer {
  return {
    frontWindow: async excludeProcessIds => parseFrontWindow(
      await run(OSASCRIPT, ['-l', 'JavaScript', '-e', LOOKUP_SCRIPT, excludeProcessIds.join(',')], timeouts.lookupMs)),
    screenshot: async (window) => {
      const directory = await mkdtemp(join(tmpdir(), 'ahel-window-capture-'))
      try {
        const path = join(directory, 'window.png')
        await run(SCREENCAPTURE, ['-l', String(window.id), '-o', '-x', '-t', 'png', path], timeouts.screenshotMs)
        return new Uint8Array(await readFile(path))
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    text: async (window, maxChars) => {
      if (window.processId <= 0) return undefined
      const output = await run(OSASCRIPT, ['-l', 'JavaScript', '-e', TEXT_SCRIPT, String(window.processId), String(maxChars),
        String(Math.max(0, timeouts.textMs - 500))], timeouts.textMs)
      return output.trim() === '' ? undefined : output.replace(/\n$/u, '')
    },
  }
}
