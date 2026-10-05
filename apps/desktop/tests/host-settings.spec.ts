/** Shell settings reads reuse authenticated Web RPC. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopHostSettings } from '../src/host-settings.ts'

function transport(preference?: string) {
  const namespaces = [{ ns: 'locale', value: preference === undefined ? {} : { preference } }]
  const send = vi.fn<Parameters<typeof connectDesktopHostSettings>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method } = JSON.parse(init.body as string) as { rpcId: string; method: string }
    const value = method === 'settings/describe' ? { namespaces } : undefined
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send }
}

const url = 'http://127.0.0.1:19387/?token=fixture'

describe('desktop Host settings reads', () => {
  it('authenticates through Web and reads the language with one bounded RPC', async () => {
    const host = transport('zh')
    const settings = await connectDesktopHostSettings(url, host.send)
    expect(host.send).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' })
    host.send.mockClear()
    expect(await settings.readLocalePreference()).toBe('zh')
    expect(host.send).toHaveBeenCalledOnce()
    const [input, init] = host.send.mock.calls[0]!
    expect(input).toBe('http://127.0.0.1:19387/api/settings/describe')
    expect(init).toMatchObject({ credentials: 'include', redirect: 'error' })
  })

  it('reports no preference when the language was never selected', async () => {
    const settings = await connectDesktopHostSettings(url, transport().send)
    expect(await settings.readLocalePreference()).toBeNull()
  })

  it('rejects unmatched RPC envelopes', async () => {
    const host = transport()
    const settings = await connectDesktopHostSettings(url, host.send)
    host.send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(settings.readLocalePreference()).rejects.toThrow('Web RPC failed')
  })

  it('refuses an unauthenticated Web launch', async () => {
    const send = vi.fn<Parameters<typeof connectDesktopHostSettings>[1]>(async () => new Response(null, { status: 401 }))
    await expect(connectDesktopHostSettings(url, send)).rejects.toThrow('Web authentication failed')
  })
})
