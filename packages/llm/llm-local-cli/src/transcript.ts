/**
 * Turns a harness request into what a headless CLI accepts: one system prompt
 * plus one user prompt. The CLI keeps its own conversation, so a resumed CLI
 * session receives only the newest user turn; a fresh one receives the whole
 * history rendered as plain text.
 */

import type { ContentBlock, GenerateOptions, RequestMessage } from '@ahel/dsh-llm'

/** The two strings one CLI run is started with. */
export interface RenderedPrompt {
  /** System prompt; empty when the request carries none. */
  readonly system: string
  /** The single user message written to the CLI's stdin. */
  readonly prompt: string
}

const blockText = (blocks: readonly ContentBlock[]): string => blocks
  .flatMap(block => block.type === 'text' ? [block.text] : [])
  .join('\n')
  .trim()

/**
 * The system prompt: `options.system` for one-shot callers, else the text of a
 * leading system message (how loop-built requests carry it).
 * @param options - the request.
 * @returns the prompt text, possibly empty.
 */
export function systemText(options: Pick<GenerateOptions, 'messages' | 'system'>): string {
  if (options.system !== undefined && options.system.length > 0) return options.system
  const first = options.messages[0]
  return first?.role === 'system' ? blockText(first.content) : ''
}

/**
 * Render a request as one CLI prompt.
 * With `resume`, only the last user message is sent, since the CLI session
 * already holds the earlier turns. Otherwise user and assistant turns become
 * `User:` / `Assistant:` blocks, tool results `[tool result <name>]: <text>`;
 * a history of one user message is sent as its plain text.
 * @param options - the request; images and files arrive already projected to text.
 * @param resume - whether the CLI resumes its own session for this conversation.
 * @returns the system prompt and the user prompt.
 */
export function renderTranscript(options: Pick<GenerateOptions, 'messages' | 'system'>, resume: boolean): RenderedPrompt {
  const system = systemText(options)
  const turns = options.messages.filter(message => message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
  if (resume) {
    const last = [...turns].reverse().find(message => message.role === 'user')
    return { system, prompt: last === undefined ? '' : blockText(last.content) }
  }
  const only = turns.length === 1 ? turns[0] : undefined
  if (only?.role === 'user') return { system, prompt: blockText(only.content) }

  const toolNames = new Map<string, string>()
  const parts: string[] = []
  for (const message of turns) {
    const rendered = renderTurn(message, toolNames)
    if (rendered !== undefined) parts.push(rendered)
  }
  return { system, prompt: parts.join('\n\n') }
}

function renderTurn(message: RequestMessage, toolNames: Map<string, string>): string | undefined {
  switch (message.role) {
    case 'user': {
      const text = blockText(message.content)
      return text.length === 0 ? undefined : `User:\n${text}`
    }
    case 'assistant': {
      const lines: string[] = []
      for (const block of message.content) {
        if (block.type === 'text' && block.text.trim().length > 0) lines.push(block.text.trim())
        if (block.type === 'tool-call') {
          toolNames.set(block.id, block.name)
          lines.push(`[tool call ${block.name}]: ${block.arguments}`)
        }
      }
      return lines.length === 0 ? undefined : `Assistant:\n${lines.join('\n')}`
    }
    case 'tool': {
      const name = toolNames.get(message.toolCallId) ?? 'tool'
      return `[tool result ${name}]: ${blockText(message.content)}`
    }
    default:
      return undefined
  }
}
