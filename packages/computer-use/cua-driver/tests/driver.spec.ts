/** Embedded daemon spawn and the MCP stdio handshake, against a fake driver executable. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { driverEnvironment, resolveDriverCommand, startDaemon } from '../src/driver.ts'
import { probeTool } from '../src/probe.ts'
import { systemSettingsUrl, readMacPermissions } from '../src/permissions.ts'
import { withStructuredContent, STRUCTURED_HEADER } from '../src/structured.ts'
import { PINNED_DRIVER_VERSION } from '../src/release.ts'

const FAKE = fileURLToPath(new URL('./fixtures/fake-cua-driver.mjs', import.meta.url))
const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), 'cua-driver-test-'))
  folders.push(folder)
  return folder
}

interface LogEvent { event: string; command: string; env?: Record<string, string | null>; name?: string; arguments?: unknown }

function events(log: string): LogEvent[] {
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as never) : []
}

describe('driver location', () => {
  it('prefers the profile command, then AHEL_CUA_DRIVER_PATH, then the packaged copy', () => {
    const base = { env: {}, platform: 'darwin' as const, execPath: '/Apps/Ahel Desktop.app/Contents/MacOS/Ahel Desktop', resourcesPath: undefined }
    expect(resolveDriverCommand({ ...base, configured: '/opt/cua-driver' })).toEqual({ path: '/opt/cua-driver', source: 'configured' })
    expect(resolveDriverCommand({ ...base, configured: '', env: { AHEL_CUA_DRIVER_PATH: '/x/cua' } })).toEqual({ path: '/x/cua', source: 'configured' })
    expect(resolveDriverCommand({ ...base, configured: '' })).toBeUndefined()
    const resources = scratch()
    expect(resolveDriverCommand({ ...base, configured: '', resourcesPath: resources })).toBeUndefined()
    const bundled = join(resources, 'cua-driver', 'cua-driver')
    mkdirSync(dirname(bundled))
    writeFileSync(bundled, '')
    expect(resolveDriverCommand({ ...base, configured: '', resourcesPath: resources })).toEqual({ path: bundled, source: 'bundled' })
    expect(resolveDriverCommand({ ...base, configured: '', platform: 'win32', resourcesPath: resources })).toBeUndefined()
  })

  it('runs embedded, private and silent', () => {
    const env = driverEnvironment({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', CUA_DRIVER_EMBEDDED: '0' }, '/home/cua', 'ai.ahel.desktop', { CUA_DRIVER_KEY_GAP_MS: '4' })
    expect(env).toMatchObject({
      PATH: '/bin', CUA_DRIVER_EMBEDDED: '1', CUA_DRIVER_HOST_BUNDLE_ID: 'ai.ahel.desktop', CUA_DRIVER_RS_HOME: '/home/cua',
      DO_NOT_TRACK: '1', CUA_TELEMETRY: '0', CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false', CUA_DRIVER_RS_UPDATE_CHECK: 'false', CUA_DRIVER_KEY_GAP_MS: '4',
    })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('pins the release the packaging script downloads', () => {
    const release = JSON.parse(readFileSync(new URL('../cua-driver.release.json', import.meta.url), 'utf8')) as { version: string; assets: Record<string, { archiveSha256: string; binarySha256: string }> }
    expect(release.version).toBe(PINNED_DRIVER_VERSION)
    for (const asset of Object.values(release.assets)) {
      expect(asset.archiveSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(asset.binarySha256).toMatch(/^[0-9a-f]{64}$/u)
    }
  })
})

describe('embedded daemon and MCP handshake', () => {
  it('starts serve --embedded on a private socket, answers check_permissions over mcp, and stops cleanly', async () => {
    const log = join(scratch(), 'driver.ndjson')
    const env = driverEnvironment({ ...process.env, FAKE_CUA_LOG: log }, scratch(), 'ai.ahel.desktop')
    const daemon = await startDaemon({ command: FAKE, env, timeoutMs: 10_000 })
    try {
      expect(existsSync(daemon.socket)).toBe(true)
      const result = await probeTool({ command: FAKE, args: ['mcp', '--embedded', '--socket', daemon.socket], env, timeoutMs: 10_000 },
        'check_permissions', { prompt: false })
      expect(result.structuredContent).toMatchObject({ accessibility: true, screen_recording: false, source: { attribution: 'host', host_bundle_id: 'ai.ahel.desktop' } })
    } finally {
      await daemon.stop()
    }
    expect(existsSync(dirname(daemon.socket))).toBe(false)
    const seen = events(log)
    const serve = seen.find(entry => entry.event === 'start' && entry.command === 'serve')
    expect(serve?.env).toMatchObject({ CUA_DRIVER_EMBEDDED: '1', DO_NOT_TRACK: '1', CUA_DRIVER_RS_UPDATE_CHECK: 'false', ELECTRON_RUN_AS_NODE: null })
    expect(seen.some(entry => entry.event === 'call' && entry.name === 'check_permissions')).toBe(true)
    expect(seen.some(entry => entry.event === 'stop')).toBe(true)
  })

  it('reports a daemon that exits before its socket opens', async () => {
    const env = driverEnvironment({ ...process.env, FAKE_CUA_MODE: 'fail-serve' }, scratch(), 'ai.ahel.desktop')
    await expect(startDaemon({ command: FAKE, env, timeoutMs: 10_000 })).rejects.toThrow('fake daemon refused to start')
  })

  it('reports a missing executable', async () => {
    await expect(startDaemon({ command: join(scratch(), 'missing'), env: {}, timeoutMs: 2000 })).rejects.toThrow('computer use: the driver')
  })
})

describe('macOS permissions', () => {
  it('reads both grants without a prompt and links each pane', async () => {
    const scripts: string[] = []
    const run = async (script: string): Promise<string> => { scripts.push(script); return '{"accessibility":true,"screenRecording":false}\n' }
    await expect(readMacPermissions(run)).resolves.toEqual({ accessibility: true, screenRecording: false })
    expect(scripts[0]).not.toContain('Request')
    expect(scripts[0]).not.toContain('AXTrustedCheckOptionPrompt')
    expect(systemSettingsUrl('accessibility')).toContain('Privacy_Accessibility')
    expect(systemSettingsUrl('screen-recording')).toContain('Privacy_ScreenCapture')
  })
})

describe('structuredContent in the model text', () => {
  it('appends element tokens and drops the duplicated markdown and base64', () => {
    const value = { content: [{ type: 'text', text: '- [element_index 0] AXButton "Save"' }], structuredContent: {
      elements: [{ element_index: 0, element_token: 'tok-1' }], tree_markdown: '- [element_index 0] AXButton "Save"', png: 'A'.repeat(2000),
    } }
    const content = withStructuredContent(value, [{ type: 'text', text: '- [element_index 0] AXButton "Save"' }], 10_000)
    expect(content).toHaveLength(2)
    const appended = content?.[1]
    expect(appended?.type === 'text' ? appended.text : '').toContain(STRUCTURED_HEADER)
    expect(appended?.type === 'text' ? appended.text : '').toContain('"element_token":"tok-1"')
    expect(appended?.type === 'text' ? appended.text : '').not.toContain('tree_markdown')
    expect(appended?.type === 'text' ? appended.text : '').toContain('base64 characters omitted')
  })

  it('cuts long JSON and ignores results without an object', () => {
    const content = withStructuredContent({ content: [], structuredContent: { big: 'x '.repeat(1000) } }, [], 300)
    expect(content?.[0]?.type === 'text' ? content[0].text : '').toContain('[cut at 300 of')
    expect(withStructuredContent({ content: [] }, [], 300)).toBeUndefined()
    expect(withStructuredContent({ content: [], structuredContent: [1] }, [], 300)).toBeUndefined()
    expect(withStructuredContent('text', [], 300)).toBeUndefined()
  })
})
