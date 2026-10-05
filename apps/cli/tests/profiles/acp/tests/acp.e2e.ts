import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * Keyless end-to-end: boot the shipped ACP profile as a real subprocess
 * speaking ACP over its stdio and drive it with a real ACP SDK client app.
 * Asserts stdout purity (only framed JSON-RPC on stdout) and session creation;
 * no prompt is sent, so no model is called. Owns and disposes the subprocess in
 * afterEach.
 */

/** Selects a keyless model route so session creation resolves without a provider key. */
const KEYLESS_ROUTE = fileURLToPath(new URL('./fixtures/keyless-route.cordis.yml', import.meta.url))

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}
const DANGER_FULL_ACCESS_ENV = { DSH_PERMISSION_MODE: 'danger-full-access' }

let spawned: LaunchedAcpTestAgent | undefined
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe('acp-agent over real stdio (no key required)', () => {
  it('emits only framed JSON-RPC on stdout', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    // Inspect the launcher's raw-byte tee in addition to driving its SDK client.
    spawned = launchAcpTestAgent({ agent: AGENT, cwd: workdir, configPath: KEYLESS_ROUTE, env: DANGER_FULL_ACCESS_ENV })
    await spawned.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    const lines = spawned.rawStdout().split('\n').filter(line => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Every stdout line MUST parse as JSON (a JSON-RPC frame). A non-JSON
      // line means a logger/print leaked onto the protocol channel.
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
  }, 30_000)

  it('session/new succeeds over real stdio (no model call)', async () => {
    // REGRESSION GUARD (this exact RPC exposed the missing-inject Loader bug):
    // `session/new` drives the
    // full bridge → `ctx.agents.create({sessionId, meta:{cwd}})` → AgentLoop →
    // registry/persistence path, ALL of which run from the JSON-RPC read loop
    // OUTSIDE the bridge plugin's injection scope. A lazy `ctx.<service>` read
    // on that path throws and the RPC fails with an Internal error — yet the
    // call never touches the model, so this reproduces WITHOUT a key. The
    // initialize-only purity test never caught it (initialize does not reach
    // the factory). This closes that gap: boot the real subprocess and create a
    // session, asserting the RPC RESOLVES (not rejects with an inject error).
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    spawned = launchAcpTestAgent({ agent: AGENT, cwd: workdir, configPath: KEYLESS_ROUTE, env: DANGER_FULL_ACCESS_ENV })
    const { client } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)
  }, 60_000)
})
