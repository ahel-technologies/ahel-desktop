import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@ahel/cordis'
import { LocalCredentialProvider } from '@ahel/dsh-credentials-local'
import { WebServer } from '@ahel/dsh-host-webserver'
import AhelAccount from '../src/index.ts'
import { hostedReadiness, hostedReadyHandler } from '../src/hosted-ready.ts'
import type { HostedReadyReason } from '../src/hosted-ready.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length > 0) await cleanups.pop()!()
})

it('becomes ready when the launch grant settles, before the ceiling', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  let settle!: () => void
  const reason = hostedReadiness(ctx, new Promise<void>((resolve) => { settle = resolve }), 20_000)
  await vi.advanceTimersByTimeAsync(19_999)
  expect(reason()).toBeUndefined()
  settle()
  await vi.advanceTimersByTimeAsync(0)
  expect(reason()).toBe('account')
  await vi.advanceTimersByTimeAsync(1)
  expect(reason()).toBe('account')
})

it('becomes ready at the ceiling while the launch grant is still unsettled', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  let settle!: () => void
  const reason = hostedReadiness(ctx, new Promise<void>((resolve) => { settle = resolve }), 20_000)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(reason()).toBe('ceiling')
  settle()
  await vi.advanceTimersByTimeAsync(0)
  expect(reason()).toBe('ceiling')
})

it('clears the ceiling timer on disposal', async () => {
  vi.useFakeTimers()
  const ctx = new Context()
  const readers: Array<() => HostedReadyReason | undefined> = []
  const fiber = ctx.plugin((inner: Context) => {
    readers.push(hostedReadiness(inner, new Promise<void>(() => {}), 1_000))
  })
  await fiber
  await fiber.dispose()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(readers[0]?.()).toBeUndefined()
})

async function serve(reason: () => HostedReadyReason | undefined): Promise<string> {
  const server = createServer(hostedReadyHandler(reason))
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`
}

it('answers 503 before ready, 200 with the reason after, and refuses other methods', async () => {
  const state: { current?: HostedReadyReason } = {}
  const url = await serve(() => state.current)

  const before = await fetch(url)
  expect(before.status).toBe(503)
  expect(before.headers.get('cache-control')).toBe('no-store')
  expect(await before.json()).toEqual({ ready: false })

  state.current = 'account'
  const after = await fetch(url)
  expect(after.status).toBe(200)
  expect(await after.json()).toEqual({ ready: true, reason: 'account' })

  const head = await fetch(url, { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')

  const post = await fetch(url, { method: 'POST' })
  expect(post.status).toBe(405)
  expect(post.headers.get('allow')).toBe('GET, HEAD')
})

/** A fake ahel.ai whose token endpoint answers only when `release` is called. */
async function slowAhel() {
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  const server = createServer((request, response) => {
    void (async () => {
      const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
      const json = (status: number, value: unknown): true => {
        response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
        return true
      }
      switch (new URL(request.url ?? '/', origin).pathname) {
        case '/.well-known/oauth-authorization-server':
          return json(200, { issuer: origin, authorization_endpoint: `${origin}/a`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/r` })
        case '/token':
          request.resume()
          await released
          return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
        case '/api/mcp/profile':
          return json(200, { user: { email: 'person@example.test', name: null }, memberships: [] })
        default:
          return json(404, { error: 'not_found' })
      }
    })()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { release(); server.close(() => { resolve() }); server.closeAllConnections() }))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, release }
}

async function launchedHost(config: Record<string, unknown>, token: string | undefined) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ahel-hosted-ready-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
  const ctx = new Context()
  const web = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const credentials = ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await web
  await credentials
  if (token === undefined) Reflect.deleteProperty(process.env, 'DSH_TEST_READY_LAUNCH_TOKEN')
  else process.env.DSH_TEST_READY_LAUNCH_TOKEN = token
  const plugin = ctx.plugin(AhelAccount, { launchTokenEnv: 'DSH_TEST_READY_LAUNCH_TOKEN', ...config })
  await plugin
  cleanups.push(async () => { await plugin.dispose(); await credentials.dispose(); await web.dispose() })
  return { ctx, base: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

const launchToken = JSON.stringify({ client_id: 'ahel-web-chat', refresh_token: 'launch-refresh' })

it('a launched Host answers ready only after its launch grant is stored', async () => {
  const ahel = await slowAhel()
  const { ctx, base } = await launchedHost({ appOrigin: ahel.origin }, launchToken)
  expect((await fetch(`${base}/_ahel/ready`)).status).toBe(503)
  ahel.release()
  expect((await ctx.ahelAccount.state()).status).toBe('signed-in')
  const ready = await fetch(`${base}/_ahel/ready`)
  expect(ready.status).toBe(200)
  expect(await ready.json()).toEqual({ ready: true, reason: 'account' })
})

it('a launched Host answers ready after a refused launch grant', async () => {
  const ahel = await slowAhel()
  const { ctx, base } = await launchedHost({ appOrigin: ahel.origin, hostedReadyPath: '/ready' }, '{"refresh_token":"no-client"}')
  expect((await ctx.ahelAccount.state()).status).toBe('signed-out')
  expect(await (await fetch(`${base}/ready`)).json()).toEqual({ ready: true, reason: 'account' })
})

it('a launched Host answers ready at the ceiling while ahel.ai does not answer', async () => {
  const ahel = await slowAhel()
  const { base } = await launchedHost({ appOrigin: ahel.origin, hostedReadyCeilingMs: 0 }, launchToken)
  await vi.waitFor(async () => {
    expect(await (await fetch(`${base}/_ahel/ready`)).json()).toEqual({ ready: true, reason: 'ceiling' })
  })
})

it('serves no readiness route without a launch token or with an empty path', async () => {
  const ahel = await slowAhel()
  const plain = await launchedHost({ appOrigin: ahel.origin }, undefined)
  expect((await fetch(`${plain.base}/_ahel/ready`)).status).toBe(404)
  const off = await launchedHost({ appOrigin: ahel.origin, hostedReadyPath: '' }, '{"refresh_token":"no-client"}')
  expect((await fetch(`${off.base}/_ahel/ready`)).status).toBe(404)
})
