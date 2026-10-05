/**
 * Ahel-metered models for Ahel Desktop: one OpenAI-compatible route (`ahel`,
 * shown as "Ahel") served by the `dsh-llm-pi-ai` adapter against
 * `https://ahel.ai/api/llm/v1`. The bearer is the signed-in ahel.ai account's
 * access token, read per request from `ctx.ahelAccount` (which refreshes it),
 * so no API key is stored for this route. The model list comes from
 * `GET <baseURL>/models` and is re-read on every account change; while that
 * endpoint is missing or unreadable, the configured fallback list serves.
 * Balance (402) and availability (403) refusals become readable errors.
 *
 * @module @deepseek-ai/dsh-llm-ahel
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions, PiAiModelProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-ahel-account'

/** Cordis plugin name. */
export const name = 'llm-ahel'
/** Services required by this plugin. */
export const inject = ['llm', 'ahelAccount']

/** One model served on the Ahel route. */
export interface AhelModel {
  /** OpenRouter-style model id, e.g. `anthropic/claude-sonnet-5.5`. */
  id: string
  /** Display name. */
  name: string
  /** Context window in tokens. */
  contextWindow: number
  /** Largest output in tokens. */
  maxTokens: number
}

/** Deployment choices for the Ahel route. */
export interface Config {
  /** OpenAI-compatible base URL of the metered proxy. */
  baseURL: string
  /** Route key models are selected under. */
  provider: string
  /** Name shown by model pickers. */
  displayName: string
  /** Deadline for the model-list request in milliseconds. */
  requestTimeoutMs: number
  /** Models served while `GET <baseURL>/models` is missing or unreadable. */
  fallbackModels: AhelModel[]
}

const Model: Schema<AhelModel> = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  contextWindow: Schema.number().min(1024).required(),
  maxTokens: Schema.number().min(1).required(),
})

/** Validated configuration. */
export const Config = Schema.object({
  baseURL: Schema.string().default('https://ahel.ai/api/llm/v1'),
  provider: Schema.string().pattern(/^[a-z][a-z0-9-]*$/).default('ahel'),
  displayName: Schema.string().default('Ahel'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  fallbackModels: Schema.array(Model).default([
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextWindow: 1_000_000, maxTokens: 32_768 },
    { id: 'openai/gpt-5.6', name: 'GPT-5.6', contextWindow: 400_000, maxTokens: 32_768 },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_048_576, maxTokens: 32_768 },
  ]),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

/**
 * Parse an OpenAI-style model list (`{ data: [{ id, name, context_length, max_output_tokens }] }`).
 * @param body - response JSON.
 * @returns the models, or undefined when the body lists none.
 */
export function parseModelList(body: unknown): AhelModel[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined
  const models = body.data.filter(isRecord).flatMap((row): AhelModel[] => {
    if (typeof row.id !== 'string' || row.id.length === 0) return []
    return [{
      id: row.id,
      name: typeof row.name === 'string' && row.name.length > 0 ? row.name : row.id,
      contextWindow: positive(row.context_length) ?? positive(row.context_window) ?? 128_000,
      maxTokens: positive(row.max_output_tokens) ?? positive(row.max_tokens) ?? 8_192,
    }]
  })
  return models.length === 0 ? undefined : models
}

/**
 * Read `GET <baseURL>/models` with the account bearer.
 * @returns the listed models, or undefined when the endpoint is missing, refuses, or lists none.
 */
async function fetchModels(baseURL: string, bearer: string, timeoutMs: number): Promise<AhelModel[] | undefined> {
  const response = await fetch(`${baseURL}/models`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    await response.body?.cancel()
    return undefined
  }
  return parseModelList(await response.json())
}

const NO_BODY = /^status code \(no body\)$/i

/**
 * The server's own sentence from the text after the status: plain text, or
 * the `message` of a JSON error object (`{ message }` or `{ error: { message } }`).
 * @param detail - error text following the HTTP status.
 * @returns the sentence, or undefined when there is none.
 */
function serverSentence(detail: string): string | undefined {
  const text = detail.replace(/^[\s:]+/, '').trim()
  if (text.length === 0 || NO_BODY.test(text)) return undefined
  if (!text.startsWith('{')) return text
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (_notJson) {
    // Text that only looks like JSON is shown as it is.
    return text
  }
  const inner = isRecord(value) && isRecord(value.error) ? value.error : value
  return isRecord(inner) && typeof inner.message === 'string' && inner.message.length > 0 ? inner.message : undefined
}

/**
 * Turn the proxy's balance and availability refusals into readable failures.
 * The OpenAI SDK reports them as `<status> <server message>`; the server
 * message is kept because ahel.ai writes it for people.
 * @param failure - failure from the pi-ai stream.
 * @returns the same failure, or a readable Ahel one for 401, 402 and 403.
 */
export function readableFailure(failure: LlmFailure): LlmFailure {
  const match = /^\s*(40[123])\b\s*(.*)$/s.exec(failure.message)
  if (match === null) return failure
  const status = Number(match[1])
  const server = serverSentence(match[2] ?? '')
  switch (status) {
    case 402:
      return { ...failure, status, code: QUOTA_EXCEEDED_CODE, message: `Ahel models: ${server ?? 'the workspace balance or today\'s Ahel model limit is used up.'} Add money on ahel.ai, or use your own key in Settings > Models.` }
    case 403:
      return { ...failure, status, code: 'AUTH', message: `Ahel models are not available: ${server ?? 'they are not turned on for this workspace yet.'} Use your own key in Settings > Models meanwhile.` }
    default:
      return { ...failure, status, code: 'AUTH', message: 'Your Ahel sign-in has expired. Sign in to Ahel again.' }
  }
}

async function* readableStream(stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      yield { ...chunk, reason: { kind: 'error', failure: readableFailure(chunk.reason.failure) } }
    } else {
      yield chunk
    }
  }
}

/** Delegates to the pi-ai adapter and rewrites Ahel refusals in its streams. */
class AhelAdapter extends LlmAdapter {
  constructor(private readonly inner: PiAiAdapter) { super() }
  override providerInfo(provider: string): LlmProviderInfo { return this.inner.providerInfo(provider) }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined { return this.inner.providerRetryPolicy(provider) }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> { return this.inner.listModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.inner.resolveModel(provider, model, signal)
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const prepared = await this.inner.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => readableStream(prepared.stream(options)) }
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return readableStream(this.inner.stream(options)) }
}

/** pi-ai auth that never finds a stored or ambient credential, so only the account bearer authenticates. */
const NO_AMBIENT_AUTH: PiAiAdapterOptions['auth'] = {
  credentials: {
    read: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    modify: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(),
  },
  authContext: {
    env: () => Promise.resolve(undefined),
    fileExists: () => Promise.resolve(false),
  },
}

/**
 * Register the Ahel route and keep its model list current.
 * @param ctx - plugin context with `llm` and `ahelAccount`.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const baseURL = config.baseURL.replace(/\/+$/, '')
  const build = (models: readonly AhelModel[]): ReadonlyMap<string, ResolvedPiAiProviderProfile> => resolveProfiles({
    [config.provider]: {
      displayName: config.displayName,
      api: 'openai-completions',
      baseURL,
      models: models.map((model): PiAiModelProfile => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      })),
    },
  })
  let profiles = build(config.fallbackModels)
  const adapter = new AhelAdapter(new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      const token = await ctx.ahelAccount.accessToken()
      if (token === undefined) throw new LlmError('Sign in to Ahel to use Ahel models, or pick a model with your own key.', 'MISSING_CREDENTIAL')
      return token
    },
    auth: NO_AMBIENT_AUTH,
  }))
  ctx.effect(() => ctx.llm.registerAdapter([config.provider], adapter), 'llm-ahel.route')

  let generation = 0
  const refresh = async (): Promise<void> => {
    const current = ++generation
    const token = await ctx.ahelAccount.accessToken()
    const listed = token === undefined ? undefined : await fetchModels(baseURL, token, config.requestTimeoutMs)
    if (current === generation) profiles = build(listed ?? config.fallbackModels)
  }
  const refreshLogged = (): void => {
    refresh().catch((error: unknown) => {
      ctx.logger.warn(`llm-ahel: model list unavailable, serving the fallback list: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.on('ahel-account/changed', (view) => { if (view.attempt === null || view.attempt.phase === 'succeeded' || view.status === 'signed-out') refreshLogged() })
  refreshLogged()
}
