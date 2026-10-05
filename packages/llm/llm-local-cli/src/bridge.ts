/**
 * Shared machinery for model routes served by an installed coding CLI: the
 * CLI runs each turn as its own agent on the person's own sign-in, so the
 * harness's tools are not forwarded and the route only streams text,
 * "Using ..." activity lines and usage. Subclasses say how to start the CLI
 * and how to read its JSON lines.
 */

import { createInterface } from 'node:readline'
import { LlmAdapter } from '@ahel/dsh-llm'
import type {
  GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk, TokenUsage,
} from '@ahel/dsh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@ahel/dsh-subprocess'
import { renderTranscript } from './transcript.ts'
import type { RenderedPrompt } from './transcript.ts'

/** Failure code of a run the CLI refused because the person is not signed in to it. */
export const LOCAL_CLI_SIGNED_OUT_CODE = 'LOCAL_CLI_SIGNED_OUT'

/** What a CLI route needs from the Host. */
export interface BridgeHost {
  /** Start one child process (`ctx.subprocess.spawn`). */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
  /** Detected executable path, or undefined while the CLI is missing. */
  executable(): string | undefined
  /** Signed-in ahel.ai access token, handed to the CLI's MCP config through its environment. */
  ahelToken(): Promise<string | undefined>
  readonly platform: NodeJS.Platform
}

/** One model a CLI accepts by alias. */
export interface LocalCliModel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Everything one CLI run is started with. */
export interface CliInvocation {
  readonly argv: readonly string[]
  readonly cwd: string
  /** Explicit entries layered on the scrubbed parent environment; `undefined` removes one. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Written to stdin, which is then closed. */
  readonly stdin: string
  /** Removes temporary files once the run has ended. */
  cleanup?(): Promise<void>
}

/** Inputs for {@link LocalCliAdapter.invocation}. */
export interface InvocationRequest {
  readonly executable: string
  readonly model: string
  readonly prompt: RenderedPrompt
  /** The CLI's own session id to continue, when one is known for this conversation. */
  readonly resumeId?: string
}

/** One fact read from a CLI output line. */
export type CliEvent =
  | { readonly kind: 'session'; readonly id: string }
  /** The CLI started a new content block; the next delta opens a new harness block. */
  | { readonly kind: 'boundary' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'usage'; readonly usage: TokenUsage }
  /** The turn ended; `error` carries the CLI's failure text. */
  | { readonly kind: 'result'; readonly error?: string }

/** Kept CLI sessions per route; older conversations start a fresh CLI session from the full transcript. */
const MAX_RESUMABLE_SESSIONS = 200
const STDERR_MAX_BYTES = 64 * 1024
const KILL_GRACE_MS = 2_000
const AUTH_TEXT = /\bauth|\b401\b|not logged in|log ?in\b|\/login|sign ?in|credential/i

interface Resumable {
  readonly cliSession: string
  /** Request length a follow-up turn must have to continue this CLI session. */
  readonly nextLength: number
}

/** Builds harness blocks from text and reasoning deltas, opening blocks lazily so empty ones never appear. */
class BlockWriter {
  private index = -1
  private open: { type: 'text' | 'reasoning'; text: string } | undefined
  wrote = false

  delta(type: 'text' | 'reasoning', text: string): StreamChunk[] {
    if (text.length === 0) return []
    const chunks = this.open !== undefined && this.open.type !== type ? this.close() : []
    if (this.open === undefined) {
      this.open = { type, text: '' }
      chunks.push({ type: 'block-start', index: ++this.index, blockType: type })
    }
    this.open.text += text
    this.wrote = true
    chunks.push(type === 'text' ? { type: 'text-delta', index: this.index, text } : { type: 'reasoning-delta', index: this.index, text })
    return chunks
  }

  close(): StreamChunk[] {
    const open = this.open
    if (open === undefined) return []
    this.open = undefined
    return [{ type: 'block-end', index: this.index, block: { type: open.type, text: open.text } }]
  }
}

/**
 * A model route served by an unmodified CLI the person installed and signed
 * into. Tools in the request are ignored (the CLI is the agent); the signal
 * kills the child. The CLI's own session id is kept per conversation in
 * memory, so a follow-up turn sends only the new user message.
 */
export abstract class LocalCliAdapter extends LlmAdapter {
  private readonly sessions = new Map<string, Resumable>()

  /**
   * @param host - spawn, executable and account access.
   * @param label - provider name shown by model pickers.
   */
  constructor(protected readonly host: BridgeHost, protected readonly label: string) {
    super()
  }

  /** Models in picker order; the first is the default. */
  protected abstract readonly models: readonly LocalCliModel[]
  /** Shown when the CLI says it is not signed in. */
  protected abstract readonly signInMessage: string

  /**
   * Build one run.
   * @param request - executable, model, prompt and resume id.
   * @returns argv, cwd, environment, stdin and cleanup.
   */
  protected abstract invocation(request: InvocationRequest): Promise<CliInvocation>

  /**
   * Read one stdout JSON line.
   * @param line - the parsed line.
   * @returns the facts it carries, in order.
   */
  protected abstract parseLine(line: unknown): CliEvent[]

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.label }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models.map(model => ({
      provider, id: model.id, name: model.name, inputModalities: ['text'],
      ...model.description === undefined ? {} : { description: model.description },
    })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const known = this.models.find(entry => entry.id === model)
    return Promise.resolve({
      provider, id: model, name: known?.name ?? model, inputModalities: ['text'], context: { contextWindow: 200_000 },
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const executable = this.host.executable()
    if (executable === undefined) {
      yield this.failure({ message: `${this.label}: the CLI was not found on this computer. Refresh Settings > Models after installing it.`, code: 'PROVIDER_UNAVAILABLE' })
      return
    }
    const key = options.sessionId
    const known = key === undefined ? undefined : this.sessions.get(key)
    const resumable = known !== undefined && known.nextLength === options.messages.length && options.messages.at(-1)?.role === 'user'
    if (key !== undefined && known !== undefined && !resumable) this.sessions.delete(key)

    let resumeId = resumable ? known.cliSession : undefined
    // A CLI session that vanished (deleted or expired) is retried once from the full transcript.
    for (;;) {
      const writer = new BlockWriter()
      let failed: LlmFailure | undefined
      let cliSession: string | undefined
      for await (const item of this.run(options, executable, resumeId, writer)) {
        if ('session' in item) cliSession = item.session
        else if ('failure' in item) failed = item.failure
        else yield item.chunk
      }
      if (failed !== undefined && resumeId !== undefined && !writer.wrote && !options.signal?.aborted && key !== undefined) {
        this.sessions.delete(key)
        resumeId = undefined
        continue
      }
      for (const chunk of writer.close()) yield chunk
      if (failed !== undefined) {
        yield options.signal?.aborted ? { type: 'finish', reason: { kind: 'aborted', failure: failed } } : this.failure(failed)
        return
      }
      if (key !== undefined && cliSession !== undefined) this.remember(key, { cliSession, nextLength: options.messages.length + 2 })
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
  }

  private remember(key: string, entry: Resumable): void {
    this.sessions.delete(key)
    this.sessions.set(key, entry)
    if (this.sessions.size > MAX_RESUMABLE_SESSIONS) {
      const oldest = this.sessions.keys().next().value
      if (oldest !== undefined) this.sessions.delete(oldest)
    }
  }

  private failure(failure: LlmFailure): StreamChunk {
    return { type: 'finish', reason: { kind: 'error', failure } }
  }

  /**
   * One CLI run: yields chunks as they arrive, the CLI session id once known,
   * and a failure instead of a finish; the caller writes the finish.
   */
  private async *run(
    options: GenerateOptions, executable: string, resumeId: string | undefined, writer: BlockWriter,
  ): AsyncIterable<{ chunk: StreamChunk } | { session: string } | { failure: LlmFailure }> {
    const signal = options.signal
    const aborted = (): { failure: LlmFailure } => ({ failure: { message: `${this.label}: stopped`, code: 'ABORTED' } })
    if (signal?.aborted) {
      yield aborted()
      return
    }
    const prompt = renderTranscript(options, resumeId !== undefined)
    const invocation = await this.invocation({ executable, model: options.model, prompt, ...resumeId === undefined ? {} : { resumeId } })
    let handle: SubprocessHandle
    try {
      handle = this.host.spawn({
        argv: invocation.argv,
        cwd: invocation.cwd,
        stdio: { stdin: { data: invocation.stdin }, stdout: 'pipe', stderr: { maxBytes: STDERR_MAX_BYTES } },
        graceMs: KILL_GRACE_MS,
        signal,
        ...invocation.env === undefined ? {} : { env: invocation.env },
      })
    } catch (error) {
      await invocation.cleanup?.()
      if (signal?.aborted) yield aborted()
      else yield { failure: { message: `${this.label}: could not start the CLI: ${error instanceof Error ? error.message : String(error)}`, code: 'PROVIDER_UNAVAILABLE' } }
      return
    }
    // Settles even when the caller stops reading early; the child is killed in `finally`.
    const done = handle.done.then(outcome => outcome, (error: unknown) => error instanceof Error ? error : new Error(String(error)))
    let resultError: string | undefined
    let sawResult = false
    try {
      const stdout = handle.stdout
      if (stdout !== undefined) {
        for await (const line of createInterface({ input: stdout, crlfDelay: Infinity })) {
          if (line.trim().length === 0) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch (_notJson) {
            // Banner or warning text between JSON lines.
            continue
          }
          for (const event of this.parseLine(parsed)) {
            switch (event.kind) {
              case 'session': yield { session: event.id }; break
              case 'boundary': for (const chunk of writer.close()) yield { chunk }; break
              case 'text':
              case 'reasoning': for (const chunk of writer.delta(event.kind, event.text)) yield { chunk }; break
              case 'usage': for (const chunk of writer.close()) yield { chunk }; yield { chunk: { type: 'usage', usage: event.usage } }; break
              case 'result': sawResult = true; resultError = event.error; break
            }
          }
        }
      }
      const outcome = await done
      if (signal?.aborted) {
        yield aborted()
        return
      }
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      if (outcome instanceof Error) {
        yield { failure: { message: `${this.label}: ${outcome.message}`, code: 'PROVIDER_UNAVAILABLE' } }
        return
      }
      if (resultError === undefined && outcome.exitCode === 0 && sawResult) return
      yield { failure: this.classify(resultError, stderr, outcome.exitCode) }
    } finally {
      handle.terminate()
      await invocation.cleanup?.()
    }
  }

  /**
   * Text searched for sign-in failures after a failed run.
   * @param resultError - the CLI's failure text, when it reported one.
   * @param stderr - collected stderr.
   * @returns the text to test; subclasses drop lines that name other services' sign-ins.
   */
  protected signInEvidence(resultError: string | undefined, stderr: string): string {
    return `${resultError ?? ''}\n${stderr}`
  }

  private classify(resultError: string | undefined, stderr: string, exitCode: number | null): LlmFailure {
    if (AUTH_TEXT.test(this.signInEvidence(resultError, stderr))) return { message: this.signInMessage, code: LOCAL_CLI_SIGNED_OUT_CODE }
    const lastLine = stderr.split('\n').map(line => line.trim()).filter(line => line.length > 0).at(-1)
    const detail = resultError ?? lastLine ?? `the CLI exited with code ${exitCode ?? 'unknown'} without an answer`
    return { message: `${this.label}: ${detail}`, code: 'PROVIDER_UNAVAILABLE' }
  }
}
