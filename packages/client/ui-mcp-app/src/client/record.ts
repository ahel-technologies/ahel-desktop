/** Client-side validation of the persisted `mcpApp` card record and MCP Apps resource reads. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpAppJsonObject } from '../types.ts'

/** MIME type of an MCP Apps HTML resource. */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'

/** Who may see or call a tool. */
export type McpAppVisibility = 'model' | 'app'

/** One validated version-1 card record from `tool/result` metadata. */
export interface McpAppRecord {
  /** Configured MCP server name. */
  readonly server: string
  /** Raw MCP tool name. */
  readonly tool: string
  /** `ui://` resource rendered by the card. */
  readonly resourceUri: string
  /** Tool visibility. */
  readonly visibility: readonly McpAppVisibility[]
  /** Structured result, when persisted. */
  readonly structuredContent?: JsonValue
  /** Result `_meta`, when persisted. */
  readonly resultMeta?: McpAppJsonObject
  /** Whether the structured fields were dropped for size. */
  readonly truncated: boolean
}

/** `_meta.ui.csp` of an MCP Apps resource. */
export interface McpAppCsp {
  readonly connectDomains?: readonly string[]
  readonly resourceDomains?: readonly string[]
  readonly frameDomains?: readonly string[]
  readonly baseUriDomains?: readonly string[]
}

/** One loaded MCP Apps HTML resource. */
export interface McpAppResource {
  /** Complete HTML document text. */
  readonly html: string
  /** Declared content security domains. */
  readonly csp?: McpAppCsp
  /** Border preference: `true` border and background, `false` none, absent host default. */
  readonly prefersBorder?: boolean
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is McpAppJsonObject {
  return isObject(value)
}

/**
 * Read a version-1 card record from a settled call's metadata.
 * @param meta - persisted `tool/result` metadata (untrusted wire value).
 * @returns the record, or `null` when absent, of another version, or malformed.
 */
export function readAppRecord(meta: unknown): McpAppRecord | null {
  if (!isObject(meta) || !isObject(meta.mcpApp)) return null
  const record = meta.mcpApp
  if (record.v !== 1) return null
  const { server, tool, resourceUri, visibility } = record
  if (typeof server !== 'string' || typeof tool !== 'string' || typeof resourceUri !== 'string') return null
  if (!resourceUri.startsWith('ui://')) return null
  if (!Array.isArray(visibility)) return null
  const audiences = visibility.filter((entry): entry is McpAppVisibility => entry === 'model' || entry === 'app')
  return {
    server,
    tool,
    resourceUri,
    visibility: audiences,
    ...record.structuredContent === undefined ? {} : { structuredContent: record.structuredContent as JsonValue },
    ...isJsonObject(record.resultMeta) ? { resultMeta: record.resultMeta } : {},
    truncated: record.truncated === true,
  }
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined
}

function cspOf(meta: unknown): McpAppCsp | undefined {
  if (!isObject(meta) || !isObject(meta.ui) || !isObject(meta.ui.csp)) return undefined
  const csp = meta.ui.csp
  const result: { -readonly [K in keyof McpAppCsp]: McpAppCsp[K] } = {}
  for (const key of ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'] as const) {
    const list = stringList(csp[key])
    if (list !== undefined) result[key] = list
  }
  return result
}

function decodeBase64Utf8(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Select and decode the HTML document of an MCP Apps `resources/read` result.
 * The content item for `uri` wins; otherwise the first item. Text and base64
 * blob contents are accepted; the MIME type must be `text/html`, with or
 * without the MCP Apps profile.
 * @param result - the `resources/read` result (untrusted wire value).
 * @param uri - the requested resource URI.
 * @returns the document and its declared CSP and border preference.
 * @throws Error when no HTML content item is present.
 */
export function readAppResource(result: unknown, uri: string): McpAppResource {
  const contents = isObject(result) && Array.isArray(result.contents) ? result.contents.filter(isObject) : []
  const item = contents.find(entry => entry.uri === uri) ?? contents[0]
  if (item === undefined) throw new Error('the resource returned no content')
  const mimeType = typeof item.mimeType === 'string' ? item.mimeType.toLowerCase().replaceAll(' ', '') : ''
  if (mimeType !== MCP_APP_MIME_TYPE && mimeType !== 'text/html') {
    throw new Error(`the resource is ${mimeType === '' ? 'untyped' : mimeType}, not ${MCP_APP_MIME_TYPE}`)
  }
  let html: string
  if (typeof item.text === 'string') html = item.text
  else if (typeof item.blob === 'string') html = decodeBase64Utf8(item.blob)
  else throw new Error('the resource has neither text nor blob content')
  const csp = cspOf(item._meta)
  const ui = isObject(item._meta) && isObject(item._meta.ui) ? item._meta.ui : undefined
  return {
    html,
    ...csp === undefined ? {} : { csp },
    ...typeof ui?.prefersBorder === 'boolean' ? { prefersBorder: ui.prefersBorder } : {},
  }
}
