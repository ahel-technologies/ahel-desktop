/** web_search through a fake Ahel gateway with the real account, seam, tool registry and tool-web. */

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import AhelAccount from '@ahel/dsh-ahel-account'
import { credentialRef } from '@ahel/dsh-credentials'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import { ToolCallId } from '@ahel/dsh-llm'
import { writeOAuthGrant } from '@ahel/dsh-mcp-client'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime from '@ahel/dsh-tools'
import WebRuntime from '@ahel/dsh-web'
import * as WebSearchAhel from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** A fake Ahel gateway answering `use` on Web Search the way ahel.ai does. */
async function fakeGateway() {
  type RpcBody = { method: string; params: { name: string; arguments: Record<string, unknown> } }
  const calls: Array<{ path: string; authorization: string | undefined; body: RpcBody }> = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    request.on('end', () => {
      if (request.url?.startsWith('/mcp') !== true) {
        response.writeHead(200).end('ok')
        return
      }
      const body = JSON.parse(raw) as { id: number; method: string; params: { name: string; arguments: Record<string, unknown> } }
      calls.push({ path: request.url, authorization: request.headers.authorization, body })
      const result = [
        { title: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/', snippet: 'An open protocol for tools.' },
        { title: 'MCP on Wikipedia', url: 'https://en.wikipedia.org/wiki/Model_Context_Protocol', snippet: 'An open standard.' },
      ]
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: { view: 'execution', operation: 'use', target: 'ahel-services-web-search', result },
        },
      }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, calls }
}

it('mounts web_search while signed in, searches through Ahel Web Search, and drops the tools on sign-out', async () => {
  const gateway = await fakeGateway()
  const home = await mkdtemp(join(tmpdir(), 'dsh-web-search-ahel-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: 'ahel', fetchProvider: 'ahel' })
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const ref = credentialRef('AHEL_ACCOUNT')
  await writeOAuthGrant(ctx.credentials, ref, {
    version: 1,
    issuer: gateway.origin,
    token_endpoint: `${gateway.origin}/token`,
    client_id: 'client-1',
    access_token: 'access-1',
    expires_at: Date.now() + 3_600_000,
  })
  const account = ctx.plugin(AhelAccount, { appOrigin: gateway.origin, resource: `${gateway.origin}/mcp` })
  await account
  const plugin = ctx.plugin(WebSearchAhel, {})
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await account.dispose(); await credentials.dispose() })

  await expect.poll(() => ctx.tools.get('web_search') !== undefined && ctx.tools.get('web_fetch') !== undefined).toBe(true)
  const out = await ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('call-1'), name: 'web_search', arguments: { queries: ['model context protocol'] },
  })
  expect(out.isError).toBe(false)
  const text = out.content.map(block => block.type === 'text' ? block.text : '').join('')
  expect(text).toContain('- [Model Context Protocol](https://modelcontextprotocol.io/) — An open protocol for tools.')
  expect(text).toContain('[MCP on Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)')
  expect(gateway.calls).toHaveLength(1)
  expect(gateway.calls[0]).toMatchObject({
    path: '/mcp',
    authorization: 'Bearer access-1',
    body: { method: 'tools/call', params: { name: 'use', arguments: { key: 'ahel-services-web-search', tool: 'web_search', arguments: { query: 'model context protocol', limit: 8 } } } },
  })

  await ctx.credentials.unset(ref)
  await expect.poll(() => ctx.tools.get('web_search') === undefined && ctx.tools.get('web_fetch') === undefined).toBe(true)
})
