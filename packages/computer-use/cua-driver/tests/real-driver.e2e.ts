/**
 * Scripted Host run against the real pinned driver, reads only. Opt in with
 * AHEL_CUA_DRIVER_E2E=<path to cua-driver>; it lists the tools, takes one
 * screenshot (get_desktop_state) and runs one AX find (get_window_state with
 * query), then prints the model text so the appended structuredContent is
 * visible. It never clicks, types or launches anything.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@ahel/dsh-app-boot'
import ConfigEditor from '@ahel/dsh-config-editor'
import Settings from '@ahel/dsh-settings'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime from '@ahel/dsh-tools'
import { ToolCallId } from '@ahel/dsh-llm'
import ComputerUse from '@ahel/dsh-computer-use'
import CuaDriver from '../src/index.ts'
import { STRUCTURED_HEADER } from '../src/structured.ts'

const DRIVER = process.env.AHEL_CUA_DRIVER_E2E
/** Optional file that receives the model text of each call (vitest may silence the console). */
const REPORT = process.env.AHEL_CUA_DRIVER_E2E_REPORT
const report = (line: string): void => {
  if (REPORT === undefined) console.log(line)
  else appendFileSync(REPORT, `${line}\n`)
}

it.skipIf(DRIVER === undefined || process.platform !== 'darwin')('lists the real driver tools and shows structuredContent for a screenshot and a find', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-computer-use-real-')))
  const previous = { DSH_HOME: process.env.DSH_HOME, FAKE_CUA_DRIVER: process.env.FAKE_CUA_DRIVER }
  process.env.DSH_HOME = join(home, 'dsh-home')
  process.env.FAKE_CUA_DRIVER = DRIVER
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  const signal = new AbortController().signal
  const text = (blocks: readonly { type: string; text?: string }[]): string => blocks.map(block => block.type === 'text' ? block.text ?? '' : `[${block.type}]`).join('\n')
  try {
    const dir = join(home, 'profiles', 'desktop')
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), readFileSync(new URL('./fixtures/computer-use.patch.yml', import.meta.url)))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'desktop', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
    }
    ctx = await boot('desktop', join(dir, 'cordis.yml'), readProfilePatches('desktop', profile), (root) => {
      root.provide('profileContext', profile)
      Object.assign(root.loader.builtins, {
        editor: ConfigEditor, settings: Settings, systemPrompt: SystemPrompt, tools: ToolRuntime,
        computerUse: ComputerUse, cuaDriver: CuaDriver,
      })
    })
    const driver = ctx.get('computerUseDriver')!
    // The Settings switch: persist computerUse.enabled = true; no permission prompt is raised when both grants exist.
    await ctx.get('computerUse')!.setEnabled(true)
    await vi.waitFor(() => { expect(driver.current().phase).toBe('ready') }, { timeout: 30_000, interval: 100 })
    const status = driver.current()
    const tools = ctx.get('tools')!
    const names = tools.schemas().map(schema => schema.name).filter(name => name.startsWith('mcp__ahel-computer__'))
    report(`status: ${JSON.stringify(status)}`)
    report(`tools (${String(names.length)}): ${names.join(', ')}`)
    expect(names.length).toBeGreaterThan(40)

    const windows = await tools.execute({ signal, callId: ToolCallId('list'), name: 'mcp__ahel-computer__list_windows', arguments: {} })
    const listed = text(windows.content)
    report(`--- list_windows model text (head) ---\n${listed.slice(0, 600)}`)
    expect(listed).toContain(STRUCTURED_HEADER)
    interface Listed { structuredContent?: { windows?: { pid: number; window_id: number; app_name: string; is_on_screen?: boolean }[] } }
    const value = windows.isError ? undefined : windows.value as Listed
    // Never the driver's own overlay or Ahel Desktop itself; Finder when it has a window.
    const candidates = (value?.structuredContent?.windows ?? []).filter(window => !['cua-driver', 'Ahel Desktop'].includes(window.app_name))
    const target = candidates.find(window => window.app_name === 'Finder') ?? candidates.find(window => window.is_on_screen === true)
    expect(target).toBeDefined()

    const screenshot = await tools.execute({ signal, callId: ToolCallId('shot'), name: 'mcp__ahel-computer__get_desktop_state', arguments: { max_image_dimension: 640 } })
    report(`--- get_desktop_state (screenshot) isError=${String(screenshot.isError)} model text ---\n${text(screenshot.content).slice(0, 1500)}`)

    const find = await tools.execute({ signal, callId: ToolCallId('find'), name: 'mcp__ahel-computer__get_window_state',
      arguments: { pid: target!.pid, window_id: target!.window_id, query: 'button', include_screenshot: false, max_elements: 200 } })
    const found = text(find.content)
    report(`--- get_window_state find in ${target!.app_name} isError=${String(find.isError)} model text (head) ---\n${found.slice(0, 2500)}`)
    if (!find.isError) {
      expect(found).toContain(STRUCTURED_HEADER)
      expect(found).toContain('element_token')
      const at = found.indexOf('"element_token"')
      report(`--- first element in the appended structuredContent ---\n${found.slice(Math.max(0, found.lastIndexOf('{', at)), at + 120)}`)
    }
  } finally {
    await ctx?.fiber.dispose()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    rmSync(home, { recursive: true, force: true })
  }
}, 120_000)
