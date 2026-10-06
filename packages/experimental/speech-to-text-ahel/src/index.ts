/**
 * Cloud dictation for Ahel Desktop: a `cloud` speech provider that sends one
 * complete recording (the 16 kHz mono PCM16 WAV the voice input records) to
 * ahel.ai's metered transcription route, `POST <baseURL>/audio/transcriptions`,
 * with the signed-in Ahel account's bearer and selected workspace. ahel.ai
 * transcribes it with an audio-capable model and charges the workspace
 * balance; nothing is stored. The provider is ready only while signed in.
 *
 * @module @ahel/dsh-experimental-speech-to-text-ahel
 */

import type { Context } from '@ahel/cordis'
import Schema from '@ahel/schemastery'
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-experimental-speech-to-text'
import type { SpeechPreparation, SpeechPreparationState, SpeechProvider, SpeechProviderId, Transcript } from '@ahel/dsh-experimental-speech-to-text/types'

/** Cordis plugin name. */
export const name = 'experimental-speech-to-text-ahel'
/** Services required by this plugin. */
export const inject = ['speechToText', 'ahelAccount']

/** Language hints offered; ahel.ai's model detects the language on `auto`. */
export const AHEL_SPEECH_LANGUAGES: readonly string[] = [
  'auto', 'en', 'et', 'fi', 'lv', 'lt', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'no', 'zh', 'ja', 'ko',
]

/** Deployment choices. */
export interface Config {
  /** Provider id the speech registry selects. */
  providerId: string
  /** Base URL of ahel.ai's metered model proxy. */
  baseURL: string
  /** Deadline for one transcription request in milliseconds. */
  requestTimeoutMs: number
}

/** Validated configuration. */
export const Config: Schema<Config> = Schema.object({
  providerId: Schema.string().pattern(/^[a-z][a-z0-9-]*$/).default('ahel-cloud'),
  baseURL: Schema.string().default('https://ahel.ai/api/llm/v1'),
  requestTimeoutMs: Schema.number().min(1_000).max(600_000).default(90_000),
})

/** The account surface the provider needs; `AhelAccount` satisfies it. */
export interface AhelSpeechAccount {
  /** @returns a fresh bearer, or undefined while signed out. */
  accessToken(): Promise<string | undefined>
  /** Refresh the bearer once after ahel.ai refused it. */
  revalidate(): Promise<void>
  /** @returns the selected workspace id, or undefined for the account default. */
  workspace(): Promise<string | undefined>
}

/** A transcription refusal whose message is shown to the person as it is. */
export class AhelSpeechError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AhelSpeechError'
  }
}

const SIGNED_OUT = 'Sign in to Ahel to dictate.'

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

/** The server's own sentence from an OpenAI-shaped error body, if any. */
async function serverMessage(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    const message = body.error?.message
    return typeof message === 'string' && message.length > 0 && message.length < 500 ? message : undefined
  } catch (_unreadable) {
    return undefined
  }
}

/** A signed-in readiness mirror: `ready` while signed in, a sign-in prompt otherwise. */
class SignInReadiness implements SpeechPreparation {
  private state: SpeechPreparationState = { phase: 'failed', message: SIGNED_OUT }
  private readonly listeners = new Set<() => void>()
  snapshot(): SpeechPreparationState { return this.state }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Nothing to download; sign-in happens in the account menu. */
  prepare(): void {}
  cancel(): Promise<void> { return Promise.resolve() }
  set(signedIn: boolean): void {
    const phase = this.state.phase
    if (signedIn ? phase === 'ready' : phase === 'failed') return
    this.state = signedIn ? { phase: 'ready' } : { phase: 'failed', message: SIGNED_OUT }
    for (const listener of this.listeners) listener()
  }
}

/** The provider plus its sign-in readiness switch. */
export interface AhelSpeechProvider extends SpeechProvider {
  /** Mirror the account's sign-in state into readiness. */
  setSignedIn(signedIn: boolean): void
}

/**
 * Build the ahel.ai dictation provider.
 * @param account - the signed-in ahel.ai account.
 * @param config - resolved configuration.
 * @param fetchImpl - HTTP client; tests pass a fake.
 * @returns a `cloud` provider whose `transcribe` posts the WAV to ahel.ai.
 */
export function createAhelSpeechProvider(account: AhelSpeechAccount, config: Config, fetchImpl: typeof fetch = fetch): AhelSpeechProvider {
  const readiness = new SignInReadiness()
  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/audio/transcriptions`
  const transcribe = async (input: { audio: Uint8Array; language: string }, signal: AbortSignal): Promise<Transcript> => {
    signal.throwIfAborted()
    const started = Date.now()
    const url = new URL(endpoint)
    const workspace = await account.workspace()
    if (workspace !== undefined) url.searchParams.set('workspace', workspace)
    const body = JSON.stringify({
      audio: base64(input.audio), format: 'wav',
      ...input.language === 'auto' ? {} : { language: input.language },
    })
    const combined = AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)])
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await account.accessToken()
      if (token === undefined) throw new AhelSpeechError(SIGNED_OUT, 'AHEL_SIGNED_OUT')
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          // The bearer never follows a redirect to another origin.
          redirect: 'error',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body,
          signal: combined,
        })
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          throw new AhelSpeechError('ahel.ai took too long to transcribe. Try a shorter recording.', 'AHEL_TIMEOUT', { cause: error })
        }
        throw new AhelSpeechError('ahel.ai did not answer. Check the connection and try again.', 'AHEL_UNREACHABLE', { cause: error })
      }
      if (response.status !== 401) break
      await response.body?.cancel()
      if (attempt === 0) await account.revalidate()
    }
    if (response === undefined || response.status === 401) {
      throw new AhelSpeechError('Your Ahel sign-in has ended. Sign in to Ahel again.', 'AHEL_SESSION_ENDED')
    }
    if (!response.ok) {
      const message = await serverMessage(response)
      switch (response.status) {
        case 402: throw new AhelSpeechError(`${message ?? 'The workspace balance cannot cover dictation.'} Add money on ahel.ai.`, 'AHEL_BALANCE')
        case 403: throw new AhelSpeechError(message ?? 'Dictation is not available for this Ahel workspace.', 'AHEL_NOT_ENABLED')
        case 429: throw new AhelSpeechError('ahel.ai is limiting how fast you dictate. Wait a minute and try again.', 'AHEL_RATE_LIMITED')
        default: throw new AhelSpeechError(message ?? `ahel.ai answered HTTP ${String(response.status)}.`, 'AHEL_FAILED')
      }
    }
    const answer = await response.json() as { text?: unknown; durationMs?: unknown }
    if (typeof answer.text !== 'string') throw new AhelSpeechError('ahel.ai sent an unreadable transcript.', 'AHEL_FAILED')
    const durationMs = typeof answer.durationMs === 'number' && Number.isFinite(answer.durationMs) ? answer.durationMs : 0
    return { text: answer.text, audioSeconds: durationMs / 1000, inferenceSeconds: (Date.now() - started) / 1000 }
  }
  return {
    info: { id: config.providerId as SpeechProviderId, name: 'Ahel', location: 'cloud', languages: AHEL_SPEECH_LANGUAGES },
    preparation: readiness,
    transcribe,
    setSignedIn: (signedIn) => { readiness.set(signedIn) },
  }
}

/**
 * Register the ahel.ai provider and keep its readiness in step with the account.
 * @param ctx - plugin context with `speechToText` and `ahelAccount`.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = createAhelSpeechProvider(ctx.ahelAccount, config)
  const refresh = (): void => {
    ctx.ahelAccount.state().then((view) => { provider.setSignedIn(view.status === 'signed-in') }, (error: unknown) => {
      ctx.logger.warn(`speech-to-text-ahel: account state unreadable: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.effect(() => ctx.speechToText.register(provider), 'speech-to-text-ahel.provider')
  ctx.on('ahel-account/changed', (view) => { provider.setSignedIn(view.status === 'signed-in') })
  refresh()
}
