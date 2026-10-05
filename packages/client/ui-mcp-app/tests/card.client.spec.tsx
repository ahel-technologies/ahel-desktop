// @vitest-environment jsdom

/** MCP Apps card: sandboxed frame, CSP, bridge wiring through the frame window, and the text fallback. */

import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { McpAppCard } from '../src/client/McpAppCard.tsx'
import { en } from '../src/client/locales.ts'
import type { McpAppCallResult } from '../src/types.ts'
import { CARD_URI, cardNode, cardProps, fromFrame, mountedCard, postedTo } from './card-fixtures.client.tsx'

afterEach(cleanup)

const RECORD = {
  mcpApp: {
    v: 1, server: 'cards', tool: 'show', resourceUri: CARD_URI, visibility: ['model', 'app'],
    structuredContent: { view: 'question', id: 'a1' },
  },
}

/** Live result `_meta` served from Host memory for call-1. */
const liveMeta = async (callId: string) => callId === 'call-1' ? { 'ai.ahel/pressToken': 'token-a1' } : null

describe('McpAppCard', () => {
  it('renders nothing for a call without a valid card record', () => {
    const view = render(<McpAppCard {...cardProps(cardNode({ mcpApp: { v: 2 } }))} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('mounts the resource in a script-only sandbox with the MCP Apps CSP first in its head', async () => {
    const { frame } = await mountedCard(cardProps(cardNode(RECORD)))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(frame.getAttribute('title')).toBe('mcp__cards__show card')
    const srcDoc = frame.getAttribute('srcdoc') ?? ''
    const policyFirst = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
    expect(srcDoc.startsWith(policyFirst)).toBe(true)
    expect(srcDoc).toContain("script-src 'self' 'unsafe-inline'")
    expect(srcDoc).toContain('<script>void 0</script>')
  })

  it('delivers tool input and the tool result to the frame after the app initializes', async () => {
    const { frame, posted } = await mountedCard(cardProps(cardNode(RECORD), { resultMeta: liveMeta }))
    fromFrame(frame, { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { protocolVersion: '2026-01-26' } })
    await waitFor(() => { expect(postedTo(posted).some(message => message.id === 1)).toBe(true) })
    expect(postedTo(posted).some(message => message.method === 'ui/notifications/tool-result')).toBe(false)
    fromFrame(frame, { jsonrpc: '2.0', method: 'ui/notifications/initialized' })
    const notifications = postedTo(posted).filter(message => message.method !== undefined)
    expect(notifications).toEqual([
      { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { id: 'a1' } } },
      {
        jsonrpc: '2.0', method: 'ui/notifications/tool-result',
        params: {
          content: [{ type: 'text', text: 'card a1' }],
          structuredContent: { view: 'question', id: 'a1' },
          _meta: { 'ai.ahel/pressToken': 'token-a1' },
        },
      },
    ])
    const init = postedTo(posted).find(message => message.id === 1)
    expect(init?.result).toMatchObject({ hostContext: { theme: 'dark', displayMode: 'inline', containerDimensions: { maxHeight: 640 }, platform: 'web' } })
  })

  it('ignores messages from any window other than its own frame', async () => {
    const { posted } = await mountedCard(cardProps(cardNode(RECORD)))
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { jsonrpc: '2.0', id: 1, method: 'ping' }, origin: 'null', source: window }))
    })
    expect(posted).not.toHaveBeenCalled()
  })

  it('routes a card tools/call to the card server and resizes to the reported height within the cap', async () => {
    const callTool = vi.fn(async (): Promise<McpAppCallResult> => ({ content: [{ type: 'text', text: 'confirmed' }] }))
    const { frame, posted } = await mountedCard(cardProps(cardNode(RECORD), { callTool, maxHeight: 300 }))
    fromFrame(frame, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_action', arguments: { press_token: 'token-a1' } } })
    await waitFor(() => { expect(postedTo(posted).some(message => message.id === 5)).toBe(true) })
    expect(callTool).toHaveBeenCalledWith('cards', 'run_action', { press_token: 'token-a1' }, expect.any(AbortSignal))
    fromFrame(frame, { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 500, height: 900 } })
    expect(frame.style.height).toBe('300px')
    fromFrame(frame, { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 500, height: 210 } })
    expect(frame.style.height).toBe('210px')
  })

  it('opens links through the injected opener', async () => {
    const openLink = vi.fn()
    // jsdom has no user activation; the card admits links only during one.
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true, hasBeenActive: true } })
    onTestFinished(() => { Reflect.deleteProperty(navigator, 'userActivation') })
    const { frame } = await mountedCard(cardProps(cardNode(RECORD), { openLink }))
    fromFrame(frame, { jsonrpc: '2.0', id: 6, method: 'ui/open-link', params: { url: 'https://ahel.ai/x' } })
    await waitFor(() => { expect(openLink).toHaveBeenCalledWith('https://ahel.ai/x') })
  })

  it('falls back to the text and structured result when the resource cannot be read', async () => {
    const view = render(<McpAppCard {...cardProps(cardNode(RECORD), { readResource: async () => { throw new Error('offline') } })} />)
    await waitFor(() => { expect(view.container.querySelector('[data-mcp-app-fallback="failed"]')).not.toBeNull() })
    expect(view.container.textContent).toContain(en.failed)
    expect(view.container.textContent).toContain('card a1')
    expect(view.container.querySelector('pre')?.textContent).toContain('"view": "question"')
    expect(view.container.querySelector('iframe')).toBeNull()
  })

  it('falls back without reading the resource when the persisted record was truncated', () => {
    const readResource = vi.fn()
    const truncated = { mcpApp: { v: 1, server: 'cards', tool: 'show', resourceUri: CARD_URI, visibility: ['model'], truncated: true } }
    const view = render(<McpAppCard {...cardProps(cardNode(truncated), { readResource })} />)
    expect(readResource).not.toHaveBeenCalled()
    expect(view.container.textContent).toContain(en.tooLarge)
  })
})
