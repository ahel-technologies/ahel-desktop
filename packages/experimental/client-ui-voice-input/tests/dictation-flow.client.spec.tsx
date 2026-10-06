// @vitest-environment jsdom
/**
 * Dictation end to end without a microphone or a browser: a WAV fixture leaves a stub recording, passes
 * the real speech controller and registry, is posted by the ahel.ai provider to a local mock of
 * `POST /api/llm/v1/audio/transcriptions`, and its transcript lands in the draft without being sent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Context } from '@ahel/cordis'
import { bindSnapshotSelector, makeTranslate } from '@ahel/dsh-client-test-runtime'
import { createSnapshotStore } from '@ahel/dsh-client-store'
import { en as commonEn } from '@ahel/dsh-client-locale/src/locales/en.ts'
import SpeechToText from '@ahel/dsh-experimental-speech-to-text'
import SpeechController from '@ahel/dsh-experimental-api-speech-to-text'
import { createAhelSpeechProvider } from '@ahel/dsh-experimental-speech-to-text-ahel'
import type { SessionId } from '@ahel/dsh-session/types'
import { VoiceInput, type VoiceInputProps } from '../src/client/VoiceInput.tsx'
import { Recording } from '../src/client/audio.ts'
import type { SpeechReadiness } from '../src/client/readiness.ts'
import { en } from '../src/client/locales.ts'
import { DictationToggles } from '../src/client/hotkey.ts'

const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'dictation-1s.wav'))
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { cleanup(); while (cleanups.length > 0) await cleanups.pop()!() })

/** A local stand-in for ahel.ai's route: checks the bearer, workspace and WAV, then answers like ahel.ai. */
async function mockRoute() {
  const seen: Array<{ path: string; authorization: string | undefined; body: { audio: string; format?: string; language?: string } }> = []
  const read = (request: IncomingMessage): Promise<string> => new Promise((resolve) => {
    let raw = ''
    request.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    request.on('end', () => { resolve(raw) })
  })
  const server = createServer((request, response) => {
    void read(request).then((raw) => {
      const body = JSON.parse(raw) as { audio: string; format?: string; language?: string }
      seen.push({ path: request.url ?? '', authorization: request.headers.authorization, body })
      const audio = Buffer.from(body.audio, 'base64')
      if (request.headers.authorization !== 'Bearer test-token' || audio.toString('ascii', 0, 4) !== 'RIFF') {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad request' } }))
        return
      }
      const durationMs = Math.round((audio.length - 44) / 32)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: 'Hello from Ahel.', durationMs }))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, seen }
}

it('posts a recorded WAV through the ahel.ai provider and inserts the transcript into the draft, never sending it', async () => {
  const route = await mockRoute()
  // Host half: the registry, the ahel.ai provider (signed in) and the speech controller the Remote exposes.
  const host = new Context()
  cleanups.push(() => host.fiber.dispose())
  const speech = new SpeechToText(host, SpeechToText.Config({ defaultProvider: 'ahel-cloud', language: 'auto' }))
  const provider = createAhelSpeechProvider({ accessToken: async () => 'test-token', revalidate: async () => {}, workspace: async () => 'ws-1' },
    { providerId: 'ahel-cloud', baseURL: `${route.origin}/api/llm/v1`, requestTimeoutMs: 10_000 }, globalThis.fetch)
  provider.setSignedIn(true)
  speech.register(provider)
  const controller = new SpeechController(host, { maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 60 })

  // Browser half: the composer control; the recording returns the fixture instead of microphone audio.
  const capture = Object.assign(new Recording(() => {}), { start: vi.fn(async () => {}), stop: vi.fn(async () => new Uint8Array(FIXTURE)),
    amplitude: () => 0, dispose: vi.fn(async () => {}) })
  const inputActions = { notify: vi.fn(), captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 1 })), insertText: vi.fn(() => true),
    setDraft: vi.fn(), persistDraft: vi.fn(), addAttachments: vi.fn(() => true), removeAttachment: vi.fn(), pruneAttachments: vi.fn(),
    submit: vi.fn() }
  const readiness = createSnapshotStore<SpeechReadiness>({ connected: true, error: null, catalog: controller.catalog() })
  const props: VoiceInputProps = { sessionId: 'one' as SessionId, inputActions, locked: false, onActiveChange: vi.fn(),
    transcribe: async (request, signal) => ({ ok: true, value: await controller.transcribe(request, signal) }),
    openSettings: vi.fn(), toggles: new DictationToggles(), prepare: vi.fn(async () => {}), cancelPreparation: vi.fn(async () => {}),
    configure: vi.fn(async () => {}), useSpeechReadiness: bindSnapshotSelector(readiness), createRecording: () => capture,
    t: makeTranslate(en, commonEn) }
  render(<VoiceInput {...props} />)

  fireEvent.click(screen.getByRole('button', { name: en.start }))
  fireEvent.click(await screen.findByRole('button', { name: en.stop }))
  await waitFor(() => { expect(inputActions.insertText).toHaveBeenCalledWith('Hello from Ahel.', { start: 0, end: 0, draftRev: 1 }) })
  expect(inputActions.submit).not.toHaveBeenCalled()

  expect(route.seen).toHaveLength(1)
  expect(route.seen[0]!.path).toBe('/api/llm/v1/audio/transcriptions?workspace=ws-1')
  expect(route.seen[0]!.body).toEqual({ audio: FIXTURE.toString('base64'), format: 'wav' })
})
