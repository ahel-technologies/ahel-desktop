import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  initProfile,
  createRuntimeResolution,
  loadOverlayPatches,
  PluginPackages,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { beforeAll, describe, expect, it } from 'vitest'
import { bundlePatchPaths } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-compaction-basic'
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: resolves `ctx.get('sessionProjections')` and `ctx.get('tokenMeter')`.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-token-meter'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const { boot } = createRequire(import.meta.url)(join(REPO_ROOT, 'packages/boot/app-boot/lib/index.js')) as typeof import('@deepseek-ai/dsh-app-boot')
/** The shipped Web surface: the dsh-base and dsh-web-app bundle patches over an empty profile. */
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_BUNDLE = join(REPO_ROOT, 'packages/bundle/web-app')
const WEB_PATCHES = bundlePatchPaths(WEB_BUNDLE, (JSON.parse(readFileSync(join(WEB_BUNDLE, 'package.json'), 'utf8')) as { dsh: { bundle: { patch: string[] } } }).dsh.bundle)
const webPatches = (label: string): PatchOptions[] => WEB_PATCHES.flatMap(file => loadOverlayPatches(label, file))
/** The installation anchor whose dependency surface the runtime resolution mirrors. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/**
 * Boot the shipped Web composition, minus the rows that would bind a port,
 * touch the network, or write outside the test. Everything that decides an
 * agent's capabilities is the real thing, including the shipped preset.
 */
async function bootWeb(profileHome: string): Promise<Context> {
  const storageRoot = join(profileHome, 'storages')
  const overrides: PatchOptions[] = [
    // storage-json's root is anchored to the real $DSH_HOME. Unpinned, this
    // file writes the developer's own `~/.dsh/storages/` — and then reads it
    // back on the next run, so a stored document from any other build decides
    // this test's boot.
    { id: 'storage-json', config: { root: storageRoot } },
    // Fixed Session IDs must stay inside this boot's temporary profile root.
    { id: 'session-persistence-jsonl', config: { root: join(profileHome, 'sessions') } },
    // Host rows with side effects outside this process: a bound port, a served
    // asset tree, a telemetry exporter. `api-gateway` and `directory-picker`
    // stay ENABLED on purpose — the api-proxy is the host row that injects
    // `subagents`, `workspace`, and the rest of the agent plane, so disabling
    // it would hide exactly the breakage this file exists to catch: a service
    // moved into the presets that a host row still waits for. The boot audit
    // is that assertion.
    { id: 'webserver', disabled: true },
    // This composition has no application readiness or file-watching lifecycle.
    { id: 'hmr', disabled: true },
    // The web bundle's runtime row injects `webServer`, so it cannot
    // activate without the bound port disabled above. It owns dist serving
    // and the URL prompt line — surface glue, not anything that decides an
    // agent's capabilities, which is all this file asserts.
    { id: 'web-runtime', disabled: true },
    { id: 'modules', disabled: true },
    // The physical Connection row owns the disabled HTTP server. bootWeb
    // supplies only its in-process registries so Host services still prove
    // their shipped dependency graph without binding a port.
    { id: 'connection', disabled: true },
    // Export owns a Connection Fetch route, so this Host-only composition
    // disables it with the transport service above.
    { id: 'session-log-download', disabled: true },
    // The open-in-app host routes wait for the webserver and connection
    // rows disabled above (connection's trust fence guards every route).
    { id: 'open-in-app', disabled: true },
    // The always-on reload chain waits for the browser roster and bound port
    // disabled above.
    { id: 'client-hmr', disabled: true },
    // The shipped `-auto` chooser resolves its interaction from a running
    // host and so waits for the webserver disabled above; the browse variant
    // supplies `directoryPicker` without one.
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    { id: 'agent-preset-registry', config: { default: 'standard' } },
  ]
  const home = profileHome
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  const profile: Profile = { skippedBundles: [],
    name: 'spec',
    dir: profileDir,
    layers: [],
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
  }
  const bundlePatches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...webPatches('dsh-test'),
  ]
  // Deployment defaults live in a bundle beneath the profile patch, so Settings writes are not shadowed by overlays.
  const fixtureName = 'dsh-web-presets-defaults'
  const fixtureDir = join(profileDir, 'node_modules', fixtureName)
  await mkdir(fixtureDir, { recursive: true })
  await writeFile(join(fixtureDir, 'package.json'), JSON.stringify({ name: fixtureName, version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(fixtureDir, 'cordis.patch.yml'), JSON.stringify(overrides))
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  manifest.dsh.profile.bundles.push(fixtureName)
  await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest))
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, home, profile })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, [...bundlePatches, ...overrides], async (bootCtx) => {
    bootCtx.provide('profileContext', { name: 'spec', dir: profileDir, patchPath: profile.patchPath,
      installAnchor: INSTALL_ANCHOR, home, cwd: home,
      startedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      overlays: [], telemetryDisabledEnv: '1' })
    await bootCtx.plugin(PluginPackages, { resolution })
    bootCtx.provide('connection', {
      fetch: { register: () => () => {} },
      rpc: { intercept: () => () => {} },
    } as never)
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

let ctx: Context
beforeAll(async () => {
  ctx = await bootWeb(await mkdtemp(join(tmpdir(), 'dsh-web-presets-')))
}, 120_000)

describe('the shipped Web composition', () => {
  it('leaves the global tool layer empty', () => {
    // Every model-facing tool belongs to a preset, `ask_user_question`
    // included: a tool in the global layer reaches EVERY agent regardless of
    // which preset composed it, expanding that preset's tool list.
    expect(toolNames(ctx)).toEqual([])
  })

  it('keeps the token meter and its context-meter projections on the host plane', async () => {
    // A preset-side meter sits behind an `isolate` realm and is invisible to
    // `ctx.get`; host ownership is what makes the meter a per-session fact.
    expect(ctx.get('tokenMeter')).toBeDefined()
    const projections = ctx.get('sessionProjections')
    if (projections === undefined) throw new Error('the Web composition must compose a projection registry')
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-standard-meter'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // A subset assertion: other projections register into the same
      // process-wide table, and this is about the meter's three units.
      expect(Object.keys(projections.snapshot(handle.agent.session).values))
        .toEqual(expect.arrayContaining(['contextBreakdown', 'contextPressure', 'tokenUsage']))
    } finally {
      await handle.dispose()
    }
  })

  it('supplies only the shipped `standard` preset from the system root', async () => {
    const listed = await ctx.agentPresets.list()

    expect(listed.map(preset => preset.id)).toEqual(['standard'])
    expect(listed.every(preset => !('path' in preset))).toBe(true)
    expect(ctx.agentPresets.defaultId).toBe('standard')
  })

  it('composes the chat agent from `standard`', async () => {
    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-standard'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      // The EXACT catalog: chat plus MCP carries no local agent tools, and MCP
      // tools register through host rows only once a server is configured.
      expect(toolNames(ctx, handle.agent)).toEqual(['ask_user_question'])
      expect(ctx.commands.find(handle.agent, 'compact')).toBeDefined()
    } finally {
      await handle.dispose()
    }
  })

  it('never rewrites the shipped profile patch when an Agent is disposed', async () => {
    // The Loader persists a tree whose plugin self-disposed, and tearing an
    // agent down disposes its whole subtree. Inherited, that rewrote the
    // shipped composition — truncating it to `[]` the first time a session
    // ended — so `PresetTree` refuses to write at all.
    const before = await Promise.all(WEB_PATCHES.map(file => readFile(file, 'utf8')))

    const handle = await ctx.agents.create({
      sessionId: SessionId('preset-readonly'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    await handle.dispose()
    // Slack, not a race the number has to win. The write is driven by the
    // Loader's fiber-unload listener, which fires as the subtree's fibers
    // settle rather than when `dispose()` resolves, and the Loader exposes no
    // flush to await. A regression writes synchronously inside that listener,
    // so any wait past settlement fails; a longer one only slows the test.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(await Promise.all(WEB_PATCHES.map(file => readFile(file, 'utf8')))).toEqual(before)
  })
})
