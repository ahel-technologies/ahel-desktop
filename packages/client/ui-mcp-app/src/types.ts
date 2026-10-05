/** Browser-safe wire types shared by the MCP Apps Host controller and the card Client. */

import type { JsonValue } from '@ahel/dsh-util-values'

/** JSON object with string keys. */
export type McpAppJsonObject = { [key: string]: JsonValue }

/**
 * One host-proxied `tools/call` outcome in MCP `CallToolResult` fields. A
 * policy denial, an unknown tool, or a server error result arrives as
 * `isError: true` with a text content block.
 */
export type McpAppCallResult = {
  /** MCP content blocks. */
  content: JsonValue[]
  /** Structured result, when the tool returned one. */
  structuredContent?: JsonValue
  /** Result-level `_meta`, when the tool returned one. */
  _meta?: McpAppJsonObject
  /** Whether the call failed. */
  isError?: boolean
}
