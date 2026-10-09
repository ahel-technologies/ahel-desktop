/**
 * An Anthropic prompt-cache breakpoint ahead of a request's fresh tool results.
 *
 * pi-ai marks the system prompt, the last tool and the last message. A later
 * request that rewrites one of those trailing tool results (earlier-result
 * trimming) can then reuse none of the conversation, because Anthropic reads a
 * cache entry only where an earlier request wrote a breakpoint. This marker
 * writes one more entry that ends before the fresh results, so the next
 * request reads everything up to that point.
 *
 * @module dsh-llm-pi-ai/cache-breakpoint
 */

/** Anthropic's per-request limit on `cache_control` markers. */
const MAX_BREAKPOINTS = 4

type JsonObject = { [key: string]: unknown }

/**
 * Add one `cache_control` marker to the last text-bearing block that precedes
 * the trailing tool results, copying the marker pi-ai placed on the request.
 * The payload is returned unchanged when it has no marker (caching off or not
 * Anthropic-format), already has four, or does not end in tool results.
 * @param api - the pi-ai API that built the payload.
 * @param payload - the request body pi-ai built; mutated in place.
 * @returns the same payload.
 */
export function markBeforeFreshToolResults(api: string, payload: unknown): unknown {
  if (!isObject(payload) || !Array.isArray(payload['messages'])) return payload
  const messages = payload['messages'] as unknown[]
  const markers = collectMarkers(payload)
  const marker = markers[0]
  if (marker === undefined || markers.length >= MAX_BREAKPOINTS) return payload
  if (api === 'openai-completions') markOpenAiCompletions(messages, marker)
  else if (api === 'anthropic-messages') markAnthropicMessages(messages, marker)
  return payload
}

/** Chat Completions: tool results are trailing `tool` messages after the last assistant message. */
function markOpenAiCompletions(messages: unknown[], marker: unknown): void {
  const last = messages.length - 1
  if (!isObject(messages[last]) || messages[last]['role'] !== 'tool') return
  let index = last
  while (index >= 0 && isObject(messages[index]) && (messages[index] as JsonObject)['role'] === 'tool') index--
  for (; index >= 0; index--) {
    const message = messages[index]
    if (isObject(message) && message['role'] !== 'system' && message['role'] !== 'developer' && markText(message, marker)) return
  }
}

/** Messages API: tool results are the last user message; mark the assistant turn before it. */
function markAnthropicMessages(messages: unknown[], marker: unknown): void {
  const last = messages.at(-1)
  if (!isObject(last) || last['role'] !== 'user' || !Array.isArray(last['content'])) return
  if (!(last['content'] as unknown[]).some(block => isObject(block) && block['type'] === 'tool_result')) return
  const assistant = messages.at(-2)
  if (!isObject(assistant) || assistant['role'] !== 'assistant' || !Array.isArray(assistant['content'])) return
  const blocks = assistant['content'] as unknown[]
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index]
    if (isObject(block) && (block['type'] === 'text' || block['type'] === 'tool_use')) {
      block['cache_control'] = marker
      return
    }
  }
}

/** Mark a Chat Completions message's last text part, converting string content to one part. */
function markText(message: JsonObject, marker: unknown): boolean {
  const content = message['content']
  if (typeof content === 'string') {
    if (content.length === 0) return false
    message['content'] = [{ type: 'text', text: content, cache_control: marker }]
    return true
  }
  if (!Array.isArray(content)) return false
  for (let index = content.length - 1; index >= 0; index--) {
    const part: unknown = content[index]
    if (isObject(part) && part['type'] === 'text') {
      part['cache_control'] = marker
      return true
    }
  }
  return false
}

/** Every `cache_control` value on the payload's tools, system blocks and message parts. */
function collectMarkers(payload: JsonObject): unknown[] {
  const markers: unknown[] = []
  const visit = (value: unknown): void => {
    if (!isObject(value)) return
    if (value['cache_control'] !== undefined) markers.push(value['cache_control'])
  }
  for (const list of [payload['tools'], payload['system'], payload['messages']]) {
    if (!Array.isArray(list)) continue
    for (const item of list as unknown[]) {
      visit(item)
      if (isObject(item) && Array.isArray(item['content'])) for (const part of item['content'] as unknown[]) visit(part)
    }
  }
  return markers
}

/** Narrow a value to a mutable string-keyed object. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
