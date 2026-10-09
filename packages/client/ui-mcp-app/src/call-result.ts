/** Projection of a registry tool outcome onto MCP `CallToolResult` fields for a card. */

import type { ToolExecutionResult } from '@ahel/dsh-tools'
import type { JsonValue } from '@ahel/dsh-util-values'
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
export function callResultOf(result: ToolExecutionResult, resultMeta: McpAppJsonObject | undefined): McpAppCallResult {
  if (result.isError) return { content: [{ type: 'text', text: result.error.message }], isError: true }
  const value = result.value
  return {
    content: isObject(value) && Array.isArray(value.content) ? value.content : [],
    ...isObject(value) && value.structuredContent !== undefined ? { structuredContent: value.structuredContent } : {},
    ...resultMeta === undefined ? {} : { _meta: resultMeta },
  }
}

/** Longest card-reported text added to model context. */
const MAX_CARD_TEXT = 4000

/** Text blocks of MCP content, joined. */
function textOf(content: JsonValue | undefined): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function bounded(text: string): string {
  return text.length <= MAX_CARD_TEXT ? text : `${text.slice(0, MAX_CARD_TEXT)}…`
}

/**
 * Model-facing account of one card-initiated tool call. A card calls tools on
 * a press and on its own (for example to read its current state when it is
 * drawn), and the Host cannot tell which, so the text claims no press.
 * @param server - the card's MCP server.
 * @param tool - raw MCP tool name.
 * @param outcome - the call's MCP result fields.
 * @returns the context text.
 */
export function cardActionText(server: string, tool: string, outcome: McpAppCallResult): string {
  const status = outcome.isError === true ? 'failed' : 'succeeded'
  return bounded(`[${server} card] The card called ${tool}; the call ${status}. Result:\n${textOf(outcome.content)}`)
}

/**
 * Model-facing account of one `ui/update-model-context` payload.
 * @param server - the card's MCP server.
 * @param update - `content` blocks and optional `structuredContent`.
 * @returns the context text.
 */
export function cardContextText(server: string, update: McpAppJsonObject): string {
  const structured = update.structuredContent === undefined ? '' : `\n${JSON.stringify(update.structuredContent)}`
  return bounded(`[${server} card] Current card state:\n${textOf(update.content)}${structured}`)
}
