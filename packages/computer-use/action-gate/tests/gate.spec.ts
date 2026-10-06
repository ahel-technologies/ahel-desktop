import { describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import LlmRuntime, { ToolCallId } from '@ahel/dsh-llm'
import SessionStore, { Session, SessionId } from '@ahel/dsh-session'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import SystemPrompt from '@ahel/dsh-system-prompt'
import AgentRegistry, { type Agent } from '@ahel/dsh-agent'
import AgentLoop from '@ahel/dsh-agent-loop'
import ApprovalService, { type ApprovalRequest } from '@ahel/dsh-user-approval'
import ToolRuntime, { defineTool } from '@ahel/dsh-tools'
import type { JsonValue } from '@ahel/dsh-util-values'
import ComputerUseGate, { blockReason, classify, type ComputerUseCard } from '../src/index.ts'

const PREFIX = 'mcp__ahel-computer__'
const TOKEN = 's0000000a:1'
const SECURE_TOKEN = 's0000000a:2'

/** One observed TextEdit window with a Save button and a password field. */
const WINDOW_STATE: JsonValue = {
  content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
  structuredContent: {
    pid: 501,
    window_id: 77,
    app_name: 'TextEdit',
    window_title: 'Untitled',
    elements: [
      { role: 'AXButton', label: 'Save', element_token: TOKEN, screenshot_frame: { x: 100, y: 40, w: 60, h: 24 } },
      { role: 'AXSecureTextField', label: 'Password', element_token: SECURE_TOKEN, screenshot_frame: { x: 100, y: 80, w: 160, h: 24 } },
    ],
  },
}

function fakeTool(name: string, value: JsonValue, onRun?: () => void) {
  return defineTool({
    name: `${PREFIX}${name}`,
    description: name,
    parameters: {
      pid: { type: 'number' },
      window_id: { type: 'number' },
      element_token: { type: 'string' },
      text: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'ok' }] },
    async execute() {
      onRun?.()
      return value
    },
  })
}

const cancelled: unknown[] = []

function fakeAgent(): Agent {
  const session = Session.create(SessionId('computer-use-gate'))
  session.append('turn/start', { turn: 1 })
  const agent: Partial<Agent> = { session, cancel: (cause) => { cancelled.push(cause) } }
  return agent as Agent
}

async function setup(enabled: boolean) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ApprovalService)
  // Stands in for the `computerUse` switch service of @ahel/dsh-computer-use.
  const toggle = { enabled, setEnabled: (next: boolean) => { toggle.enabled = next; return Promise.resolve() } }
  ctx.provide('computerUse', toggle)
  await ctx.plugin(ComputerUseGate, {})
  const clicks: string[] = []
  ctx.tools.register(fakeTool('get_window_state', WINDOW_STATE))
  ctx.tools.register(fakeTool('click', { content: [], structuredContent: { effect: 'confirmed', route: 'accessibility' } }, () => { clicks.push('click') }))
  ctx.tools.register(fakeTool('type_text', { content: [] }, () => { clicks.push('type') }))
  ctx.tools.register(fakeTool('wipe_disk', { content: [] }))
  return { ctx, clicks }
}

function call(ctx: Context, agent: Agent, name: string, args: Record<string, JsonValue>, id: string) {
  return ctx.tools.execute({ callId: ToolCallId(id), name: `${PREFIX}${name}`, arguments: args, agent, signal: new AbortController().signal })
}

describe('classification', () => {
  it('runs reads, asks for writes and denies everything else', () => {
    expect(classify('get_window_state')).toBe('read')
    expect(classify('list_windows')).toBe('read')
    expect(classify('click')).toBe('write')
    expect(classify('type_text')).toBe('write')
    expect(classify('run_actions')).toBe('unknown')
    expect(classify('wipe_disk')).toBe('unknown')
  })
})

describe('hard blocks', () => {
  const base = { app: null, bundleId: null, window: null, element: null, focusedSecure: false, writesText: false, urls: [] }

  it('blocks password fields, security apps and the user list, and lets ordinary targets through', () => {
    expect(blockReason({ ...base, app: 'Safari', element: { role: 'AXSecureTextField', label: null } }, [])).toMatch(/password field/)
    expect(blockReason({ ...base, app: 'Terminal', bundleId: 'com.apple.Terminal' }, [])).toMatch(/Terminal/)
    expect(blockReason({ ...base, app: 'System Settings', window: 'Privacy & Security' }, [])).toMatch(/System Settings/)
    expect(blockReason({ ...base, app: 'System Settings', window: 'Wi-Fi' }, [])).toBeNull()
    expect(blockReason({ ...base, app: 'Mail', bundleId: 'com.apple.mail' }, ['com.apple.mail'])).toMatch(/user blocked/)
    expect(blockReason({ ...base, app: 'TextEdit', element: { role: 'AXButton', label: 'Save' } }, [])).toBeNull()
  })
})

describe('gate', () => {
  it('runs a read without asking, then asks for a write with a card and runs it once approved', async () => {
    const { ctx, clicks } = await setup(true)
    const agent = fakeAgent()
    const asked: ApprovalRequest[] = []
    const cards: (ComputerUseCard | null)[] = []
    ctx.on('approval/request', (req) => {
      asked.push(req)
      cards.push(ctx.computerUseGate.card(req.callId ?? ''))
      return Promise.resolve('allowed-once' as const)
    })

    const read = await call(ctx, agent, 'get_window_state', { pid: 501, window_id: 77 }, 'read-1')
    expect(read.isError).toBe(false)
    expect(asked).toHaveLength(0)

    const write = await call(ctx, agent, 'click', { element_token: TOKEN }, 'write-1')
    expect(write.isError).toBe(false)
    expect(clicks).toEqual(['click'])
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ toolName: `${PREFIX}click`, callId: 'write-1' })
    expect(cards[0]).toMatchObject({
      action: 'click', app: 'TextEdit', window: 'Untitled', element: { role: 'AXButton', label: 'Save' },
      summary: 'Click “Save” button in TextEdit',
      crop: { x: 76, y: 16, width: 108, height: 72 },
    })
    const rows = ctx.computerUseGate.view().sessions[0]?.activity.map(row => row.status)
    expect(rows).toEqual(['read', 'done'])
  })

  it('refuses a password field and unknown tools before asking, and everything while off', async () => {
    const { ctx, clicks } = await setup(true)
    const agent = fakeAgent()
    let asked = 0
    ctx.on('approval/request', () => { asked += 1; return Promise.resolve('allowed-once' as const) })
    await call(ctx, agent, 'get_window_state', { pid: 501, window_id: 77 }, 'read-1')

    const secure = await call(ctx, agent, 'type_text', { element_token: SECURE_TOKEN, text: 'hunter2' }, 'write-1')
    expect(secure.isError).toBe(true)
    expect(JSON.stringify(secure.content)).toMatch(/password field/)
    const unknown = await call(ctx, agent, 'wipe_disk', {}, 'write-2')
    expect(JSON.stringify(unknown.content)).toMatch(/not an allowed computer-use action/)
    expect(asked).toBe(0)
    expect(clicks).toEqual([])

    await ctx.computerUseGate.stop()
    expect(cancelled).toContainEqual({ kind: 'user' })
    const stopped = await call(ctx, agent, 'get_window_state', { pid: 501, window_id: 77 }, 'read-3')
    expect(JSON.stringify(stopped.content)).toMatch(/Computer use is turned off/)

    const off = await setup(false)
    const denied = await call(off.ctx, fakeAgent(), 'get_window_state', { pid: 501, window_id: 77 }, 'read-2')
    expect(JSON.stringify(denied.content)).toMatch(/Computer use is turned off/)
  })
})
