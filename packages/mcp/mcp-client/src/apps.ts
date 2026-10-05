/**
 * MCP Apps (`io.modelcontextprotocol/ui`) metadata carried from `tools/list`
 * and `tools/call` into the harness tool registry and the persisted
 * `tool/result` presentation metadata.
 *
 * The persisted projection is the wire record a Client card reads; the Client
 * validates it independently and falls back to the generic tool row when it is
 * absent or malformed.
 *
 * @module
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Extension identifier advertised in the client `initialize` capabilities. */
export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui'

/** MIME type of an MCP Apps HTML resource (MCP Apps specification). */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** Who may see or call a tool, per `_meta.ui.visibility` (default both). */
export type McpToolVisibility = 'model' | 'app'

/** MCP Apps facts of one discovered tool. */
export interface McpToolUi {
  /** `ui://` resource rendered for this tool's results, when declared. */
  readonly resourceUri?: string
  /** Audiences admitted to this tool. */
  readonly visibility: readonly McpToolVisibility[]
}

/** Server identity and protocol metadata attached to an MCP-backed tool registration. */
export interface McpToolDescriptor {
  /** Configured `serverName` of the owning mcp-client instance. */
  readonly server: string
  /** The server's own tool name, sent on the wire. */
  readonly rawName: string
  /** The tool's `_meta` object from `tools/list`, when present. */
  readonly meta?: { readonly [key: string]: JsonValue }
  /** MCP Apps facts derived from {@link McpToolDescriptor.meta}. */
  readonly ui: McpToolUi
}

declare module '@deepseek-ai/dsh-tools' {
  interface ToolDefinition {
    /**
     * Present on tools bridged by `@deepseek-ai/dsh-mcp-client`: the owning
     * server and its `tools/list` metadata. Never model-visible.
     */
    readonly mcp?: McpToolDescriptor
  }
}

/**
 * Version-1 `tool/result` presentation metadata for a tool that declares an
 * MCP Apps resource. Stored under the `mcpApp` key of `result.meta`.
 */
export type McpAppResultMeta = {
  /** Record version; a Client ignores versions it does not know. */
  v: 1
  /** Configured server name that owns the tool and the resource. */
  server: string
  /** Raw MCP tool name. */
  tool: string
  /** `ui://` resource to render. */
  resourceUri: string
  /** Tool visibility, so the Client can scope host-proxied calls. */
  visibility: McpToolVisibility[]
  /** `structuredContent` of the call result; omitted when absent or over budget. */
  structuredContent?: JsonValue
  /** True when the structured fields were dropped because they exceeded the persisted budget. */
  truncated?: true
}

/**
 * Upper bound, in UTF-16 code units of JSON, for the structured fields kept in
 * one persisted card record. Larger results render through the text fallback.
 */
export const MAX_PERSISTED_APP_RESULT_CHARS = 262_144

/** Narrow one JSON value to a string-keyed object. */
function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the MCP Apps facts of one tool from its `tools/list` `_meta`.
 * Accepts the nested `ui.resourceUri` key and the deprecated flat
 * `ui/resourceUri` key; any value that is not a `ui://` string is ignored.
 * @param meta - the tool's `_meta`, if any.
 * @returns the resource URI (when valid) and the visibility list.
 */
export function readToolUi(meta: unknown): McpToolUi {
  const ui = isObject(meta) && isObject(meta.ui) ? meta.ui : undefined
  const nested = ui?.resourceUri
  const flat = isObject(meta) ? meta['ui/resourceUri'] : undefined
  const candidate = typeof nested === 'string' ? nested : flat
  const resourceUri = typeof candidate === 'string' && candidate.startsWith('ui://') ? candidate : undefined
  const declared = ui?.visibility
  const visibility: McpToolVisibility[] = Array.isArray(declared)
    ? declared.filter((entry): entry is McpToolVisibility => entry === 'model' || entry === 'app')
    : ['model', 'app']
  return resourceUri === undefined ? { visibility } : { resourceUri, visibility }
}

/**
 * Build the persisted card record for one successful call. Result `_meta`
 * is never part of it; see {@link rememberResultMeta}.
 * @param descriptor - the tool's server identity and MCP Apps facts.
 * @param structuredContent - the call's `structuredContent`, if any.
 * @returns the record, or `undefined` when the tool declares no resource.
 */
export function appResultMeta(
  descriptor: McpToolDescriptor,
  structuredContent: JsonValue | undefined,
): { mcpApp: McpAppResultMeta } | undefined {
  const { resourceUri, visibility } = descriptor.ui
  if (resourceUri === undefined) return undefined
  const base = { v: 1 as const, server: descriptor.server, tool: descriptor.rawName, resourceUri, visibility: [...visibility] }
  if (structuredContent === undefined) return { mcpApp: base }
  if (JSON.stringify(structuredContent).length > MAX_PERSISTED_APP_RESULT_CHARS) {
    return { mcpApp: { ...base, truncated: true } }
  }
  return { mcpApp: { ...base, structuredContent } }
}

/** Live result `_meta` entries kept per owner (Agent, or the root Context without one). */
const LIVE_RESULT_META_LIMIT = 256

const liveResultMetas = new WeakMap<object, Map<string, { [key: string]: JsonValue }>>()

/**
 * Keep one call's result `_meta` in Host memory for its live card. Result
 * `_meta` can carry one-use secrets (for example a press token), so it is
 * never written to the Session log, exports, or telemetry; after a Host
 * restart the card renders without it. The oldest entries beyond 256 per
 * owner are dropped.
 * @param owner - the calling Agent, or the root Context for agentless calls.
 * @param callId - the tool call id.
 * @param meta - the result `_meta` object.
 */
export function rememberResultMeta(owner: object, callId: string, meta: { [key: string]: JsonValue }): void {
  const entries = liveResultMetas.get(owner) ?? new Map<string, { [key: string]: JsonValue }>()
  liveResultMetas.set(owner, entries)
  entries.delete(callId)
  entries.set(callId, meta)
  if (entries.size > LIVE_RESULT_META_LIMIT) {
    const oldest = entries.keys().next()
    if (oldest.done !== true) entries.delete(oldest.value)
  }
}

/**
 * Read one call's live result `_meta`.
 * @param owner - the Agent (or root Context) the call ran for.
 * @param callId - the tool call id.
 * @returns the `_meta` object, or `undefined` when unknown or evicted.
 */
export function liveResultMeta(owner: object, callId: string): { [key: string]: JsonValue } | undefined {
  return liveResultMetas.get(owner)?.get(callId)
}

/**
 * Keep a result `_meta` value only when it is a JSON object.
 * @param value - the `_meta` field of a validated `CallToolResult`.
 * @returns the object, or undefined.
 */
export function resultMetaObject(value: unknown): { [key: string]: JsonValue } | undefined {
  return isObject(value) ? value : undefined
}
