/** Projection of a registry tool outcome onto MCP `CallToolResult` fields for a card. */

import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpAppCallResult, McpAppJsonObject } from './types.ts'

/** Narrow one JSON value to a string-keyed object. */
function isObject(value: JsonValue | undefined): value is McpAppJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Project one registry outcome onto MCP `CallToolResult` fields.
 * @param result - the materialized registry result of an MCP-backed tool.
 * @returns content, structured result, result `_meta`, and failure flag.
 */
export function callResultOf(result: ToolExecutionResult): McpAppCallResult {
  if (result.isError) return { content: [{ type: 'text', text: result.error.message }], isError: true }
  const value = result.value
  const record = isObject(result.meta) && isObject(result.meta.mcpApp) ? result.meta.mcpApp : undefined
  const resultMeta = record?.resultMeta
  return {
    content: isObject(value) && Array.isArray(value.content) ? value.content : [],
    ...isObject(value) && value.structuredContent !== undefined ? { structuredContent: value.structuredContent } : {},
    ...isObject(resultMeta) ? { _meta: resultMeta } : {},
  }
}
