import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, type RequestPermissionRequest } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@ahel/dsh-session-snapshot'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * The default ACP composition (`cordis.yml`) end to end.
 *
 * Keyless smoke: boot the real profile patch through `dsh --profile acp` as
 * an ACP subprocess and drive initialize + session/new — the real-Loader-path
 * guard (postmortem 0001) for THIS tree's exports, including the
 * sandbox executor AND the approval service. No prompt is sent, so neither the
 * model nor a sandbox runner is ever exercised.
 */

/** Selects a keyless model route so session creation resolves without a provider key. */
const KEYLESS_ROUTE = fileURLToPath(new URL('./fixtures/keyless-route.cordis.yml', import.meta.url))

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}

interface Spawned extends LaunchedAcpTestAgent {
  permissionRequests: RequestPermissionRequest[]
}

/** Boot the example with an optional sandbox override; the scripted client answers every permission prompt with `answer`. */
function launchExampleAcpAgent(
  cwd: string,
  answer: 'allow-once' | 'reject-once',
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access',
): Spawned {
  const permissionRequests: RequestPermissionRequest[] = []
  const launched = launchAcpTestAgent({
    agent: AGENT,
    cwd,
    configPath: KEYLESS_ROUTE,
    env: { DSH_PERMISSION_MODE: sandboxMode },
    requestPermission(params) {
      permissionRequests.push(params)
      const option = params.options.find(o => o.optionId === answer)
      // The scripted machine policy selects the requested option. If that
      // option is absent, the policy cancels (fail closed, never grant).
      if (option === undefined) return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      return Promise.resolve({ outcome: { outcome: 'selected', optionId: option.optionId } })
    },
  })
  return Object.assign(launched, { permissionRequests })
}

let spawned: Spawned | undefined
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe('default sandbox composition keyless smoke (real cordis.yml via the Loader)', () => {
  it('boots the tree — sandbox executor + approval service + bridge — and opens a session', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'sandbox-acp-smoke-'))
    spawned = launchExampleAcpAgent(workdir, 'reject-once')
    const { client } = spawned
    // No prompt is ever sent, so no model call and no sandbox runner probe
    // happen. This drives the fiber tree the same
    // way an ACP caller would, which catches broken exports or injection.
    const init = await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(init.agentCapabilities).toEqual({
      mcpCapabilities: { http: true },
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      sessionCapabilities: { close: {}, list: {}, resume: {} },
    })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })
    expect(sessionId.length).toBeGreaterThan(0)
  }, 30_000)
})
