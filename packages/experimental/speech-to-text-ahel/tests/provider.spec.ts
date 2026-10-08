/** The ahel.ai dictation provider against a mocked fetch: request shape, sign-in, refresh and refusals. */
import { expect, it, vi } from 'vitest'
import type { SpeechInput } from '@ahel/dsh-experimental-speech-to-text/types'
import { AhelSpeechError, createAhelSpeechProvider, type AhelSpeechAccount, type Config } from '../src/index.ts'

/** A canonical 16 kHz mono PCM16 WAV of `seconds` of silence. */
function wav(seconds: number): Uint8Array {
  const samples = Math.round(seconds * 16000)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  return bytes
}

function account(
  tokens: Array<string | undefined>, workspace?: string, chats: ReadonlyMap<string, string> = new Map(),
): AhelSpeechAccount & { revalidate: ReturnType<typeof vi.fn> } {
  return {
    accessToken: vi.fn(async () => tokens.length > 1 ? tokens.shift() : tokens[0]),
    revalidate: vi.fn(async () => {}),
    workspace: async () => workspace,
    chatWorkspace: sessionId => chats.get(sessionId),
  }
}

const config: Config = { providerId: 'ahel-cloud', baseURL: 'https://ahel.test/api/llm/v1/', requestTimeoutMs: 90_000 }

it('posts the WAV as base64 JSON with the account bearer and workspace, and returns the transcript', async () => {
  const audio = wav(2)
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ text: 'Hello from Ahel.', language: 'en', durationMs: 2000 }))
  const provider = createAhelSpeechProvider(account(['token-1'], 'ws-7'), config, fetchImpl)
  expect(provider.info).toMatchObject({ id: 'ahel-cloud', name: 'Ahel', location: 'cloud' })
  expect(provider.info.languages).toContain('et')

  const transcript = await provider.transcribe({ audio, language: 'en' }, new AbortController().signal)
  expect(transcript.text).toBe('Hello from Ahel.')
  expect(transcript.audioSeconds).toBe(2)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const [url, init] = fetchImpl.mock.calls[0]!
  expect((url as URL).href).toBe('https://ahel.test/api/llm/v1/audio/transcriptions')
  expect(init?.method).toBe('POST')
  expect(init?.redirect).toBe('error')
  expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  expect((init?.headers as Record<string, string>)['X-Ahel-Workspace']).toBe('ws-7')
  expect(JSON.parse(init?.body as string)).toEqual({ audio: Buffer.from(audio).toString('base64'), format: 'wav', language: 'en' })
})

it('bills dictation from a chat stamped with one workspace there while another is selected', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ text: 'Hi.', durationMs: 1000 }))
  const provider = createAhelSpeechProvider(account(['token'], 'ws-b', new Map([['chat-a', 'ws-a']])), config, fetchImpl)
  const sessionId = (id: string) => id as NonNullable<SpeechInput['sessionId']>
  await provider.transcribe({ audio: wav(1), language: 'en', sessionId: sessionId('chat-a') }, new AbortController().signal)
  await provider.transcribe({ audio: wav(1), language: 'en', sessionId: sessionId('chat-new') }, new AbortController().signal)
  const sent = fetchImpl.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['X-Ahel-Workspace'])
  expect(sent).toEqual(['ws-a', 'ws-b'])
})

it('sends no workspace while neither a chat stamp nor a selection is known', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ text: 'Hi.', durationMs: 1000 }))
  await createAhelSpeechProvider(account(['token']), config, fetchImpl).transcribe({ audio: wav(1), language: 'en' }, new AbortController().signal)
  expect(fetchImpl.mock.calls[0]![1]?.headers).not.toHaveProperty('X-Ahel-Workspace')
})

it('omits the language for automatic detection and refreshes a refused bearer once', async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ text: '', durationMs: 500 }))
  const signedIn = account(['stale', 'fresh'])
  const provider = createAhelSpeechProvider(signedIn, config, fetchImpl)
  const transcript = await provider.transcribe({ audio: wav(0.5), language: 'auto' }, new AbortController().signal)
  expect(transcript.text).toBe('')
  expect(signedIn.revalidate).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string)).not.toHaveProperty('language')
  expect((fetchImpl.mock.calls[1]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
})

it('is ready only while signed in, and refuses signed out, over-balance and rate-limited requests in plain words', async () => {
  const provider = createAhelSpeechProvider(account([undefined]), config, vi.fn<typeof fetch>())
  expect(provider.preparation?.snapshot()).toEqual({ phase: 'failed', message: 'Sign in to Ahel to dictate.' })
  const changed = vi.fn()
  provider.preparation?.subscribe(changed)
  provider.setSignedIn(true)
  expect(provider.preparation?.snapshot()).toEqual({ phase: 'ready' })
  expect(changed).toHaveBeenCalledTimes(1)
  await expect(provider.transcribe({ audio: wav(1), language: 'en' }, new AbortController().signal)).rejects.toThrow('Sign in to Ahel to dictate.')

  for (const [response, code] of [
    [Response.json({ error: { message: 'The workspace balance cannot cover this request.' } }, { status: 402 }), 'AHEL_BALANCE'],
    [new Response(null, { status: 429 }), 'AHEL_RATE_LIMITED'],
  ] as const) {
    const refusing = createAhelSpeechProvider(account(['token']), config, vi.fn<typeof fetch>(async () => response))
    const failure = await refusing.transcribe({ audio: wav(1), language: 'en' }, new AbortController().signal).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AhelSpeechError)
    expect((failure as AhelSpeechError).code).toBe(code)
  }
})
