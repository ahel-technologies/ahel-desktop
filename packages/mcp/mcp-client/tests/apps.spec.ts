/** MCP Apps metadata through a real SDK connection: tool `_meta`, result `_meta`, and cached `ui://` reads. */

import { z } from 'zod'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport, type Transport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { startConnection, resolveReconnectPolicy } from '../src/connection.ts'
import { appResultMeta, MAX_PERSISTED_APP_RESULT_CHARS, readToolUi } from '../src/apps.ts'
import type { Config } from '../src/index.ts'

const { mockTransport } = vi.hoisted(() => ({ mockTransport: vi.fn<() => Transport>() }))
vi.mock('../src/transport.ts', () => ({ createTransport: mockTransport }))

const config: Config = {
  transport: 'stdio', serverName: 'cards', command: 'fixture', args: [], env: {}, cwd: '',
  toolCallTimeoutMs: 60_000, failOnStartupError: true,
}

const CARD_URI = 'ui://cards/card-v1.html'
const CARD_HTML = '<!doctype html><html><head></head><body>card</body></html>'

/** Fixture server: one card tool, one text tool, one app-only tool, and the card resource. */
function cardServer(reads: string[]): McpServer {
  const server = new McpServer({ name: 'cards', version: '1' })
  server.registerTool('show', {
    description: 'Show a card.',
    inputSchema: z.object({ id: z.string() }),
    _meta: { ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] }, 'openai/outputTemplate': CARD_URI },
  }, async args => ({
    content: [{ type: 'text', text: `card ${args.id}` }],
    structuredContent: { view: 'question', id: args.id },
    _meta: { 'ai.ahel/pressToken': `token-${args.id}` },
  }))
  server.registerTool('plain', { inputSchema: z.object({}) }, async () => ({
    content: [{ type: 'text', text: 'plain' }],
    _meta: { private: true },
  }))
  server.registerTool('refresh', {
    inputSchema: z.object({}),
    _meta: { ui: { resourceUri: CARD_URI, visibility: ['app'] } },
  }, async () => ({ content: [{ type: 'text', text: 'refreshed' }] }))
  server.registerResource('card', CARD_URI, { mimeType: 'text/html;profile=mcp-app' }, async (uri) => {
    reads.push(uri.href)
    return { contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: CARD_HTML, _meta: { ui: { prefersBorder: true } } }] }
  })
  server.registerResource('memo', 'memo://plain', { mimeType: 'text/plain' }, async (uri) => {
    reads.push(uri.href)
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'memo' }] }
  })
  return server
}

async function connect(server: McpServer, sent: unknown[] = []): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const send = clientTransport.send.bind(clientTransport)
  clientTransport.send = (message, options) => {
    sent.push(message)
    return send(message, options)
  }
  const serving = serveStdio(() => server, { transport: serverTransport })
  mockTransport.mockReturnValue(clientTransport)
  const connection = startConnection(ctx, config, resolveReconnectPolicy({ enabled: false }, 'cards'))
  onTestFinished(async () => {
    await connection.dispose()
    await serving.close()
    await ctx.fiber.dispose()
  })
  expect(await connection.ready).toEqual({})
  ctx.mcpResources.register('cards', connection.resources)
  return ctx
}

describe('MCP Apps tool metadata', () => {
  it('advertises the MCP Apps extension to the server', async () => {
    const sent: unknown[] = []
    await connect(cardServer([]), sent)
    // Modern protocol eras carry client capabilities on every request's _meta;
    // the initialize era carries them once in initialize params.
    const first = sent[0] as { params: { capabilities?: unknown; _meta?: Record<string, unknown> } }
    const capabilities = first.params.capabilities ?? first.params._meta?.['io.modelcontextprotocol/clientCapabilities']
    expect(capabilities).toEqual({
      extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
    })
  })

  it('carries tools/list _meta onto the registered definition and hides app-only tools', async () => {
    const ctx = await connect(cardServer([]))
    expect(ctx.tools.get('mcp__cards__show')?.mcp).toEqual({
      server: 'cards',
      rawName: 'show',
      meta: { ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] }, 'openai/outputTemplate': CARD_URI },
      ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] },
    })
    expect(ctx.tools.get('mcp__cards__plain')?.mcp).toEqual({ server: 'cards', rawName: 'plain', ui: { visibility: ['model', 'app'] } })
    expect(ctx.tools.get('mcp__cards__refresh')).toBeUndefined()
  })

  it('persists structuredContent and result _meta for a card tool without exposing _meta in the value', async () => {
    const ctx = await connect(cardServer([]))
    const result = await ctx.tools.execute({
      name: 'mcp__cards__show', arguments: { id: 'a1' },
      callId: ToolCallId('show-a1'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      content: [{ type: 'text', text: 'card a1' }],
      structuredContent: { view: 'question', id: 'a1' },
    })
    expect(result.meta).toMatchObject({
      mcpApp: {
        v: 1, server: 'cards', tool: 'show', resourceUri: CARD_URI, visibility: ['model', 'app'],
        structuredContent: { view: 'question', id: 'a1' },
        resultMeta: { 'ai.ahel/pressToken': 'token-a1' },
      },
    })
  })

  it('records no presentation metadata for a tool without a UI resource', async () => {
    const ctx = await connect(cardServer([]))
    const result = await ctx.tools.execute({
      name: 'mcp__cards__plain', arguments: {},
      callId: ToolCallId('plain'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.meta).toBeUndefined()
  })

  it('caches ui:// reads per connection generation and reads other URIs uncached', async () => {
    const reads: string[] = []
    const ctx = await connect(cardServer(reads))
    const signal = new AbortController().signal
    const first = await ctx.mcpResources.readAppResource(undefined, 'cards', CARD_URI, signal)
    const second = await ctx.mcpResources.readAppResource(undefined, 'cards', CARD_URI, signal)
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      contents: [{ uri: CARD_URI, mimeType: 'text/html;profile=mcp-app', text: CARD_HTML, _meta: { ui: { prefersBorder: true } } }],
    })
    await ctx.mcpResources.readAppResource(undefined, 'cards', 'memo://plain', signal)
    await ctx.mcpResources.readAppResource(undefined, 'cards', 'memo://plain', signal)
    expect(reads).toEqual([CARD_URI, 'memo://plain', 'memo://plain'])
  })

  it('rejects a read for a server outside the caller scope', async () => {
    const ctx = await connect(cardServer([]))
    await expect(ctx.mcpResources.readAppResource(undefined, 'other', CARD_URI, new AbortController().signal))
      .rejects.toThrow('MCP resource server "other" is unavailable')
  })
})

describe('readToolUi', () => {
  it.each([
    [{ ui: { resourceUri: 'ui://a/b.html' } }, { resourceUri: 'ui://a/b.html', visibility: ['model', 'app'] }],
    [{ 'ui/resourceUri': 'ui://a/flat.html' }, { resourceUri: 'ui://a/flat.html', visibility: ['model', 'app'] }],
    [{ ui: { resourceUri: 'https://a/b.html' } }, { visibility: ['model', 'app'] }],
    [{ ui: { visibility: ['app', 'other'] } }, { visibility: ['app'] }],
    [undefined, { visibility: ['model', 'app'] }],
  ])('reads %j', (meta, expected) => {
    expect(readToolUi(meta)).toEqual(expected)
  })
})

describe('appResultMeta', () => {
  it('drops structured fields over the persisted budget', () => {
    const descriptor = { server: 's', rawName: 't', ui: { resourceUri: 'ui://s/t.html', visibility: ['model' as const] } }
    const huge = 'x'.repeat(MAX_PERSISTED_APP_RESULT_CHARS)
    expect(appResultMeta(descriptor, { huge }, undefined)).toEqual({
      mcpApp: { v: 1, server: 's', tool: 't', resourceUri: 'ui://s/t.html', visibility: ['model'], truncated: true },
    })
  })
})
