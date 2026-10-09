import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { credentialRef } from '@ahel/dsh-credentials'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import LlmRuntime, { BlockAssembler, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@ahel/dsh-llm'
import type { GenerateOptions, RequestMessage, ToolCallId } from '@ahel/dsh-llm'
import { writeOAuthGrant } from '@ahel/dsh-mcp-client'
import AhelAccount from '@ahel/dsh-ahel-account'
import * as LlmAhel from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

const MODELS = ['anthropic/claude-sonnet-5', 'openai/gpt-5.5']

/** A fake metered proxy that records every chat request body and its headers. */
async function recordingProxy() {
  const bodies: Array<{ body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }> = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
    request.on('end', () => {
      if (request.url === '/api/llm/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          object: 'list', data: MODELS.map(id => ({ id, object: 'model', name: id, context_length: 200_000, max_output_tokens: 8_192 })),
        }))
        return
      }
      bodies.push({ body: JSON.parse(text) as Record<string, unknown>, headers: request.headers })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"ok"},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { baseURL: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/llm/v1`, bodies }
}

async function signedIn(baseURL: string): Promise<Context> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-llm-ahel-cache-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  await writeOAuthGrant(ctx.credentials, credentialRef('AHEL_ACCOUNT'), {
    version: 1, issuer: 'https://ahel.ai', token_endpoint: 'https://ahel.ai/api/auth/mcp/token',
    client_id: 'client-1', access_token: 'access-1', refresh_token: 'refresh-1', expires_at: Date.now() + 3_600_000,
  })
  const account = ctx.plugin(AhelAccount)
  await account
  const plugin = ctx.plugin(LlmAhel, { baseURL })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await account.dispose(); await credentials.dispose() })
  await expect.poll(async () => (await ctx.llm.listModels('ahel')).map(model => model.id)).toEqual(MODELS)
  return ctx
}

const TOOLS = [
  { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'search', description: 'Search the workspace.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
]

/** Two consecutive steps of one agent turn: the second re-sends the first plus the tool call and its result. */
function steps(model: string): [RequestMessage[], RequestMessage[]] {
  const source = { kind: 'model', provider: 'ahel', model } as const
  const system = createSystemMessage(`You are Ahel. ${'Follow the workspace rules. '.repeat(40)}`)
  const user = createUserMessage({ content: [{ type: 'text', text: 'Summarise README.md' }], source })
  const callId = 'call_1' as ToolCallId
  const call = createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'read_file', arguments: '{"path":"README.md"}' }], source: { provider: 'ahel', model } })
  const result = createToolResultMessage({ callId, content: [{ type: 'text', text: '# Readme\nHello.' }], isError: false })
  return [[system, user], [system, user, call, result]]
}

async function send(ctx: Context, model: string, messages: RequestMessage[]): Promise<void> {
  const assembler = new BlockAssembler()
  const request: GenerateOptions = { provider: 'ahel', model, messages, tools: TOOLS, sessionId: 'session-42' as NonNullable<GenerateOptions['sessionId']> }
  for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk)
  expect(assembler.finish).toEqual({ kind: 'stop' })
}

/**
 * The body with every cache marker removed: what the provider caches as the
 * prompt. A breakpoint turns string content into one text part, which the
 * Messages API reads as the same block, so a lone text part reads as its string.
 */
function unmarked(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unmarked)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).filter(([key]) => key !== 'cache_control').map(([key, inner]) => [key, unmarked(inner)] as const)
  return Object.fromEntries(entries.map(([key, inner]) => [key, key === 'content' ? loneText(inner) : inner]))
}

function loneText(content: unknown): unknown {
  if (!Array.isArray(content) || content.length !== 1) return content
  const [part] = content as Array<Record<string, unknown>>
  return Object.keys(part!).length === 2 && part!.type === 'text' && typeof part!.text === 'string' ? part!.text : content
}

it('marks Anthropic prompts for caching, keeps the prefix byte-identical across steps, and names the session', async () => {
  const proxy = await recordingProxy()
  const ctx = await signedIn(proxy.baseURL)
  const [first, second] = steps(MODELS[0]!)
  await send(ctx, MODELS[0]!, first)
  await send(ctx, MODELS[0]!, second)
  const [a, b] = proxy.bodies.map(entry => entry.body) as [Record<string, unknown>, Record<string, unknown>]
  if (process.env.PROMPT_CACHE_CAPTURE) await writeFile(process.env.PROMPT_CACHE_CAPTURE, JSON.stringify([a, b], null, 2))

  // Same prompt prefix: step 2 is step 1 plus the new messages, once markers are ignored.
  const aMessages = unmarked(a.messages) as unknown[]
  const bMessages = unmarked(b.messages) as unknown[]
  expect(bMessages.slice(0, aMessages.length)).toEqual(aMessages)
  expect(unmarked(b.tools)).toEqual(unmarked(a.tools))
  expect(JSON.stringify(unmarked(b.tools))).toBe(JSON.stringify(unmarked(a.tools)))

  // Breakpoints: system, last tool, last conversation message.
  for (const body of [a, b]) {
    const messages = body.messages as Array<{ role: string; content: unknown }>
    const ephemeral = { type: 'ephemeral' }
    expect(messages[0]!.content).toEqual([expect.objectContaining({ type: 'text', cache_control: ephemeral })])
    expect((body.tools as Array<Record<string, unknown>>).at(-1)!.cache_control).toEqual(ephemeral)
    expect(messages.at(-1)!.content).toEqual([expect.objectContaining({ cache_control: ephemeral })])
    expect(JSON.stringify(body).split('"cache_control"').length - 1).toBeLessThanOrEqual(4)
  }
  expect(proxy.bodies.map(entry => entry.headers['x-session-id'])).toEqual(['session-42', 'session-42'])
})

it('leaves other model families unmarked, so their automatic prefix caching sees the plain prompt', async () => {
  const proxy = await recordingProxy()
  const ctx = await signedIn(proxy.baseURL)
  const [first] = steps(MODELS[1]!)
  await send(ctx, MODELS[1]!, first)
  expect(JSON.stringify(proxy.bodies[0]!.body)).not.toContain('cache_control')
  expect(proxy.bodies[0]!.headers['x-session-id']).toBe('session-42')
})

it('writes a cache entry ahead of the fresh tool results, so a request that trims them still reads the history before', async () => {
  const proxy = await recordingProxy()
  const ctx = await signedIn(proxy.baseURL)
  const model = MODELS[0]!
  const [, second] = steps(model)
  const callId = 'call_2' as ToolCallId
  const call = createAssistantMessage({ content: [{ type: 'text', text: 'Searching too.' }, { type: 'tool-call', id: callId, name: 'search', arguments: '{"query":"x"}' }], source: { provider: 'ahel', model } })
  const fresh = createToolResultMessage({ callId, content: [{ type: 'text', text: 'found' }], isError: false })
  // The third request trims the first result the model already saw.
  const trimmed = createToolResultMessage({ callId: 'call_1' as ToolCallId, content: [{ type: 'text', text: '# Readme\n\n[trimmed: 1 KB more; call the tool again for the full result]' }], isError: false })
  await send(ctx, model, second)
  await send(ctx, model, [...second.slice(0, 3), trimmed, call, fresh])
  type Messages = Array<{ role: string; content: unknown }>
  const [b, c] = proxy.bodies.map(entry => entry.body.messages as Messages) as [Messages, Messages]

  // Step 2 marks the user turn before its fresh result; step 3 is identical up to that marker.
  const marked = b.findIndex((message, index) => index > 0 && index < b.length - 1 && JSON.stringify(message).includes('cache_control'))
  expect(b[marked]!.role).toBe('user')
  expect(unmarked(c.slice(0, marked + 1))).toEqual(unmarked(b.slice(0, marked + 1)))
  // Step 3 marks the assistant text that issued its fresh call.
  expect(c[4]!.content).toEqual([expect.objectContaining({ text: 'Searching too.', cache_control: { type: 'ephemeral' } })])
  expect(JSON.stringify(c).split('"cache_control"').length - 1).toBeLessThanOrEqual(4)
})
