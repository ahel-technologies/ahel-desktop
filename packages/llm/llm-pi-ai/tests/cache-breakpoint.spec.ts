import { describe, expect, it } from 'vitest'
import { markBeforeFreshToolResults } from '../src/cache-breakpoint.ts'

const MARK = { type: 'ephemeral' }

/** A Chat Completions body as pi-ai builds it with Anthropic cache control. */
function completions(assistantContent: unknown) {
  return {
    model: 'anthropic/claude-sonnet-5.5',
    tools: [{ type: 'function', function: { name: 'use' }, cache_control: MARK }],
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'system', cache_control: MARK }] },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a' }] },
      { role: 'tool', tool_call_id: 'a', content: 'seen result' },
      { role: 'assistant', content: assistantContent, tool_calls: [{ id: 'b' }, { id: 'c' }] },
      { role: 'tool', tool_call_id: 'b', content: 'fresh b' },
      { role: 'tool', tool_call_id: 'c', content: [{ type: 'text', text: 'fresh c', cache_control: MARK }] },
    ],
  }
}

describe('cache breakpoint before fresh tool results', () => {
  it('marks the assistant text that issued the fresh calls', () => {
    const body = completions('Reading the board.')
    markBeforeFreshToolResults('openai-completions', body)
    expect(body.messages[4]!.content).toEqual([{ type: 'text', text: 'Reading the board.', cache_control: MARK }])
    expect(body.messages[5]!.content).toBe('fresh b')
  })

  it('walks back to the previous text when the assistant turn has only tool calls', () => {
    const body = completions(null)
    markBeforeFreshToolResults('openai-completions', body)
    expect(body.messages[3]!.content).toEqual([{ type: 'text', text: 'seen result', cache_control: MARK }])
  })

  it('adds nothing without Anthropic cache control, at four markers, or without trailing tool results', () => {
    const plain = completions('text')
    plain.tools[0]!.cache_control = undefined as never
    plain.messages[0]!.content = 'system'
    plain.messages[6]!.content = 'fresh c'
    markBeforeFreshToolResults('openai-completions', plain)
    expect(plain.messages[4]!.content).toBe('text')

    const full = completions(null)
    full.messages[1]!.content = [{ type: 'text', text: 'hello', cache_control: MARK }] as never
    markBeforeFreshToolResults('openai-completions', full)
    expect(full.messages[3]!.content).toBe('seen result')

    const answered = completions('text')
    answered.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'done', cache_control: MARK }], tool_calls: [] })
    markBeforeFreshToolResults('openai-completions', answered)
    expect(answered.messages[4]!.content).toBe('text')
    expect(markBeforeFreshToolResults('openai-completions', 'raw')).toBe('raw')
  })

  it('marks the last tool_use block of the Messages API assistant turn', () => {
    const body = {
      system: [{ type: 'text', text: 'system', cache_control: MARK }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 'a' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'fresh', cache_control: MARK }] },
      ],
    }
    markBeforeFreshToolResults('anthropic-messages', body)
    expect(body.messages[1]!.content[1]).toEqual({ type: 'tool_use', id: 'a', cache_control: MARK })
    expect(body.messages[1]!.content[0]).toEqual({ type: 'thinking', thinking: '' })
  })
})
