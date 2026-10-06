/**
 * The latest Cua observations of one Agent: apps, windows, element tokens and
 * window screenshots, read from successful read results. Writes are resolved
 * against them to name their target and to crop the card image.
 */

import type { ElementFacts } from './blocklist.ts'
import type { ComputerUseCrop } from './types.ts'

/** A JSON object from a tool value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

/** Screenshot-pixel rectangle. */
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

interface ObservedElement extends ElementFacts {
  readonly windowId: number
  readonly frame: Rect | null
}

interface Screenshot {
  readonly mimeType: string
  readonly data: string
  readonly width: number | null
  readonly height: number | null
}

interface ObservedWindow {
  readonly pid: number
  readonly windowId: number
  readonly app: string | null
  readonly title: string | null
  readonly screenshot: Screenshot | null
  readonly focusedSecure: boolean
  readonly elements: readonly ObservedElement[]
  readonly tokens: readonly string[]
}

interface AppFacts { readonly name: string | null; readonly bundleId: string | null }

/** What one write is aimed at. */
export interface ResolvedTarget {
  readonly pid: number | null
  readonly windowId: number | null
  readonly app: string | null
  readonly bundleId: string | null
  readonly window: string | null
  readonly element: (ElementFacts & { readonly frame: Rect | null }) | null
  readonly focusedSecure: boolean
  readonly point: { readonly x: number; readonly y: number } | null
  readonly crop: ComputerUseCrop | null
  readonly urls: readonly string[]
}

/** Margin around an element in its crop, in screenshot pixels. */
const CROP_MARGIN = 24
/** Crop size around a pixel point. */
const POINT_CROP = { w: 280, h: 180 }

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: Json | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rect(value: Json | undefined): Rect | null {
  if (!isObject(value)) return null
  const x = num(value['x'])
  const y = num(value['y'])
  const w = num(value['w'] ?? value['width'])
  const h = num(value['h'] ?? value['height'])
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h }
}

/**
 * Read arguments as a JSON object.
 * @param args - parsed tool arguments.
 * @returns the object, or an empty one.
 */
export function argsOf(args: unknown): JsonObject {
  return typeof args === 'object' && args !== null && !Array.isArray(args) ? args as JsonObject : {}
}

/**
 * Split an MCP tool value into its structured content and first image.
 * @param value - canonical `{ content, structuredContent }` value.
 * @returns the structured object and the first image block.
 */
function parts(value: Json): { structured: JsonObject; image: Screenshot | null } {
  if (!isObject(value)) return { structured: {}, image: null }
  const structured = isObject(value['structuredContent']) ? value['structuredContent'] : {}
  const content = Array.isArray(value['content']) ? value['content'] : []
  const block = content.find(item => isObject(item) && item['type'] === 'image')
  const data = isObject(block) ? str(block['data']) : null
  const mimeType = isObject(block) ? str(block['mimeType']) : null
  const width = num(structured['screenshot_width']) ?? num(structured['image_width'])
  const height = num(structured['screenshot_height']) ?? num(structured['image_height'])
  return { structured, image: data === null || mimeType === null ? null : { mimeType, data, width, height } }
}

function clampCrop(screenshot: Screenshot, box: Rect): ComputerUseCrop {
  const x = Math.max(0, Math.round(box.x))
  const y = Math.max(0, Math.round(box.y))
  const right = screenshot.width === null ? box.x + box.w : Math.min(screenshot.width, box.x + box.w)
  const bottom = screenshot.height === null ? box.y + box.h : Math.min(screenshot.height, box.y + box.h)
  return {
    mimeType: screenshot.mimeType,
    data: screenshot.data,
    imageWidth: screenshot.width,
    imageHeight: screenshot.height,
    x,
    y,
    width: Math.max(1, Math.round(right - x)),
    height: Math.max(1, Math.round(bottom - y)),
  }
}

/** Latest observations of one Agent. */
export class Observations {
  private readonly apps = new Map<number, AppFacts>()
  private readonly windows = new Map<number, ObservedWindow>()
  private readonly tokens = new Map<string, ObservedElement>()

  /**
   * Record what a successful read or launch returned.
   * @param rawName - raw Cua tool name.
   * @param args - the call's arguments.
   * @param value - the canonical MCP value.
   */
  ingest(rawName: string, args: unknown, value: Json): void {
    const { structured, image } = parts(value)
    switch (rawName) {
      case 'list_apps': {
        const apps = Array.isArray(structured['apps']) ? structured['apps'] : []
        for (const app of apps) {
          if (!isObject(app)) continue
          const pid = num(app['pid'])
          if (pid !== null) this.apps.set(pid, { name: str(app['name']), bundleId: str(app['bundle_id']) })
        }
        return
      }
      case 'list_windows': {
        const windows = Array.isArray(structured['windows']) ? structured['windows'] : []
        for (const item of windows) {
          if (!isObject(item)) continue
          const windowId = num(item['window_id'])
          const pid = num(item['pid'])
          if (windowId === null || pid === null) continue
          const previous = this.windows.get(windowId)
          this.windows.set(windowId, {
            pid,
            windowId,
            app: str(item['app_name']) ?? previous?.app ?? null,
            title: str(item['title']) ?? previous?.title ?? null,
            screenshot: previous?.screenshot ?? null,
            focusedSecure: previous?.focusedSecure ?? false,
            elements: previous?.elements ?? [],
            tokens: previous?.tokens ?? [],
          })
        }
        return
      }
      case 'launch_app': {
        const pid = num(structured['pid'])
        const a = argsOf(args)
        if (pid !== null) {
          this.apps.set(pid, { name: str(structured['name']) ?? str(a['name']), bundleId: str(structured['bundle_id']) ?? str(a['bundle_id']) })
        }
        return
      }
      case 'get_window_state':
        this.window(structured, image)
        return
      default:
    }
  }

  private window(structured: JsonObject, image: Screenshot | null): void {
    const pid = num(structured['pid'])
    const windowId = num(structured['window_id'])
    if (pid === null || windowId === null) return
    const previous = this.windows.get(windowId)
    // A new snapshot invalidates the window's earlier element tokens.
    for (const token of previous?.tokens ?? []) this.tokens.delete(token)
    const elements: ObservedElement[] = []
    const tokens: string[] = []
    const list = Array.isArray(structured['elements']) ? structured['elements'] : []
    for (const item of list) {
      if (!isObject(item)) continue
      const role = str(item['role'])
      if (role === null) continue
      const element: ObservedElement = {
        role,
        subrole: str(item['subrole']),
        label: str(item['label']),
        windowId,
        frame: rect(item['screenshot_frame']),
      }
      elements.push(element)
      const token = str(item['element_token'])
      if (token !== null) {
        tokens.push(token)
        this.tokens.set(token, element)
      }
    }
    const focused = str(structured['focused_element'])
    this.windows.set(windowId, {
      pid,
      windowId,
      app: str(structured['app_name']) ?? previous?.app ?? this.apps.get(pid)?.name ?? null,
      title: str(structured['window_title']) ?? previous?.title ?? null,
      screenshot: image ?? previous?.screenshot ?? null,
      focusedSecure: focused !== null && /securetextfield/i.test(focused),
      elements,
      tokens,
    })
  }

  /**
   * Resolve the target of one write from its arguments.
   * @param rawName - raw Cua tool name.
   * @param args - the call's arguments.
   * @returns what the latest observations say about the target.
   */
  resolve(rawName: string, args: unknown): ResolvedTarget {
    const a = argsOf(args)
    const target = isObject(a['target']) ? a['target'] : {}
    const token = str(a['element_token'])
    const tokenElement = token === null ? undefined : this.tokens.get(token)
    const windowId = num(a['window_id']) ?? num(target['window_id']) ?? tokenElement?.windowId ?? null
    let window = windowId === null ? undefined : this.windows.get(windowId)
    const pid = num(a['pid']) ?? num(target['pid']) ?? window?.pid ?? null
    if (window === undefined && pid !== null) window = this.latestWindowOf(pid)
    const launchName = rawName === 'launch_app' ? str(a['name']) : null
    const launchBundle = rawName === 'launch_app' ? str(a['bundle_id']) : null
    const facts = pid === null ? undefined : this.apps.get(pid)
    const app = launchName ?? window?.app ?? facts?.name ?? (launchBundle === null ? null : this.appByBundle(launchBundle)?.name ?? null)
    const bundleId = launchBundle ?? facts?.bundleId ?? (app === null ? null : this.appByName(app)?.bundleId ?? null)
    const x = num(a['x']) ?? num(a['from_x'])
    const y = num(a['y']) ?? num(a['from_y'])
    const point = x !== null && y !== null ? { x, y } : null
    const element = tokenElement ?? (point !== null && window !== undefined ? hit(window.elements, point) : undefined)
    let crop: ComputerUseCrop | null = null
    if (window?.screenshot != null) {
      if (element?.frame != null) {
        const f = element.frame
        const m = CROP_MARGIN
        crop = clampCrop(window.screenshot, { x: f.x - m, y: f.y - m, w: f.w + 2 * m, h: f.h + 2 * m })
      } else if (point !== null) {
        const { w, h } = POINT_CROP
        crop = clampCrop(window.screenshot, { x: point.x - w / 2, y: point.y - h / 2, w, h })
      }
    }
    const urls = Array.isArray(a['urls']) ? a['urls'].flatMap(url => typeof url === 'string' ? [url] : []) : []
    const pageUrl = str(a['url'])
    return {
      pid,
      windowId: window?.windowId ?? windowId,
      app,
      bundleId,
      window: window?.title ?? null,
      element: element === undefined
        ? null
        : { role: element.role, subrole: element.subrole ?? null, label: element.label, frame: element.frame },
      focusedSecure: window?.focusedSecure ?? false,
      point,
      crop,
      urls: pageUrl === null ? urls : [...urls, pageUrl],
    }
  }

  private latestWindowOf(pid: number): ObservedWindow | undefined {
    let found: ObservedWindow | undefined
    for (const window of this.windows.values()) if (window.pid === pid) found = window
    return found
  }

  private appByBundle(bundleId: string): AppFacts | undefined {
    for (const app of this.apps.values()) if (app.bundleId?.toLowerCase() === bundleId.toLowerCase()) return app
    return undefined
  }

  private appByName(name: string): AppFacts | undefined {
    for (const app of this.apps.values()) if (app.name?.toLowerCase() === name.toLowerCase()) return app
    return undefined
  }
}

/** The smallest observed element whose frame contains a point. */
function hit(elements: readonly ObservedElement[], point: { x: number; y: number }): ObservedElement | undefined {
  let best: ObservedElement | undefined
  for (const element of elements) {
    const f = element.frame
    if (f === null || point.x < f.x || point.y < f.y || point.x > f.x + f.w || point.y > f.y + f.h) continue
    if (best?.frame == null || f.w * f.h < best.frame.w * best.frame.h) best = element
  }
  return best
}
