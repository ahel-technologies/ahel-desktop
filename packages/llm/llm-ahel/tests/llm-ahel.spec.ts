import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { credentialRef } from '@ahel/dsh-credentials'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@ahel/dsh-llm'
import { writeOAuthGrant } from '@ahel/dsh-mcp-client'
import AhelAccount from '@ahel/dsh-ahel-account'
import * as LlmAhel from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

const textEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"hello from ahel"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":3}}',
  '[DONE]',
]

/** A fake metered proxy: the model list, then one streamed answer, then a 402 refusal. */
async function fakeProxy() {
  const seen: Array<{ method: string; path: string; headers: IncomingHttpHeaders }> = []
  let completions = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      seen.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers })
      if (request.url === '/api/llm/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          object: 'list',
          data: [{ id: 'test/model-a', object: 'model', name: 'Model A', context_length: 64_000, max_output_tokens: 4_096 }],
        }))
        return
      }
      if (++completions === 1) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const event of textEvents) response.write(`data: ${event}\n\n`)
        response.end()
        return
      }
      response.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: { message: 'The workspace balance cannot cover this request.', type: 'insufficient_balance', code: 'insufficient_balance' },
      }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { baseURL: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/llm/v1`, seen }
}

async function ask(ctx: Context) {
  const assembler = new BlockAssembler()
  const request = {
    provider: 'ahel',
    model: 'test/model-a',
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'model', provider: 'ahel', model: 'test/model-a' } })],
  }
  for await (const chunk of ctx.llm.stream(request)) assembler.push(chunk)
  return { message: assembler.message({ provider: 'ahel', model: 'test/model-a' }), finish: assembler.finish }
}

it('serves Ahel models with the account bearer and explains a 402', async () => {
  const proxy = await fakeProxy()
  const home = await mkdtemp(join(tmpdir(), 'dsh-llm-ahel-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  await writeOAuthGrant(ctx.credentials, credentialRef('AHEL_ACCOUNT'), {
    version: 1,
    issuer: 'https://ahel.ai',
    token_endpoint: 'https://ahel.ai/api/auth/mcp/token',
    client_id: 'client-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: Date.now() + 3_600_000,
  })
  const account = ctx.plugin(AhelAccount)
  await account
  const plugin = ctx.plugin(LlmAhel, { baseURL: proxy.baseURL })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await account.dispose(); await credentials.dispose() })

  await expect.poll(async () => (await ctx.llm.listModels('ahel')).map(model => model.id)).toEqual(['test/model-a'])
  expect(ctx.llm.listProviders()).toContainEqual(expect.objectContaining({ id: 'ahel', name: 'Ahel' }))
  expect(proxy.seen[0]).toMatchObject({ method: 'GET', path: '/api/llm/v1/models', headers: { authorization: 'Bearer access-1' } })

  const answer = await ask(ctx)
  expect(answer.message.content).toEqual([{ type: 'text', text: 'hello from ahel' }])
  expect(answer.finish).toEqual({ kind: 'stop' })
  expect(proxy.seen.at(-1)).toMatchObject({ method: 'POST', path: '/api/llm/v1/chat/completions', headers: { authorization: 'Bearer access-1' } })

  const refused = await ask(ctx)
  expect(refused.finish).toMatchObject({ kind: 'error', failure: { code: 'QUOTA', status: 402 } })
  expect(refused.finish.kind === 'error' ? refused.finish.failure.message : '').toMatch(/^Ahel models: The workspace balance cannot cover this request\./)
})
