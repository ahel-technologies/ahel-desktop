/** Per-call workspace of a grant-authenticated server: each call carries its chat's workspace in place of the grant's. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { credentialRef } from '@ahel/dsh-credentials'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import { ToolCallId } from '@ahel/dsh-llm'
import SystemPrompt from '@ahel/dsh-system-prompt'
import ToolRuntime from '@ahel/dsh-tools'
import * as McpClient from '../src/index.ts'
import { startHttpMcpFixture } from './http-fixture.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

it('sends each call with the workspace its chat names, and the grant\'s selected workspace otherwise', async () => {
  const fixture = await startHttpMcpFixture()
  cleanups.push(() => fixture.close())
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-workspace-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  // The chat started in workspace A; the person has since selected workspace B.
  const chats = new Map([['chat-a', 'ws-a'], ['chat-b', 'ws-b']])
  ctx.on('mcp-client/workspace', (serverName, agent) => serverName === 'ahel' ? chats.get(agent.session.header.id) : undefined)
  const plugin = ctx.plugin(McpClient, {
    transport: 'streamable-http', serverName: 'ahel', url: fixture.url, auth: { credentialRef: 'AHEL_ACCOUNT', workspaceParam: 'workspace' },
  })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
  await McpClient.writeOAuthGrant(ctx.credentials, credentialRef('AHEL_ACCOUNT'), {
    version: 1, issuer: 'https://ahel.ai', token_endpoint: 'https://ahel.ai/api/auth/mcp/token', client_id: 'client-1',
    access_token: 'access-1', refresh_token: 'refresh-1', expires_at: Date.now() + 3_600_000, workspace: 'ws-b',
  })
  await expect.poll(() => ctx.tools.get('mcp__ahel__ping')).toBeDefined()

  const ping = async (chat: string | undefined): Promise<void> => {
    const agent = chat === undefined ? undefined : { session: { header: { id: chat } } }
    const result = await ctx.tools.execute({
      name: 'mcp__ahel__ping', arguments: {}, callId: ToolCallId(`ping-${chat ?? 'none'}`), signal: new AbortController().signal,
      ...agent === undefined ? {} : { agent: agent as never },
    })
    expect(result.isError).toBe(false)
  }
  await ping('chat-a')
  await ping('chat-b')
  await ping(undefined)
  expect(fixture.pingUrls.map(url => new URL(url, fixture.url).searchParams.get('workspace'))).toEqual(['ws-a', 'ws-b', 'ws-b'])
})
