/**
 * The provider in a profile: the Settings switch persists `computerUse.enabled`,
 * starts the fake driver as MCP server `ahel-computer`, and stops it again;
 * with the approval gate composed, reads run, writes wait for approval and
 * Stop turns the driver off.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@ahel/dsh-app-boot'
import ConfigEditor from '@ahel/dsh-config-editor'
import Settings from '@ahel/dsh-settings'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime from '@ahel/dsh-tools'
import LlmRuntime, { ToolCallId } from '@ahel/dsh-llm'
import SessionStore, { Session, SessionId } from '@ahel/dsh-session'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import AgentRegistry, { type Agent } from '@ahel/dsh-agent'
import AgentLoop from '@ahel/dsh-agent-loop'
import ApprovalService from '@ahel/dsh-user-approval'
import ComputerUse from '@ahel/dsh-computer-use'
import ComputerUseGate from '@ahel/dsh-computer-use-action-gate'
import type { JsonValue } from '@ahel/dsh-util-values'
import CuaDriver from '../src/index.ts'
import { STRUCTURED_HEADER } from '../src/structured.ts'

const FAKE = fileURLToPath(new URL('./fixtures/fake-cua-driver.mjs', import.meta.url))
const signal = new AbortController().signal
const panes: string[] = []
let home: string
const saved = { DSH_HOME: process.env.DSH_HOME, FAKE_CUA_DRIVER: process.env.FAKE_CUA_DRIVER, FAKE_CUA_LOG: process.env.FAKE_CUA_LOG }

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-computer-use-')))
  process.env.DSH_HOME = join(home, 'dsh-home')
  process.env.FAKE_CUA_DRIVER = FAKE
  process.env.FAKE_CUA_LOG = join(home, 'driver.ndjson')
  CuaDriver.osaScript = async () => '{"accessibility":true,"screenRecording":false}'
  CuaDriver.openPane = async (pane) => { panes.push(pane) }
  CuaDriver.fetch = () => Promise.reject(new Error('tests never download the driver'))
  // The fake driver runs anywhere; pin the macOS path so Linux CI covers permissions too.
  CuaDriver.platform = 'darwin'
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
})

function profile(): { start: () => ReturnType<typeof boot>; patchPath: string } {
  const dir = join(home, 'profiles', 'desktop')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), readFileSync(new URL('./fixtures/computer-use.patch.yml', import.meta.url)))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const context: ProfileContext = {
    name: 'desktop', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  return {
    patchPath: context.patchPath,
    start: () => boot('desktop', join(dir, 'cordis.yml'), readProfilePatches('desktop', context), (root) => {
      root.provide('profileContext', context)
      Object.assign(root.loader.builtins, {
        editor: ConfigEditor, settings: Settings, systemPrompt: SystemPrompt, tools: ToolRuntime,
        computerUse: ComputerUse, cuaDriver: CuaDriver,
      })
    }),
  }
}

type Booted = Awaited<ReturnType<typeof boot>>

async function phase(ctx: Booted, expected: string): Promise<void> {
  await vi.waitFor(() => { expect(ctx.get('computerUseDriver')?.current().phase).toBe(expected) }, { timeout: 15_000, interval: 50 })
}

function names(ctx: Booted): string[] {
  return ctx.get('tools')!.schemas().map(schema => schema.name).filter(name => name.startsWith('mcp__ahel-computer__')).sort()
}

it('is off by default, turns on from Settings, exposes the driver tools, and turns off again', async () => {
  const { start, patchPath } = profile()
  let ctx: Booted | undefined
  try {
    ctx = await start()
    const driver = ctx.get('computerUseDriver')!
    expect(driver.current()).toMatchObject({ enabled: false, phase: 'off' })
    expect(names(ctx)).toEqual([])

    await driver.setEnabled(true)
    await phase(ctx, 'ready')
    expect(readFileSync(patchPath, 'utf8')).toMatch(/- id: computer-use\n(?: {2}.*\n)*? {4}enabled: true\n/u)
    expect(driver.current()).toMatchObject({ enabled: true, toolCount: 6, driverVersion: '0.34.0' })
    expect(driver.current()).toMatchObject({ accessibility: 'granted', screenRecording: 'missing' })
    // A missing grant opens its System Settings pane; nothing prompts.
    expect(panes).toEqual(['screen-recording'])
    expect(ctx.get('computerUse')!.providerName).toBe('cua-driver')
    expect(names(ctx)).toEqual([
      'mcp__ahel-computer__check_permissions', 'mcp__ahel-computer__click', 'mcp__ahel-computer__get_desktop_state',
      'mcp__ahel-computer__get_window_state', 'mcp__ahel-computer__install_extension', 'mcp__ahel-computer__list_windows',
    ])

    // structuredContent reaches the model text (deepseek-harness #7788).
    const tools = ctx.get('tools')!
    const windows = await tools.execute({ signal, callId: ToolCallId('w'), name: 'mcp__ahel-computer__list_windows', arguments: {} })
    const windowText = windows.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(windowText).toContain('Found 1 window(s).')
    expect(windowText).toContain(STRUCTURED_HEADER)
    expect(windowText).toContain('"window_id":77')
    const find = await tools.execute({ signal, callId: ToolCallId('f'), name: 'mcp__ahel-computer__get_window_state', arguments: { pid: 4242, window_id: 77, query: 'Save' } })
    expect(find.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toContain('"element_token":"tok-save-1"')

    const refused = await tools.execute({ signal, callId: ToolCallId('x'), name: 'mcp__ahel-computer__install_extension', arguments: { name: 'perception' } })
    expect(refused.isError).toBe(true)
    expect(refused.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toContain('install_extension is not available in Ahel Desktop')
    const calls = readFileSync(process.env.FAKE_CUA_LOG!, 'utf8')
    expect(calls).not.toContain('"name":"install_extension"')

    await driver.setEnabled(false)
    await phase(ctx, 'off')
    await vi.waitFor(() => { expect(names(ctx!)).toEqual([]) })
    await vi.waitFor(() => { expect(ctx!.get('computerUse')!.providerName).toBeUndefined() })
    await vi.waitFor(() => { expect(readFileSync(process.env.FAKE_CUA_LOG!, 'utf8')).toContain('"event":"stop"') })

    // The switch survives a restart: on again, then a fresh boot starts the driver by itself.
    await driver.setEnabled(true)
    await phase(ctx, 'ready')
    await ctx.fiber.dispose()
    ctx = await start()
    await phase(ctx, 'ready')
    expect(names(ctx)).toHaveLength(6)
  } finally {
    await ctx?.fiber.dispose()
  }
}, 60_000)

it('runs reads, waits for approval on a write, and Stop turns the driver off', async () => {
  const { start } = profile()
  let ctx: Booted | undefined
  try {
    ctx = await start()
    for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, AgentRegistry]) await ctx.plugin(plugin)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(ApprovalService)
    await ctx.plugin(ComputerUseGate, {})
    const driver = ctx.get('computerUseDriver')!
    await driver.setEnabled(true)
    await phase(ctx, 'ready')

    const session = Session.create(SessionId('computer-use-gated'))
    session.append('turn/start', { turn: 1 })
    const cancelled: unknown[] = []
    const agent = { session, cancel: (cause: unknown) => { cancelled.push(cause) } } as Partial<Agent> as Agent
    const asked: string[] = []
    ctx.on('approval/request', (request) => {
      asked.push(request.toolName)
      return Promise.resolve('allowed-once' as const)
    })
    const call = (name: string, args: Record<string, JsonValue>, id: string) =>
      ctx!.get('tools')!.execute({ signal, agent, callId: ToolCallId(id), name: `mcp__ahel-computer__${name}`, arguments: args })

    expect((await call('list_windows', {}, 'r1')).isError).toBe(false)
    expect((await call('get_window_state', { pid: 4242, window_id: 77 }, 'r2')).isError).toBe(false)
    expect(asked).toEqual([])
    const click = await call('click', { element_token: 'tok-save-1' }, 'w1')
    expect(click.isError).toBe(false)
    expect(asked).toEqual(['mcp__ahel-computer__click'])
    expect(readFileSync(process.env.FAKE_CUA_LOG!, 'utf8')).toContain('"name":"click"')

    await ctx.get('computerUseGate')!.stop()
    expect(cancelled).toContainEqual({ kind: 'user' })
    await phase(ctx, 'off')
    expect(ctx.get('computerUse')!.enabled).toBe(false)
  } finally {
    await ctx?.fiber.dispose()
  }
}, 60_000)
