import OTel from '@ahel/dsh-otel'
import { Context } from '@ahel/cordis'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import ProductTelemetry, { Config as TelemetryConfig, type ProductTelemetryRecord } from '@ahel/dsh-host-product-telemetry-otel'
import { Session, SessionId, SessionSeq } from '@ahel/dsh-session'
import { CompactionId } from '@ahel/dsh-compaction'
import Analytics from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function setup(enabled: boolean) {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const emit = vi.fn<(record: ProductTelemetryRecord) => void>()
  ctx.provide('webServer', {} as never)
  ctx.provide('productTelemetry', { emit } as never)
  const fiber = await ctx.plugin(Analytics, { enabled, appVersion: 'test-version' })
  return { ctx, fiber, emit }
}

it('collection is off by default', async () => {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('productTelemetry', { emit: vi.fn() } as never)
  await ctx.plugin(Analytics, {})
  expect(ctx.productAnalytics.enabled()).toBe(false)
})

it('disabled collection does not submit an event', async () => {
  const b = await setup(false)
  expect(b.ctx.productAnalytics.enabled()).toBe(false)
  await b.ctx.productAnalytics.report({ eventName: 'desktop_app_launch', timestamp: 100, attributes: {} })
  expect(b.emit).not.toHaveBeenCalled()
})

it('copies only approved common fields and attaches no identity', async () => {
  const b = await setup(true)
  await b.ctx.productAnalytics.report({ eventName: 'auth_page_click', timestamp: 100, attributes: { button_name: 'sign_in' } })
  expect(b.emit).toHaveBeenCalledExactlyOnceWith({
    eventName: 'auth_page_click', body: 'auth_page_click', timestamp: 100,
    attributes: { button_name: 'sign_in', app_version: 'test-version' },
  })
})

it('unload stops intake', async () => {
  const b = await setup(true)
  const analytics = b.ctx.productAnalytics
  await b.fiber.dispose()
  await analytics.report({ eventName: 'desktop_app_launch', timestamp: 100, attributes: {} })
  expect(b.emit).not.toHaveBeenCalled()
})

it('writes the selected event through the real exporter to an isolated collector', async () => {
  const captures: string[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => { captures.push(Buffer.concat(chunks).toString()); res.end('{}') })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => { const done = once(server, 'close'); server.close(); server.closeAllConnections(); await done })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector port')
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  ctx.provide('credentials', { readRecord: async () => undefined } as never)
  ctx.provide('webServer', {} as never)
  await ctx.plugin(OTel)
  const exporter = await ctx.plugin(ProductTelemetry, TelemetryConfig({ endpoint: `http://127.0.0.1:${address.port}/v1/logs`, serviceName: 'test', serviceVersion: '1', compression: 'none' }))
  await ctx.plugin(Analytics, { enabled: true })
  await ctx.productAnalytics.report({ eventName: 'api_key_save_click', timestamp: 1_800_000_000_000, attributes: {} })
  await exporter.dispose()
  expect(captures).toHaveLength(1)
  expect(JSON.parse(captures[0]!)).toMatchObject({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: 'api_key_save_click', timeUnixNano: '1800000000000000000' }] }] }] })
  expect(captures[0]).not.toContain('device_id')
  expect(captures[0]).not.toContain('app_version')
})

it.each([true, false])('collects live manual and automatic compaction only when enabled: %s', async (enabled) => {
  const b = await setup(enabled)
  const session = Session.create(SessionId('analytics-compaction'))
  b.ctx.emit('session/event', session, { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } })
  for (const turn of [null, 1]) {
    b.ctx.emit('session/event', session, { type: 'compaction/start', seq: SessionSeq(1), time: 1,
      data: { compactionId: CompactionId('analytics-compaction'), turn } })
  }
  if (enabled) await vi.waitFor(() => { expect(b.emit).toHaveBeenCalledTimes(2) })
  expect(b.emit.mock.calls.map(([event]) => event.attributes?.trigger_type)).toEqual(enabled ? ['manual', 'auto'] : [])
})

it('isolates exporter submission failure', async () => {
  const b = await setup(true)
  b.emit.mockImplementationOnce(() => { throw new Error('exporter unavailable') })
  await expect(b.ctx.productAnalytics.report({ eventName: 'desktop_app_launch', timestamp: 2, attributes: {} })).resolves.toBeUndefined()
})


it('requires the exporter even when collection is disabled', async () => {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const fiber = ctx.plugin(Analytics, { enabled: false })
  await Promise.resolve()
  expect(ctx.get('productAnalytics')).toBeUndefined()
  ctx.provide('productTelemetry', { emit: vi.fn() } as never)
  await fiber
  expect(ctx.productAnalytics.enabled()).toBe(false)
})

it('streams live policy changes and rejects intake after disabling', async () => {
  const b = await setup(true)
  const lifetime = new AbortController()
  const iterator = b.ctx.productAnalytics.watchPolicy(lifetime.signal)[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ value: true, done: false })
  const next = iterator.next()
  // Loader commits the stable Config reference before publishing this notification.
  const { updateVolatile, createVolatile } = await import('../../../../vendor/cosmokit/src/volatile.ts')
  const config = b.fiber.config as import('../src/index.ts').Config
  updateVolatile(config.enabled, createVolatile(false))
  b.fiber.ctx.emit('loader/volatile-update', [['enabled']])
  expect(await next).toEqual({ value: false, done: false })
  await b.ctx.productAnalytics.report({ eventName: 'auth_page_view', timestamp: 1, attributes: {} })
  expect(b.emit).not.toHaveBeenCalled()
  const closed = iterator.next()
  lifetime.abort()
  expect(await closed).toEqual({ value: undefined, done: true })
})

it('wakes pending policy readers on disposal and registers hidden settings presentation', async () => {
  const b = await setup(true)
  const dispose = vi.fn()
  const configure = vi.fn(() => dispose)
  b.ctx.provide('settings', { configure } as never)
  await vi.waitFor(() => { expect(configure).toHaveBeenCalledWith({ auto: false }, b.fiber) })
  const iterator = b.ctx.productAnalytics.watchPolicy(new AbortController().signal)[Symbol.asyncIterator]()
  await iterator.next()
  const pending = iterator.next()
  await b.fiber.dispose()
  expect(await pending).toEqual({ done: true, value: undefined })
  expect(dispose).toHaveBeenCalledOnce()
})
