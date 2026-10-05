/**
 * The shipped shell composition: the agent-tools bundle gates both shell
 * stacks by platform on its own rows (`disabled: !!js process.platform`), so
 * exactly one shell stack mounts per host and no separate platform layer
 * exists — the launcher applies nothing beyond the bundle layers. The chat-core
 * web profile (dsh-base + dsh-web-app) and its only agent preset mount no shell
 * stack at all. The spec composes the REAL shipped bundle layers resolved from
 * the app installation anchor through the boot's patch algorithm and pins the
 * effective per-platform roster and the cold-start resolution closure for the
 * pwsh rows' bare plugin names.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { bundlePatchPaths, composeEntries, initProfile, loadProfile, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'

/**
 * The effective disabled state of one row on one platform: a `!!js` expression
 * evaluates with a platform-scoped `process` so both outcomes pin on any host.
 */
function disabledOn(row: { disabled?: unknown }, platform: 'win32' | 'linux'): boolean {
  const value = row.disabled
  if (value !== null && typeof value === 'object' && '__jsExpr' in value) {
    return Boolean(evaluate({ process: { platform } }, (value as { __jsExpr: string }).__jsExpr))
  }
  return value === true
}

const SHELL_ROWS = ['bash-sandbox', 'pwsh-sandbox', 'tool-bash', 'tool-pwsh'] as const

describe('the shipped shell composition (real bundle layers)', () => {
  let home: string
  afterEach(() => { if (home !== undefined) rmSync(home, { recursive: true, force: true }) })
  // The app installation anchor, mirroring profile-boot.ts: the bundle layers
  // resolve from the REAL bundle packages through it, so this suite composes
  // the shipped patch files, not test fixtures.
  const anchor = fileURLToPath(new URL('../package.json', import.meta.url))

  function compose(profileName: string, bundles: string[]) {
    home = mkdtempSync(join(tmpdir(), 'dsh-windows-home-'))
    initProfile(join(home, PROFILES_DIR, profileName), bundles)
    const profile = loadProfile('dsh', profileName, anchor, home)
    const warnings: string[] = []
    const rows = composeEntries(
      profile.layers.map(layer => layer.patches),
      message => warnings.push(message),
    )
    return { byId: new Map(rows.map(row => [row.id, row])), warnings }
  }

  it('composes the confined pwsh roster on win32 and the bash roster on POSIX from the same agent-tools rows', () => {
    const { byId, warnings } = compose('agent', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-agent-tools'])
    // One shared patch set, two rosters: the shell stacks gate themselves.
    for (const id of SHELL_ROWS) expect(byId.has(id), `row ${id}`).toBe(true)
    for (const [id, win32] of [['bash-sandbox', true], ['tool-bash', true], ['pwsh-sandbox', false], ['tool-pwsh', false]] as const) {
      expect(disabledOn(byId.get(id)!, 'win32'), `${id} on win32`).toBe(win32)
      expect(disabledOn(byId.get(id)!, 'linux'), `${id} on linux`).toBe(!win32)
    }
    // The permission surface never moves: the sandbox/policy rows, the
    // permission service, fs-sandbox, and the approval service stay enabled
    // exactly as on POSIX — the confined pwsh executor is what changes.
    for (const id of ['permission', 'sandbox', 'sandbox-policy', 'fs-sandbox', 'approval']) {
      expect(byId.get(id)?.disabled, `row ${id}`).not.toBe(true)
    }
    // The launcher's cold-start module fallback BFS-links the dependency
    // closure of the resolved bundles into the profile's node_modules, so the
    // agent-tools bundle must declare every bare plugin name its shell rows use.
    const bundleManifest = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../../packages/bundle/agent-tools/package.json', import.meta.url)), 'utf8',
    )) as { dependencies?: Record<string, string> }
    for (const name of ['@deepseek-ai/dsh-pwsh-sandbox', '@deepseek-ai/dsh-tool-pwsh']) {
      expect(bundleManifest.dependencies?.[name], `cold-start closure must reach ${name}`).toBeDefined()
    }
    expect(warnings).toEqual([])
  })

  it('the chat-core web profile mounts no shell stack', () => {
    const { byId, warnings } = compose('web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    for (const id of SHELL_ROWS) expect(byId.has(id), `row ${id}`).toBe(false)
    expect(warnings).toEqual([])
  })
})

describe('the shipped web agent presets', () => {
  const webBundle = fileURLToPath(new URL('../../../packages/bundle/web-app/', import.meta.url))
  const webManifest = JSON.parse(readFileSync(join(webBundle, 'package.json'), 'utf8')) as { dsh: { bundle: { patch: string[] } } }
  const presetRows = composeEntries([bundlePatchPaths(webBundle, webManifest.dsh.bundle).flatMap(file =>
    yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema }) as import('@deepseek-ai/cordis-plugin-include').PatchOptions[])])

  const definitions = presetRows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset').map(row => row.config as import('@deepseek-ai/dsh-agent-preset-registry').PresetDefinition)

  it('ship only the standard preset, which mounts no shell tool or persistent shell row', () => {
    expect(definitions.map(definition => definition.id)).toEqual(['standard'])
    const entries: unknown = definitions[0]!.plugins
    if (!Array.isArray(entries)) throw new TypeError('preset standard must parse to an entry array')
    const ids = entries.map(entry => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).id : undefined))
    for (const id of ['tool-bash', 'tool-pwsh', 'persistent-shell']) {
      expect(ids, `${id} must be absent from standard`).not.toContain(id)
    }
  })
})
