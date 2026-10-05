/** Shared MCP Apps card fixtures: a settled card call, card props, and frame messaging helpers. */

import { vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PartialArguments, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { McpAppCard } from '../src/client/McpAppCard.tsx'
import type { McpAppCardProps, McpAppInjected } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'
import type { McpAppCallResult } from '../src/types.ts'

export const CARD_URI = 'ui://cards/card-v1.html'
export const CARD_HTML = '<!doctype html><html><head><title>card</title></head><body><script>void 0</script></body></html>'

/** Settled call fixture carrying a version-1 card record. */
export function cardNode(meta: JsonValue, text = 'card a1'): ToolResultNode {
  const argsRaw = JSON.stringify({ id: 'a1' })
  return {
    kind: 'tool-result', seq: 2, time: 2_000, callId: 'call-1', name: 'mcp__cards__show',
    args: PartialArguments.fromText(argsRaw), call: { name: 'mcp__cards__show', argsRaw }, callTime: 1_000,
    content: [{ type: 'text', text }], isError: false, meta, subCalls: [],
  }
}

/** Card props with the injected face overridable per case. */
export function cardProps(block: ToolResultNode, injected: Partial<McpAppInjected> = {}): McpAppCardProps {
  return {
    callId: block.callId,
    toolName: block.name,
    block,
    readResource: async () => ({ contents: [{ uri: CARD_URI, mimeType: 'text/html;profile=mcp-app', text: CARD_HTML }] }),
    callTool: async (): Promise<McpAppCallResult> => ({ content: [] }),
    openLink: () => {},
    maxHeight: 640,
    platform: 'web',
    useColorScheme: <T,>(select: (scheme: 'light' | 'dark') => T): T => select('dark'),
    t: makeTranslate(en),
    ...injected,
  } as McpAppCardProps
}

/** Deliver one message from the card frame to the host page. */
export function fromFrame(frame: HTMLIFrameElement, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: frame.contentWindow }))
  })
}

/** Messages the host posted to the frame, by method or response id. */
export function postedTo(spy: ReturnType<typeof vi.fn>): { method?: string; id?: unknown; params?: unknown; result?: unknown }[] {
  return spy.mock.calls.map(call => call[0] as { method?: string; id?: unknown; params?: unknown; result?: unknown })
}

/** Render a card and wait until its frame is mounted with a spy on the frame window. */
export async function mountedCard(props: McpAppCardProps): Promise<{ frame: HTMLIFrameElement; posted: ReturnType<typeof vi.fn> }> {
  const view = render(<McpAppCard {...props} />)
  const frame = await waitFor(() => {
    const element = view.container.querySelector('iframe')
    if (element === null) throw new Error('card frame not mounted yet')
    return element
  })
  const target = frame.contentWindow
  if (target === null) throw new Error('card frame has no window')
  const posted = vi.fn()
  target.postMessage = posted
  return { frame, posted }
}
