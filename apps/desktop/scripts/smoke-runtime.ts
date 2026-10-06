/** Boot the materialized target runtime without access to a user's Harness profile. */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')
/** Built replay model plugin; `build:official` emits it before packaging reaches this smoke. */
const REPLAY_PLUGIN = join(REPOSITORY_ROOT, 'packages', 'test-support', 'llm-replay', 'lib', 'index.js')
/** Recorded one-turn session the replay model answers from; its provider and model match the route below. */
const REPLAY_SESSION = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'desktop-turn-smoke.session.v4.jsonl')
const REPLAY_ANSWER = 'desktop turn ok'

/**
 * Check Host startup, its matching frontend, an external plugin route, and one keyless chat turn.
 * The turn runs on a replay model so it needs no key, but it opens and persists a real Session,
 * which loads the native session lock addon: a runtime missing it fails here, not on a user's first message.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Electron executable.
 * @param runtime - Verified resource descriptor.
 * @param environment - Credential-scrubbed build environment and private native cache.
 * @param resourcesRuntime - Bundled interpreters outside the application archive.
 * @returns Resolves after checks and teardown; rejects on a check or teardown failure.
 */
export async function smokeDesktopRuntime(
  root: string, node: string, runtime: DesktopRuntimeDescriptor, environment: NodeJS.ProcessEnv, resourcesRuntime: string,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  const host = new DesktopHostProcess(node, root, profile, undefined, { ...environment, DSH_HOME: home },
    undefined, { pnpm: join(resourcesRuntime, 'pnpm', 'bin', 'pnpm.cjs'), nodeBin: join(resourcesRuntime, 'bin') })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    createPluginProfile(profile)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@ahel/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@ahel/cordis': cordis.version }, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { randomUUID } from 'node:crypto'
import { Context } from '@ahel/cordis'
async function runTurn(ctx, cwd) {
  const sessions = ctx.sessionController
  const { sessionId } = await sessions.create({ cwd })
  await sessions.selectModel({ sessionId, provider: 'desktop-smoke', model: 'replay' })
  const found = await sessions.resolveAgent(sessionId)
  if ('error' in found) throw found.error
  const session = found.agent.session
  await sessions.prompt({ requestId: randomUUID(), sessionId, mode: 'queue',
    content: [{ type: 'text', text: 'Desktop smoke: answer in one line.' }] }, AbortSignal.timeout(60_000))
  const deadline = Date.now() + 60_000
  for (;;) {
    const events = session.snapshotEvents()
    const end = events.find(event => event.type === 'turn/end')
    if (end !== undefined) {
      const text = events.filter(event => event.type === 'assistant/message')
        .flatMap(event => event.data.message.content).filter(block => block.type === 'text').map(block => block.text).join('')
      await ctx.sessions.flush(session)
      const addons = process.report.getReport().sharedObjects.filter(path => path.endsWith('.node'))
      return { reason: end.data.reason, text, addons }
    }
    if (Date.now() > deadline) throw new Error('turn did not end within 60 seconds')
    await new Promise(done => setTimeout(done, 100))
  }
}
// Dictation wiring: the ahel.ai provider is the only recognizer (no local engine), recordings are capped at
// 60 s, and a WAV reaches the provider through the real speech controller (signed out, it asks to sign in).
async function dictation(ctx) {
  const speech = ctx.get('speechController')
  if (speech === undefined) throw new Error('speechController is not mounted')
  const catalog = speech.catalog()
  const samples = 8000, wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
  let refusal = null
  try { await speech.transcribe({ audioBase64: wav.toString('base64') }, AbortSignal.timeout(30_000)) }
  catch (error) { refusal = String(error?.message ?? error) }
  return { providers: catalog.providers.map(p => [p.id, p.location, p.preparation.phase].join(':')),
    selected: catalog.selection.providerId, maxDurationSeconds: catalog.maxDurationSeconds, refusal }
}
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke',
    handler(_request, response) { response.end('plugin route ready') } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-turn',
    handler(_request, response) {
      runTurn(ctx, ${JSON.stringify(workspace)}).then(
        result => response.end(JSON.stringify(result)),
        error => response.end(JSON.stringify({ error: String(error?.stack ?? error) })))
    } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-dictation',
    handler(_request, response) {
      dictation(ctx).then(
        result => response.end(JSON.stringify(result)),
        error => response.end(JSON.stringify({ error: String(error?.stack ?? error) })))
    } }))
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n      inject: [webServer, sessionController, sessions]\n')
    const replayName = 'desktop-runtime-smoke-replay'
    const replay = join(profile, 'node_modules', replayName)
    mkdirSync(replay, { recursive: true })
    copyFileSync(REPLAY_PLUGIN, join(replay, 'index.js'))
    const shared = (name: string): string => {
      const entry = runtime.sharedPackages.find(candidate => candidate.name === name)
      if (entry === undefined) throw new Error(`desktop runtime: missing shared package ${name}`)
      return entry.version
    }
    writeFileSync(join(replay, 'package.json'), JSON.stringify({
      name: replayName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: Object.fromEntries(['@ahel/cordis', '@ahel/dsh-llm', '@ahel/dsh-session',
        '@ahel/dsh-session-format-catalog', '@ahel/dsh-util-values'].map(name => [name, shared(name)])),
      dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(replay, 'bundle.yml'), `- insert:\n    - id: ${replayName}\n      name: ${replayName}\n      config: ${JSON.stringify({
      file: REPLAY_SESSION,
      providers: [{ id: 'desktop-smoke', name: 'Desktop smoke', models: [{ id: 'replay', inputModalities: ['text'] }] }],
    })}\n`)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dependencies[replayName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName, replayName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    // A first-prompt title model call would consume the replay's only recorded answer.
    writeFileSync(join(profile, 'cordis.patch.yml'),
      '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: session-title-llm\n  disabled: true\n')
    const ready = await Promise.race([host.start(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('desktop runtime: Host readiness exceeded 120 seconds')) }, 120_000)
    })])
    clearTimeout(timer)
    const login = await fetch(ready.url, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    const pluginResponse = await fetch(new URL('/desktop-smoke', ready.url), { headers: { cookie } })
    if (await pluginResponse.text() !== 'plugin route ready') throw new Error('desktop runtime: plugin HTTP route failed')
    const turn = await fetch(new URL('/desktop-smoke-turn', ready.url), { headers: { cookie } })
    const outcome = await turn.json() as { reason?: { kind: string }; text?: string; addons?: string[]; error?: string }
    if (outcome.error !== undefined || outcome.reason?.kind !== 'completed' || outcome.text !== REPLAY_ANSWER) {
      throw new Error(`desktop runtime: chat turn smoke failed: ${JSON.stringify(outcome)}`)
    }
    const dictation = await (await fetch(new URL('/desktop-smoke-dictation', ready.url), { headers: { cookie } })).json() as {
      providers?: string[]
      selected?: string
      maxDurationSeconds?: number
      refusal?: string | null
      error?: string
    }
    if (dictation.error !== undefined || JSON.stringify(dictation.providers) !== JSON.stringify(['ahel-cloud:cloud:failed'])
      || dictation.selected !== 'ahel-cloud' || dictation.maxDurationSeconds !== 60
      || dictation.refusal?.includes('Sign in to Ahel') !== true) {
      throw new Error(`desktop runtime: dictation smoke failed: ${JSON.stringify(dictation)}`)
    }
    // The Session lock's flock addon must come from this runtime: a build tree inside the
    // repository can otherwise resolve the workspace's copy and hide a missing platform package.
    if (runtime.platform !== 'win32') {
      const roots = [resolve(root), resolve(root).replace(/app\.asar(?=[\\/]|$)/u, 'app.asar.unpacked')]
      const flock = outcome.addons?.find(path => /[\\/]bin[\\/]system\.node$/u.test(path))
      if (flock === undefined || !roots.some(prefix => flock.startsWith(prefix))) {
        throw new Error(`desktop runtime: session lock addon was not loaded from the packaged runtime: ${String(flock)}`)
      }
    }
    console.log('desktop runtime: Host, frontend, external plugin route, one chat turn and dictation wiring passed')
  } finally {
    clearTimeout(timer)
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
