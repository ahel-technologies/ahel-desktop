import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage } from '@ahel/dsh-llm'
import type { RequestMessage } from '@ahel/dsh-llm'
import { claudeArgs, parseClaudeLine } from '../src/claude.ts'
import { renderTranscript } from '../src/transcript.ts'

const text = (value: string) => [{ type: 'text' as const, text: value }]
const model = { source: { provider: 'p', model: 'm' } }
const messages: RequestMessage[] = [
  createSystemMessage('Be terse.'),
  { role: 'user', content: text('Find my apps') },
  createAssistantMessage({ ...model, content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'search', arguments: '{"q":"apps"}' }] }),
  createToolResultMessage({ callId: ToolCallId('c1'), content: text('2 apps'), isError: false }),
  createAssistantMessage({ ...model, content: text('You have 2 apps.') }),
  { role: 'user', content: text('Which ones?') },
]

describe('transcript', () => {
  it('renders the whole history for a fresh CLI session and only the last user turn on resume', () => {
    expect(renderTranscript({ messages }, false)).toEqual({
      system: 'Be terse.',
      prompt: 'User:\nFind my apps\n\nAssistant:\n[tool call search]: {"q":"apps"}\n\n[tool result search]: 2 apps\n\nAssistant:\nYou have 2 apps.\n\nUser:\nWhich ones?',
    })
    expect(renderTranscript({ messages }, true)).toEqual({ system: 'Be terse.', prompt: 'Which ones?' })
    expect(renderTranscript({ messages: messages.slice(0, 2), system: 'Other' }, false)).toEqual({ system: 'Other', prompt: 'Find my apps' })
  })
})

describe('claude stream-json', () => {
  it('passes --model and --resume only when set, and Ahel tools only with an MCP config', () => {
    const base = claudeArgs({ systemPromptFile: '/t/s.txt', model: 'default' })
    expect(base).not.toContain('--model')
    expect(base).not.toContain('--bare')
    expect(base).not.toContain('--mcp-config')
    expect(claudeArgs({ systemPromptFile: '/t/s.txt', model: 'opus', resumeId: 'r1', mcpConfigFile: '/t/m.json' }).slice(-8))
      .toEqual(['--model', 'opus', '--resume', 'r1', '--mcp-config', '/t/m.json', '--allowedTools', 'mcp__ahel__*'])
  })

  it('reads the session id, text deltas, tool activity, usage and failures', () => {
    expect(parseClaudeLine({ type: 'system', subtype: 'init', session_id: 's1' })).toEqual([{ kind: 'session', id: 's1' }])
    expect(parseClaudeLine({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } }))
      .toEqual([{ kind: 'text', text: 'Hi' }])
    expect(parseClaudeLine({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__ahel__search' }] } }))
      .toEqual([{ kind: 'boundary' }, { kind: 'reasoning', text: 'Using ahel: search\n' }])
    expect(parseClaudeLine({ type: 'result', is_error: true, result: 'Not logged in', usage: { input_tokens: 3, output_tokens: 1 } })).toEqual([
      { kind: 'usage', usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { kind: 'result', error: 'Not logged in' },
    ])
  })
})
