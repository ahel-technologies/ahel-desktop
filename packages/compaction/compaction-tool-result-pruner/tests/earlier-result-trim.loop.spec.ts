import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import LlmRuntime, { ToolCallId, createUserMessage } from '@ahel/dsh-llm'
import type { GenerateOptions } from '@ahel/dsh-llm'
import SessionStore, { SessionId } from '@ahel/dsh-session'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import AgentRegistry from '@ahel/dsh-agent'
import type { Agent } from '@ahel/dsh-agent'
import AgentLoop from '@ahel/dsh-agent-loop'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@ahel/dsh-tools'
import TokenMeter from '@ahel/dsh-token-meter'
import ToolResultPruner from '@ahel/dsh-compaction-tool-result-pruner'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** Run one three-tool-step turn through the production loop and return every model request. */
async function runTurn(enabled: boolean): Promise<{ requests: GenerateOptions[]; agent: Agent }> {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(ToolResultPruner, { earlierResults: { enabled, thresholdChars: 4096, keepChars: 512 } })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([
    toolCallResponse('c1', 'use', { n: 1 }),
    toolCallResponse('c2', 'use', { n: 2 }),
    toolCallResponse('c3', 'use', { n: 3 }),
    textResponse('done'),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'use',
    description: 'return a large result',
    parameters: { n: { type: 'number' } },
    execute: async args => [{ type: 'text', text: String((args as { n: number }).n).repeat(10_000) }],
  }))
  const { agent } = await ctx.agents.create({ sessionId: SessionId(`trim-loop-${enabled}`), agentOptions: { provider: 'mock', model: 'mock' } })
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx!.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return { requests: adapter.requests, agent }
}

/** The text a request sends for one call's result. */
function resultText(request: GenerateOptions, call: string): string | undefined {
  const message = request.messages.find(item => item.role === 'tool' && item.toolCallId === ToolCallId(call))
  return message?.content.map(block => block.type === 'text' ? block.text : '').join('')
}

describe('earlier tool-result trimming in the agent loop', () => {
  it('sends each fresh result whole once, then the same trimmed bytes on every later step', async () => {
    const { requests, agent } = await runTurn(true)
    expect(requests).toHaveLength(4)
    const [, second, third, fourth] = requests as [GenerateOptions, GenerateOptions, GenerateOptions, GenerateOptions]

    expect(resultText(second, 'c1')).toBe('1'.repeat(10_000))
    const trimmedOne = resultText(third, 'c1')!
    expect(trimmedOne).toBe(`${'1'.repeat(512)}\n\n[trimmed: 10 KB more; call the tool again for the full result]`)
    expect(resultText(third, 'c2')).toBe('2'.repeat(10_000))
    expect(resultText(fourth, 'c1')).toBe(trimmedOne)
    expect(resultText(fourth, 'c2')!.startsWith('2'.repeat(512))).toBe(true)
    expect(resultText(fourth, 'c3')).toBe('3'.repeat(10_000))

    const originals = agent.session.snapshotEvents()
      .filter(event => event.type === 'tool/result' && 'surfaceOp' in event && event.surfaceOp === 'append')
    expect(originals.map(event => event.type === 'tool/result' ? event.data.message.content : [])).toEqual(
      ['1', '2', '3'].map(digit => [{ type: 'text', text: digit.repeat(10_000) }]),
    )
  })

  it('sends every result whole when the knob is off', async () => {
    const { requests } = await runTurn(false)
    const fourth = requests[3]!
    for (const [call, digit] of [['c1', '1'], ['c2', '2'], ['c3', '3']] as const) {
      expect(resultText(fourth, call)).toBe(digit.repeat(10_000))
    }
  })
})
