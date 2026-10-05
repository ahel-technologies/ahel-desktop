import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { parseOAuthGrant } from '@deepseek-ai/dsh-mcp-client'
import AhelAccount from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** A fake ahel.ai: discovery, registration, token (code + refresh), profile and revoke. */
async function fakeAhel() {
  const seen = { registrations: [] as Array<Record<string, unknown>>, tokenForms: [] as URLSearchParams[], revoked: [] as string[] }
  let issued = 0
  const server = createServer((request, response) => {
    void (async () => {
      const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
      const json = (status: number, value: unknown): true => {
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
        return true
      }
      const url = new URL(request.url ?? '/', origin)
      switch (url.pathname) {
        case '/.well-known/oauth-authorization-server':
          return json(200, {
            issuer: origin,
            authorization_endpoint: `${origin}/api/auth/mcp/authorize`,
            token_endpoint: `${origin}/api/auth/mcp/token`,
            registration_endpoint: `${origin}/api/auth/mcp/register`,
          })
        case '/api/auth/mcp/register':
          seen.registrations.push(JSON.parse(await body(request)) as Record<string, unknown>)
          return json(201, { client_id: `client-${String(seen.registrations.length)}` })
        case '/api/auth/mcp/token': {
          const form = new URLSearchParams(await body(request))
          seen.tokenForms.push(form)
          issued++
          // 30 s lifetime: inside the 60 s refresh skew, so the next read refreshes.
          return json(200, { access_token: `access-${String(issued)}`, refresh_token: `refresh-${String(issued)}`, expires_in: 30 })
        }
        case '/api/mcp/profile':
          if (request.headers.authorization?.startsWith('Bearer access-') !== true) return json(401, { error: 'unauthorized' })
          return json(200, { user: { email: 'person@example.test' }, memberships: [{ id: 't1', name: 'Team', slug: 'team', role: 'OWNER' }] })
        case '/api/mcp/revoke':
          seen.revoked.push(request.headers.authorization ?? '')
          return json(200, { ok: true })
        default:
          return json(404, { error: 'not_found' })
      }
    })()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, seen }
}

it('signs in through the browser, refreshes on demand, and signs out with a revoke', async () => {
  const ahel = await fakeAhel()
  const home = await mkdtemp(join(tmpdir(), 'dsh-ahel-account-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await credentials
  const plugin = ctx.plugin(AhelAccount, { appOrigin: ahel.origin, resource: 'https://mcp.ahel.ai/mcp' })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose() })
  const account = ctx.ahelAccount

  // The "browser": follow the authorize URL's redirect back to the loopback listener.
  let authorize: URL | undefined
  account.setOpener(async (url) => {
    authorize = new URL(url)
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'the-code')
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    await fetch(callback)
  })

  const started = await account.signIn()
  expect(started.attempt?.phase).toMatch(/waiting-browser|exchanging|succeeded/)
  const states = new AbortController()
  cleanups.push(async () => { states.abort() })
  for await (const view of account.watch(states.signal)) if (view.attempt?.phase === 'succeeded') break

  expect(authorize?.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorize?.searchParams.get('scope')).toBe('openid profile email offline_access')
  expect(authorize?.searchParams.get('resource')).toBe('https://mcp.ahel.ai/mcp')
  expect(authorize?.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  expect(ahel.seen.registrations[0]).toMatchObject({ token_endpoint_auth_method: 'none', redirect_uris: [authorize?.searchParams.get('redirect_uri')] })
  expect(String(ahel.seen.registrations[0]?.client_name)).toMatch(/^Ahel Desktop on /)
  expect(ahel.seen.tokenForms[0]?.get('code_verifier')).toBeTruthy()

  const view = await account.state()
  expect(view).toMatchObject({ status: 'signed-in', profile: { email: 'person@example.test', workspaces: [{ id: 't1', slug: 'team' }] } })
  const stored = await ctx.credentials.resolve(credentialRef('AHEL_ACCOUNT'))
  expect(parseOAuthGrant(stored!.value)).toMatchObject({ client_id: 'client-1', access_token: 'access-1', refresh_token: 'refresh-1' })

  // Expiring within the skew: the next read refreshes and writes the grant back.
  expect(await account.accessToken()).toBe('access-2')
  expect(ahel.seen.tokenForms[1]?.get('grant_type')).toBe('refresh_token')
  expect(ahel.seen.tokenForms[1]?.get('refresh_token')).toBe('refresh-1')
  expect(parseOAuthGrant((await ctx.credentials.resolve(credentialRef('AHEL_ACCOUNT')))!.value)?.access_token).toBe('access-2')

  expect(await account.profile()).toMatchObject({ email: 'person@example.test' })

  const out = await account.signOut()
  expect(out.status).toBe('signed-out')
  expect(ahel.seen.revoked).toHaveLength(1)
  expect(await ctx.credentials.resolve(credentialRef('AHEL_ACCOUNT'))).toBeUndefined()
  expect(await account.accessToken()).toBeUndefined()
})
