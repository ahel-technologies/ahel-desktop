/** Host end of the MCP Apps postMessage bridge, driven as a fake app frame would drive it. */

import { describe, expect, it, vi, type Mock } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { McpAppBridge, MCP_APPS_PROTOCOL_VERSION, RPC_ERRORS, readRpcMessage, type McpAppBridgeHandlers } from '../src/client/bridge.ts'

type HandlerMocks = { readonly [K in keyof McpAppBridgeHandlers]: Mock<McpAppBridgeHandlers[K]> }

interface Harness {
  bridge: McpAppBridge
  posted: JsonValue[]
  handlers: HandlerMocks
}

function harness(overrides: Partial<McpAppBridgeHandlers> = {}): Harness {
  const posted: JsonValue[] = []
  const handlers: HandlerMocks = {
    callTool: vi.fn<McpAppBridgeHandlers['callTool']>(overrides.callTool ?? (async () => ({ content: [{ type: 'text', text: 'called' }] }))),
    readResource: vi.fn<McpAppBridgeHandlers['readResource']>(overrides.readResource ?? (async () => ({ contents: [] }))),
    openLink: vi.fn<McpAppBridgeHandlers['openLink']>(),
    sizeChanged: vi.fn<McpAppBridgeHandlers['sizeChanged']>(),
  }
  const bridge = new McpAppBridge({
    post: (message) => { posted.push(message) },
    hostInfo: { name: 'test-host', version: '1' },
    hostContext: { theme: 'dark', displayMode: 'inline' },
    handlers: {
      callTool: (...args) => handlers.callTool(...args),
      readResource: (...args) => handlers.readResource(...args),
      openLink: (...args) => { handlers.openLink(...args) },
      sizeChanged: (...args) => { handlers.sizeChanged(...args) },
    },
  })
  return { bridge, posted, handlers }
}

/** The first call's leading arguments, with its cancellation signal checked. */
function firstCall(mock: Mock<(...args: never[]) => unknown>, leading: number): unknown[] {
  const call: unknown[] = mock.mock.calls[0] ?? []
  expect(call[leading]).toBeInstanceOf(AbortSignal)
  return call.slice(0, leading)
}

/** Let queued handler promises settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function initialize(bridge: McpAppBridge): void {
  bridge.receive({
    jsonrpc: '2.0', id: 1, method: 'ui/initialize',
    params: { appInfo: { name: 'app', version: '1' }, appCapabilities: {}, protocolVersion: MCP_APPS_PROTOCOL_VERSION },
  })
  bridge.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })
}

describe('McpAppBridge handshake', () => {
  it('answers ui/initialize with host info, capabilities, and context', async () => {
    const { bridge, posted } = harness()
    bridge.receive({ jsonrpc: '2.0', id: 'init', method: 'ui/initialize', params: { protocolVersion: '2026-01-26' } })
    await settle()
    expect(posted).toEqual([{
      jsonrpc: '2.0', id: 'init',
      result: {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'test-host', version: '1' },
        hostCapabilities: {
          openLinks: {}, serverTools: {}, serverResources: {}, logging: {},
          updateModelContext: { text: {}, structuredContent: {} },
        },
        hostContext: { theme: 'dark', displayMode: 'inline' },
      },
    }])
    expect(bridge.isInitialized).toBe(false)
  })

  it('holds tool input and result until the app reports initialized, then sends them in order', async () => {
    const { bridge, posted } = harness()
    bridge.sendToolInput({ id: 'a1' })
    bridge.sendToolResult({ content: [{ type: 'text', text: 'done' }], structuredContent: { view: 'question' }, _meta: { token: 't' } })
    expect(posted).toEqual([])
    initialize(bridge)
    await settle()
    const notifications = posted.filter(message => typeof message === 'object' && message !== null && !Array.isArray(message) && 'method' in message)
    expect(notifications).toEqual([
      { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { id: 'a1' } } },
      {
        jsonrpc: '2.0', method: 'ui/notifications/tool-result',
        params: { content: [{ type: 'text', text: 'done' }], structuredContent: { view: 'question' }, _meta: { token: 't' } },
      },
    ])
    expect(bridge.isInitialized).toBe(true)
  })

  it('sends only changed host context fields after initialization', async () => {
    const { bridge, posted } = harness()
    initialize(bridge)
    await settle()
    posted.length = 0
    bridge.setHostContext({ theme: 'light', displayMode: 'inline' })
    bridge.setHostContext({ theme: 'light', displayMode: 'inline' })
    expect(posted).toEqual([{ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { theme: 'light' } }])
  })
})

describe('McpAppBridge app requests', () => {
  it('proxies tools/call to the host handler and returns its result', async () => {
    const { bridge, posted, handlers } = harness()
    initialize(bridge)
    bridge.receive({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'run_action', arguments: { press_token: 'p' } } })
    await settle()
    expect(firstCall(handlers.callTool, 2)).toEqual(['run_action', { press_token: 'p' }])
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'called' }] } })
  })

  it('reports a failing tool call as a JSON-RPC error', async () => {
    const { bridge, posted } = harness({ callTool: async () => { throw new Error('denied by policy') } })
    initialize(bridge)
    bridge.receive({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'run_action' } })
    await settle()
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 8, error: { code: RPC_ERRORS.internal, message: 'denied by policy' } })
  })

  it('rejects tools/call without a tool name', async () => {
    const { bridge, posted, handlers } = harness()
    bridge.receive({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { arguments: {} } })
    await settle()
    expect(handlers.callTool).not.toHaveBeenCalled()
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 9, error: { code: RPC_ERRORS.invalidParams, message: 'tools/call needs a name and object arguments' } })
  })

  it('proxies resources/read to the host handler', async () => {
    const { bridge, posted, handlers } = harness()
    bridge.receive({ jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'ui://a/b.html' } })
    await settle()
    expect(firstCall(handlers.readResource, 1)).toEqual(['ui://a/b.html'])
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 10, result: { contents: [] } })
  })

  it('opens http and https links and refuses other schemes', async () => {
    const { bridge, posted, handlers } = harness()
    bridge.receive({ jsonrpc: '2.0', id: 11, method: 'ui/open-link', params: { url: 'https://ahel.ai/approve' } })
    bridge.receive({ jsonrpc: '2.0', id: 12, method: 'ui/open-link', params: { url: 'javascript:alert(1)' } })
    await settle()
    expect(handlers.openLink).toHaveBeenCalledTimes(1)
    expect(handlers.openLink).toHaveBeenCalledWith('https://ahel.ai/approve')
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 11, result: {} })
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 12, error: { code: RPC_ERRORS.refused, message: 'only http and https links can be opened' } })
  })

  it('applies size changes and ignores invalid sizes', () => {
    const { bridge, handlers } = harness()
    bridge.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 400, height: 321 } })
    bridge.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 'wide', height: -1 } })
    expect(handlers.sizeChanged.mock.calls).toEqual([[{ width: 400, height: 321 }], [{}]])
  })

  it('keeps the latest model context, answers ping, declines ui/message, and refuses unknown methods', async () => {
    const { bridge, posted } = harness()
    bridge.receive({ jsonrpc: '2.0', id: 13, method: 'ui/update-model-context', params: { content: [{ type: 'text', text: 'step 2' }] } })
    bridge.receive({ jsonrpc: '2.0', id: 14, method: 'ping' })
    bridge.receive({ jsonrpc: '2.0', id: 15, method: 'ui/message', params: { role: 'user', content: [] } })
    bridge.receive({ jsonrpc: '2.0', id: 16, method: 'sampling/createMessage', params: {} })
    bridge.receive({ jsonrpc: '2.0', id: 17, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
    await settle()
    expect(bridge.latestModelContext).toEqual({ content: [{ type: 'text', text: 'step 2' }] })
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 13, result: {} })
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 14, result: {} })
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 15, result: { isError: true } })
    expect(posted).toContainEqual({
      jsonrpc: '2.0', id: 16,
      error: { code: RPC_ERRORS.methodNotFound, message: 'method sampling/createMessage is not supported by this host' },
    })
    expect(posted).toContainEqual({ jsonrpc: '2.0', id: 17, result: { mode: 'inline' } })
  })

  it('ignores malformed payloads', async () => {
    const { bridge, posted } = harness()
    for (const payload of [null, 'text', { id: 1, method: 'ping' }, { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0' }, { jsonrpc: '2.0', id: {}, method: 'ping' }]) {
      bridge.receive(payload)
    }
    await settle()
    expect(posted).toEqual([])
    expect(readRpcMessage({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })).toBeNull()
  })
})

describe('McpAppBridge lifecycle', () => {
  it('aborts in-flight host work and stops posting once disposed', async () => {
    let seen: AbortSignal | undefined
    const { bridge, posted } = harness({
      callTool: (_name, _args, signal) => {
        seen = signal
        return new Promise(() => {})
      },
    })
    initialize(bridge)
    await settle()
    posted.length = 0
    bridge.receive({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'slow' } })
    bridge.dispose()
    expect(seen?.aborted).toBe(true)
    bridge.sendToolResult({ content: [] })
    bridge.receive({ jsonrpc: '2.0', id: 21, method: 'ping' })
    await settle()
    expect(posted).toEqual([])
  })

  it('sends ui/resource-teardown and finishes when the app answers', async () => {
    const { bridge, posted } = harness()
    initialize(bridge)
    await settle()
    posted.length = 0
    const done = bridge.teardown(10_000)
    expect(posted).toEqual([{ jsonrpc: '2.0', id: 'host-1', method: 'ui/resource-teardown', params: {} }])
    bridge.receive({ jsonrpc: '2.0', id: 'host-1', result: {} })
    await done
    bridge.receive({ jsonrpc: '2.0', id: 22, method: 'ping' })
    await settle()
    expect(posted).toHaveLength(1)
  })
})
