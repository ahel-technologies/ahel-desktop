/**
 * Model text for driver results. The MCP bridge renders only a result's
 * `content` blocks, but the driver puts element tokens, window ids, pids and
 * permission booleans in `structuredContent` (for list_windows the text is just
 * "Found 10 window(s)."). This projection appends that object as JSON so the
 * model can act on it (deepseek-harness issue #7788).
 */

import type { ContentBlock } from '@ahel/dsh-llm'
import type { JsonValue } from '@ahel/dsh-util-values'

/** Header that introduces the appended JSON in the model text. */
export const STRUCTURED_HEADER = 'structuredContent (JSON):'

/** Fields left out of the JSON copy because the text content already carries them. */
const DUPLICATED_IN_TEXT = new Set(['tree_markdown'])

/**
 * Drop fields the text already shows and base64 payloads the model cannot read as text.
 * @param value - the driver's structured result.
 * @param text - the text the model already receives.
 * @returns the reduced object.
 */
function reduce(value: Record<string, JsonValue>, text: string): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {}
  for (const [key, field] of Object.entries(value)) {
    if (DUPLICATED_IN_TEXT.has(key) && typeof field === 'string' && text.includes(field.slice(0, 200))) continue
    if (typeof field === 'string' && field.length > 1024 && /^[A-Za-z0-9+/]+={0,2}$/u.test(field)) {
      out[key] = `[${String(field.length)} base64 characters omitted]`
      continue
    }
    out[key] = field
  }
  return out
}

/**
 * Append a result's structuredContent to its model content.
 * @param value - the canonical MCP value `{ content, structuredContent? }`.
 * @param content - the content the model would see.
 * @param maxChars - longest JSON text to append; longer JSON is cut with a note.
 * @returns the new content, or undefined when there is nothing to add.
 */
export function withStructuredContent(value: JsonValue, content: readonly ContentBlock[], maxChars: number): ContentBlock[] | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const structured = value.structuredContent
  if (typeof structured !== 'object' || structured === null || Array.isArray(structured)) return undefined
  const text = content.map(block => block.type === 'text' ? block.text : '').join('\n')
  const reduced = reduce(structured, text)
  if (Object.keys(reduced).length === 0) return undefined
  let json = JSON.stringify(reduced)
  if (json.length > maxChars) {
    json = `${json.slice(0, maxChars)}… [cut at ${String(maxChars)} of ${String(json.length)} characters; narrow the call, for example get_window_state with query]`
  }
  return [...content, { type: 'text', text: `${STRUCTURED_HEADER}\n${json}` }]
}
