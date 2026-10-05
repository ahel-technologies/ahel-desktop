import { mkdtempSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentRuntime, { type SubagentRunEndInfo } from '../src/index.ts'
import { loadStoredSession } from './persistence-helpers.ts'

const PROVIDER = 'messages'
const MODEL = 'messages-model'
const start = { type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: { input_tokens: 12, output_tokens: 1 } } }
const end = () => [
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]
type SseEvent = { type: string; [field: string]: unknown }
const sse = (events: SseEvent[]) => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')

/** Loopback Messages endpoint recording each request's JSON body. */
async function server(reply: (response: ServerResponse, count: number) => void) {
  const requests: { body: unknown }[] = []
  const http = createServer((request, response) => {
    void (async () => {
      const parts: Buffer[] = []
      for await (const part of request as AsyncIterable<Buffer>) parts.push(part)
      requests.push({ body: JSON.parse(Buffer.concat(parts).toString()) })
      response.setHeader('content-type', 'text/event-stream')
      reply(response, requests.length)
    })().catch((error: unknown) => response.destroy(error as Error))
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('missing loopback port')
  return {
    url: `http://127.0.0.1:${address.port}`, requests,
    async close() {
      const closed = new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
      http.closeAllConnections()
      await closed
    },
  }
}

/** Role and concatenated text of each wire message; the adapter may send text as a string or as blocks. */
function wireTurns(body: unknown): [string, string][] {
  const { messages } = body as { messages: { role: string; content: string | { type: string; text?: string }[] }[] }
  return messages.map(({ role, content }) => [
    role,
    typeof content === 'string' ? content : content.map(block => block.text ?? '').join(''),
  ])
}

afterEach(() => {
  vi.unstubAllEnvs()
})

it('continues the parent through a Messages adapter after a reasoning-bearing continuable child settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settlement-messages-'))
  const ctx = new Context()
  let http: Awaited<ReturnType<typeof server>> | undefined
  try {
    http = await server((response, count) => {
      const blocks = count === 1
        ? [{ type: 'thinking', thinking: 'child reasoning' }, { type: 'text', text: 'child answer' }]
        : [{ type: 'text', text: 'parent answer' }]
      response.end(sse([
        start,
        ...blocks.flatMap((content_block, index): SseEvent[] => [
          { type: 'content_block_start', index, content_block },
          { type: 'content_block_stop', index },
        ]),
        ...end(),
      ]))
    })
    const { requests } = http
    vi.stubEnv('MESSAGES_TEST_KEY', 'test-key')
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(LlmPiAi, {
      providers: {
        [PROVIDER]: { apiKeyEnv: 'MESSAGES_TEST_KEY', api: 'anthropic-messages', baseURL: http.url, models: [{ id: MODEL }] },
      },
    })
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: PROVIDER, model: MODEL })
    const ends: SubagentRunEndInfo[] = []
    const settled = Promise.withResolvers<undefined>()
    ctx.on('subagent/end', (info) => {
      ends.push(info)
      settled.resolve(undefined)
    })

    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child task',
      request: { parent, prompt: [{ type: 'text', text: 'child task' }] },
      signal: new AbortController().signal,
    })
    await settled.promise
    await parent.whenIdle()

    const output = [{ type: 'reasoning', text: 'child reasoning' }, { type: 'text', text: 'child answer' }]
    expect(ends).toHaveLength(1)
    expect(ends[0]?.lastAssistantMessage).toEqual(output)
    const child = await loadStoredSession(ctx.sessionPersistence, started.childId)
    expect(child.events.filter(event => event.type === 'assistant/message').at(-1))
      .toMatchObject({ data: { message: { content: output } } })
    expect(parent.session.snapshotEvents().at(-1))
      .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(2)
    const notice = parent.session.deriveMessages().find(message => message.source.kind === 'subagent-settled')
    expect(notice?.content).toEqual([
      { type: 'text', text: `Background subagent ${started.childId} finished and will do no further work unless you send it more.` },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'child answer' },
    ])
    const noticeText = notice!.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(wireTurns(requests[1]?.body)).toEqual([['user', noticeText]])

    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }))
    await parent.whenIdle()
    expect(parent.session.snapshotEvents().filter(event => event.type === 'turn/end'))
      .toMatchObject([{ data: { reason: { kind: 'completed' } } }, { data: { reason: { kind: 'completed' } } }])
    expect(requests).toHaveLength(3)
    expect(wireTurns(requests[2]?.body)).toEqual([
      ['user', noticeText],
      ['assistant', 'parent answer'],
      ['user', 'continue'],
    ])
  } finally {
    try {
      await ctx.fiber.dispose()
    } finally {
      try {
        await http?.close()
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  }
})
