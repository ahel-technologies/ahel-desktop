// @vitest-environment jsdom

/**
 * End to end below the Remote carrier: a fixture MCP server with a card tool
 * and a `ui://` resource, the real mcp-client connection, resource runtime,
 * tool registry, and Host controller, and the Client card in a DOM. The card
 * mounts from the persisted record, and the tool-result notification reaches
 * the frame; a card tools/call runs back through the registry pipeline.
 */

import { z } from 'zod'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport, type Transport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import McpAppsController from '../src/index.ts'
import { CARD_HTML, CARD_URI, cardNode, cardProps, fromFrame, mountedCard, postedTo } from './card-fixtures.client.tsx'

const { mockTransport } = vi.hoisted(() => ({ mockTransport: vi.fn<() => Transport>() }))
vi.mock('@deepseek-ai/dsh-mcp-client/src/transport.ts', () => ({ createTransport: mockTransport }))

afterEach(cleanup)

const config: Config = {
  transport: 'stdio', serverName: 'cards', command: 'fixture', args: [], env: {}, cwd: '',
  toolCallTimeoutMs: 60_000, failOnStartupError: true,
}

/** The Host methods take an Agent lookup; these fixtures register every tool globally. */
const NO_AGENT = undefined as never as Agent

/** Fixture MCP server: a card tool, an app-callable confirm tool, a model-only tool, and the card resource. */
function cardServer(): McpServer {
  const server = new McpServer({ name: 'cards', version: '1' })
  const appMeta = { ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] } }
  server.registerTool('show', { inputSchema: z.object({ id: z.string() }), _meta: appMeta }, async args => ({
    content: [{ type: 'text', text: `card ${args.id}` }],
    structuredContent: { view: 'question', id: args.id },
    _meta: { 'ai.ahel/pressToken': `token-${args.id}` },
  }))
  server.registerTool('confirm', { inputSchema: z.object({ press_token: z.string() }), _meta: appMeta }, async args => ({
    content: [{ type: 'text', text: `confirmed ${args.press_token}` }],
    structuredContent: { view: 'execution', status: 'done' },
  }))
  server.registerTool('search', {
    inputSchema: z.object({}), _meta: { ui: { resourceUri: CARD_URI, visibility: ['model'] } },
  }, async () => ({ content: [{ type: 'text', text: 'results' }] }))
  server.registerResource('card', CARD_URI, { mimeType: 'text/html;profile=mcp-app' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: CARD_HTML, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }],
  }))
  return server
}

async function host(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  await ctx.plugin(McpAppsController)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const serving = serveStdio(() => cardServer(), { transport: serverTransport })
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

describe('MCP Apps card host, fixture server to frame', () => {
  it('mounts the card from a real call and delivers the tool result to the frame; a card call runs on the server', async () => {
    const ctx = await host()
    const result = await ctx.tools.execute({
      name: 'mcp__cards__show', arguments: { id: 'a1' }, callId: ToolCallId('show-a1'), signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    const node = cardNode(result.meta as JsonValue)
    const props = cardProps(node, {
      readResource: (server, uri, signal) => ctx.mcpApps.readResource(NO_AGENT, server, uri, signal),
      callTool: (server, tool, args, signal) => ctx.mcpApps.callTool(NO_AGENT, server, tool, args, signal),
    })
    const { frame, posted } = await mountedCard(props)
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'self'; img-src 'self' data:")

    fromFrame(frame, { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { protocolVersion: '2026-01-26' } })
    fromFrame(frame, { jsonrpc: '2.0', method: 'ui/notifications/initialized' })
    await waitFor(() => { expect(postedTo(posted).some(message => message.method === 'ui/notifications/tool-result')).toBe(true) })
    const delivered = postedTo(posted).find(message => message.method === 'ui/notifications/tool-result')
    expect(delivered?.params).toMatchObject({
      content: [{ type: 'text', text: 'card a1' }],
      structuredContent: { view: 'question', id: 'a1' },
      _meta: { 'ai.ahel/pressToken': 'token-a1' },
    })

    fromFrame(frame, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'confirm', arguments: { press_token: 'token-a1' } } })
    await waitFor(() => { expect(postedTo(posted).some(message => message.id === 2)).toBe(true) })
    expect(postedTo(posted).find(message => message.id === 2)?.result).toMatchObject({
      content: [{ type: 'text', text: 'confirmed token-a1' }],
      structuredContent: { view: 'execution', status: 'done' },
    })
  })

  it('runs card calls through the registry pre-execute policy', async () => {
    const ctx = await host()
    const seen: string[] = []
    ctx.on('tools/pre-execute', async (exec) => {
      seen.push(exec.name)
      return { kind: 'deny', reason: 'blocked by policy' }
    })
    const outcome = await ctx.mcpApps.callTool(NO_AGENT, 'cards', 'confirm', { press_token: 't' }, new AbortController().signal)
    expect(seen).toEqual(['mcp__cards__confirm'])
    expect(outcome.isError).toBe(true)
    expect(JSON.stringify(outcome.content)).toContain('blocked by policy')
  })

  it('refuses tools that are model-only, unknown, or on another server', async () => {
    const ctx = await host()
    const signal = new AbortController().signal
    const failures = await Promise.all([
      ctx.mcpApps.callTool(NO_AGENT, 'cards', 'search', {}, signal).catch((error: unknown) => error),
      ctx.mcpApps.callTool(NO_AGENT, 'cards', 'missing', {}, signal).catch((error: unknown) => error),
      ctx.mcpApps.callTool(NO_AGENT, 'other', 'confirm', {}, signal).catch((error: unknown) => error),
    ])
    expect(failures.map(failure => remoteErrorOf(failure)?.code)).toEqual([
      'mcp-app/tool-not-app-visible', 'mcp-app/unknown-tool', 'mcp-app/unknown-tool',
    ])
  })
})
