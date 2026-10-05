// @vitest-environment jsdom

/**
 * End to end below the Remote carrier: a fixture MCP server with a card tool
 * and a `ui://` resource, the real mcp-client connection, resource runtime,
 * tool registry, and Host controller, and the Client card in a DOM. The card
 * mounts from the persisted record, and the tool-result notification reaches
 * the frame; a card tools/call runs back through the registry pipeline.
 */

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { CARD_HTML, CARD_URI, cardNode, cardProps, fromFrame, mountedCard, postedTo } from './card-fixtures.client.tsx'
import { startCardHost, type CardHost } from './fixtures/card-host.mjs'

const { mockTransport } = vi.hoisted(() => ({ mockTransport: vi.fn<() => unknown>() }))
vi.mock('@deepseek-ai/dsh-mcp-client/src/transport.ts', () => ({ createTransport: mockTransport }))

afterEach(cleanup)

async function host(): Promise<CardHost> {
  const started = await startCardHost({ uri: CARD_URI, html: CARD_HTML, transport: mockTransport })
  onTestFinished(() => started.dispose())
  return started
}

describe('MCP Apps card host, fixture server to frame', () => {
  it('mounts the card from a real call and delivers the tool result to the frame; a card call runs on the server', async () => {
    const ctx = await host()
    const result = await ctx.execute('mcp__cards__show', { id: 'a1' })
    expect(result.isError).toBe(false)
    const node = cardNode(result.meta ?? null)
    const props = cardProps(node, {
      readResource: (server, uri, signal) => ctx.readResource(server, uri, signal),
      callTool: (server, tool, args, signal) => ctx.callTool(server, tool, args, signal),
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
    const seen = ctx.denyAll('blocked by policy')
    const outcome = await ctx.callTool('cards', 'confirm', { press_token: 't' }, new AbortController().signal)
    expect(seen).toEqual(['mcp__cards__confirm'])
    expect(outcome.isError).toBe(true)
    expect(JSON.stringify(outcome.content)).toContain('blocked by policy')
  })

  it('refuses tools that are model-only, unknown, or on another server', async () => {
    const ctx = await host()
    const signal = new AbortController().signal
    const failures = await Promise.all([
      ctx.callTool('cards', 'search', {}, signal).catch((error: unknown) => error),
      ctx.callTool('cards', 'missing', {}, signal).catch((error: unknown) => error),
      ctx.callTool('other', 'confirm', {}, signal).catch((error: unknown) => error),
    ])
    expect(failures.map(failure => ctx.errorCode(failure))).toEqual([
      'mcp-app/tool-not-app-visible', 'mcp-app/unknown-tool', 'mcp-app/unknown-tool',
    ])
  })
})
