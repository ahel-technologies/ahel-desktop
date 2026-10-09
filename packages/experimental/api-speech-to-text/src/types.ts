/** JSON-safe inputs and results of the experimental speech Remote namespace. */
import type { SpeechInput, SpeechProviderId, SpeechSnapshot } from '@ahel/dsh-experimental-speech-to-text/types'
import type {} from '@ahel/dsh-typert-protocol'

declare module '@ahel/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Audio encoding or intake limits prevented transcription. */
    'speech/invalid-audio': { readonly reason: string }
    /** The selected provider rejected transcription. */
    'speech/transcription-failed': { readonly reason: string }
  }
}

/** Complete recording submitted for transcription, separate from Session admission. */
export interface TranscriptionRequest {
  readonly audioBase64: string
  readonly providerId?: SpeechProviderId
  readonly language?: string
  /** The chat whose composer recorded the audio. */
  readonly sessionId?: NonNullable<SpeechInput['sessionId']>
}

/** Current provider choices and audio intake limits. */
export interface SpeechCatalog extends SpeechSnapshot {
  readonly maxAudioBytes: number
  readonly maxDurationSeconds: number
}
