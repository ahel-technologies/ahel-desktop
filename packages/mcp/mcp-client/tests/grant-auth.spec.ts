import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { credentialRef } from '@ahel/dsh-credentials'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime from '@ahel/dsh-tools'
import * as McpClient from '../src/index.ts'
import { startHttpMcpFixture } from './http-fixture.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

it('connects while the credential holds a grant and drops its tools on sign-out', async () => {
  const fixture = await startHttpMcpFixture()
  cleanups.push(() => fixture.close())
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-grant-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const plugin = ctx.plugin(McpClient, { transport: 'streamable-http', serverName: 'ahel', url: fixture.url, auth: { credentialRef: 'AHEL_ACCOUNT' } })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
  expect(ctx.tools.get('mcp__ahel__ping')).toBeUndefined()

  const ref = credentialRef('AHEL_ACCOUNT')
  await McpClient.writeOAuthGrant(ctx.credentials, ref, {
    version: 1,
    issuer: 'https://ahel.ai',
    token_endpoint: 'https://ahel.ai/api/auth/mcp/token',
    client_id: 'client-1',
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: Date.now() + 3_600_000,
  })
  await expect.poll(() => ctx.tools.get('mcp__ahel__ping')).toBeDefined()
  expect(fixture.authorization).toContain('Bearer access-1')

  await ctx.credentials.unset(ref)
  await expect.poll(() => ctx.tools.get('mcp__ahel__ping')).toBeUndefined()
})
