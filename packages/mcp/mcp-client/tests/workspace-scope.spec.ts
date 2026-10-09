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

it('#44: a run chat bound to Tom keeps pressing its confirm in Tom after the selection moves to Markus', async () => {
  const fixture = await startHttpMcpFixture()
  cleanups.push(() => fixture.close())
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-workspace-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  // The claimed run's chat was pinned to the issue's workspace.
  ctx.on('mcp-client/workspace', (_serverName, agent) => agent.session.header.id === 'run-chat' ? 'ws-tom' : undefined)
  const plugin = ctx.plugin(McpClient, {
    transport: 'streamable-http', serverName: 'ahel', url: fixture.url, auth: { credentialRef: 'AHEL_ACCOUNT', workspaceParam: 'workspace' },
  })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
  const grant = {
    version: 1 as const, issuer: 'https://ahel.ai', token_endpoint: 'https://ahel.ai/api/auth/mcp/token', client_id: 'client-1',
    access_token: 'access-1', refresh_token: 'refresh-1', expires_at: Date.now() + 3_600_000,
  }
  const ref = credentialRef('AHEL_ACCOUNT')
  await McpClient.writeOAuthGrant(ctx.credentials, ref, { ...grant, workspace: 'ws-tom' })
  await expect.poll(() => ctx.tools.get('mcp__ahel__ping')).toBeDefined()
  const workspaces = (): (string | null)[] => fixture.pingUrls.map(url => new URL(url, fixture.url).searchParams.get('workspace'))
  let n = 0
  const ping = async (agent?: object): Promise<void> => {
    const result = await ctx.tools.execute({
      name: 'mcp__ahel__ping', arguments: {}, callId: ToolCallId(`ping-${String(++n)}`), signal: new AbortController().signal,
      ...agent === undefined ? {} : { agent: agent as never },
    })
    expect(result.isError).toBe(false)
  }

  // The person selects Markus: unbound calls follow the grant's workspace.
  await McpClient.writeOAuthGrant(ctx.credentials, ref, { ...grant, workspace: 'ws-markus' })
  await expect.poll(async () => {
    if (ctx.tools.get('mcp__ahel__ping') === undefined) return null
    await ping()
    return workspaces().at(-1)
  }).toBe('ws-markus')

  // The confirm press on the run chat's card still lands in Tom.
  await ping({ session: { header: { id: 'run-chat' } } })
  expect(workspaces().at(-1)).toBe('ws-tom')
})

it('#49: a selection switch keeps the connection, so a call in flight completes and the chat keeps its workspace', async () => {
  const fixture = await startHttpMcpFixture()
  cleanups.push(() => fixture.close())
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-workspace-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  ctx.on('mcp-client/workspace', (_serverName, agent) => agent.session.header.id === 'chat-a' ? 'ws-a' : undefined)
  const plugin = ctx.plugin(McpClient, {
    transport: 'streamable-http', serverName: 'ahel', url: fixture.url, auth: { credentialRef: 'AHEL_ACCOUNT', workspaceParam: 'workspace' },
  })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
  const grant = {
    version: 1 as const, issuer: 'https://ahel.ai', token_endpoint: 'https://ahel.ai/api/auth/mcp/token', client_id: 'client-1',
    access_token: 'access-1', refresh_token: 'refresh-1', expires_at: Date.now() + 3_600_000,
  }
  const ref = credentialRef('AHEL_ACCOUNT')
  await McpClient.writeOAuthGrant(ctx.credentials, ref, { ...grant, workspace: 'ws-a' })
  await expect.poll(() => ctx.tools.get('mcp__ahel__hold')).toBeDefined()
  const tools = { hold: ctx.tools.get('mcp__ahel__hold'), ping: ctx.tools.get('mcp__ahel__ping') }
  const workspaceOf = (url: string | undefined): string | null => new URL(url ?? '', fixture.url).searchParams.get('workspace')
  let n = 0
  const call = (name: string, chat?: string) => ctx.tools.execute({
    name, arguments: {}, callId: ToolCallId(`call-${String(++n)}`), signal: new AbortController().signal,
    ...chat === undefined ? {} : { agent: { session: { header: { id: chat } } } as never },
  })

  const held = call('mcp__ahel__hold', 'chat-a')
  await expect.poll(() => fixture.holdUrls.length).toBe(1)
  // The person selects workspace B while chat A's call is still running.
  await McpClient.writeOAuthGrant(ctx.credentials, ref, { ...grant, workspace: 'ws-b' })
  await expect.poll(async () => {
    await call('mcp__ahel__ping')
    return workspaceOf(fixture.pingUrls.at(-1))
  }).toBe('ws-b')

  fixture.release()
  const result = await held
  expect(result.isError).toBe(false)
  expect(workspaceOf(fixture.holdUrls[0])).toBe('ws-a')
  expect(await call('mcp__ahel__ping', 'chat-a')).toMatchObject({ isError: false })
  expect(workspaceOf(fixture.pingUrls.at(-1))).toBe('ws-a')
  // The same registrations: the server was not reconnected, so its tools were not listed again.
  expect(ctx.tools.get('mcp__ahel__hold')).toBe(tools.hold)
  expect(ctx.tools.get('mcp__ahel__ping')).toBe(tools.ping)
})
