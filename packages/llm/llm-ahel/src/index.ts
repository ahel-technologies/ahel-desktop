/**
 * Ahel-metered models for Ahel Desktop: one OpenAI-compatible route (`ahel`,
 * shown as "Ahel") served by the `dsh-llm-pi-ai` adapter against
 * `https://ahel.ai/api/llm/v1`. The bearer is the signed-in ahel.ai account's
 * access token, read per request from `ctx.ahelAccount` (which refreshes it),
 * so no API key is stored for this route. The route exists only while signed
 * in. The model list comes from `GET <baseURL>/models` (with the selected
 * `?workspace=`) and is re-read on every account change; until it answers 200
 * the menu shows one disabled "connecting" row and the read is retried.
 * Balance (402), availability (403) and sign-in (401) refusals become
 * failures with the codes below, which the Ahel account UI turns into notices.
 *
 * @module @ahel/dsh-llm-ahel
 */

import type { Context } from '@ahel/cordis'
import Schema from '@ahel/schemastery'
import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmAdapter, LlmError } from '@ahel/dsh-llm'
import type {
  AdapterRegistrationHandle, GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo,
  PreparedAdapterCall, ResolvedRetryPolicy, StreamChunk,
} from '@ahel/dsh-llm'
import { PiAiAdapter, resolveProfiles } from '@ahel/dsh-llm-pi-ai'
import type { PiAiAdapterOptions, PiAiModelProfile, ResolvedPiAiProviderProfile } from '@ahel/dsh-llm-pi-ai'
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-agent-default-model'

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

/** Failure code of a 403: Ahel models are not turned on for the workspace. */
export const AHEL_NOT_ENABLED_CODE = 'AHEL_NOT_ENABLED'
/** Failure code of a 401 the account could not recover from by refreshing. */
export const AHEL_SESSION_ENDED_CODE = 'AHEL_SESSION_ENDED'

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
  /** Longest wait between model-list reads while `GET <baseURL>/models` is not 200, in milliseconds; reads back off from 2 s. */
  retryIntervalMs: number
  /** Text of the one disabled model-menu row shown until the model list is read. */
  connectingLabel: string
  /**
   * Model-id prefixes in order of preference for the default chosen after sign-in;
   * the first listed model matching the earliest prefix wins, else the first listed model.
   */
  defaultModels: string[]
}

/** Validated configuration. */
export const Config = Schema.object({
  baseURL: Schema.string().default('https://ahel.ai/api/llm/v1'),
  provider: Schema.string().pattern(/^[a-z][a-z0-9-]*$/).default('ahel'),
  displayName: Schema.string().default('Ahel'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  retryIntervalMs: Schema.number().min(1_000).max(3_600_000).default(30_000),
  connectingLabel: Schema.string().default('Ahel (connecting…)'),
  defaultModels: Schema.array(Schema.string()).default(['anthropic/claude-sonnet', 'anthropic/claude', 'openai/gpt-5', 'google/gemini']),
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
 * @param baseURL - proxy base URL.
 * @param bearer - account access token.
 * @param workspace - selected workspace id, sent as `?workspace=`.
 * @param timeoutMs - request deadline.
 * @returns the listed models, or undefined when the endpoint is missing, refuses, or lists none.
 */
async function fetchModels(
  baseURL: string, bearer: string, workspace: string | undefined, timeoutMs: number,
): Promise<AhelModel[] | undefined> {
  const url = new URL(`${baseURL}/models`)
  if (workspace !== undefined) url.searchParams.set('workspace', workspace)
  const response = await fetch(url, {
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
 * Turn the proxy's balance, availability and sign-in refusals into coded
 * failures. The OpenAI SDK reports them as `<status> <server message>`; the
 * server message is kept for the session log, the client shows its own copy
 * per code: `ACCOUNT_QUOTA` (402), `AHEL_NOT_ENABLED` (403), `AHEL_SESSION_ENDED` (401).
 * @param failure - failure from the pi-ai stream.
 * @returns the same failure, or a coded Ahel one for 401, 402 and 403.
 */
export function readableFailure(failure: LlmFailure): LlmFailure {
  const match = /^\s*(40[123])\b\s*(.*)$/s.exec(failure.message)
  if (match === null) return failure
  const status = Number(match[1])
  const server = serverSentence(match[2] ?? '')
  switch (status) {
    case 402:
      return { ...failure, status, code: ACCOUNT_QUOTA_EXCEEDED_CODE, message: `Ahel models: ${server ?? 'the workspace balance or today\'s Ahel model limit is used up.'} Add money on ahel.ai, or use your own key in Settings > Models.` }
    case 403:
      return { ...failure, status, code: AHEL_NOT_ENABLED_CODE, message: `Ahel models are not available: ${server ?? 'they are not turned on for this workspace yet.'} Use your own key in Settings > Models meanwhile.` }
    default:
      return { ...failure, status, code: AHEL_SESSION_ENDED_CODE, message: 'Your Ahel sign-in has ended. Sign in to Ahel again.' }
  }
}

async function* readableStream(stream: AsyncIterable<StreamChunk>, unauthorized: () => Promise<void>): AsyncIterable<StreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      const failure = readableFailure(chunk.reason.failure)
      // A refused bearer gets one refresh; a refused refresh signs out, which returns Desktop to its welcome.
      if (failure.code === AHEL_SESSION_ENDED_CODE) await unauthorized()
      yield { ...chunk, reason: { kind: 'error', failure } }
    } else {
      yield chunk
    }
  }
}

/** Delegates to the pi-ai adapter and rewrites Ahel refusals in its streams; refuses every call until the model list is read. */
class AhelAdapter extends LlmAdapter {
  constructor(
    private readonly inner: PiAiAdapter,
    private readonly displayName: string,
    private readonly connecting: () => string | undefined,
    private readonly unauthorized: () => Promise<void>,
  ) { super() }
  private ready(): void {
    const label = this.connecting()
    if (label !== undefined) throw new LlmError(label, 'PROVIDER_UNAVAILABLE')
  }
  override providerInfo(provider: string): LlmProviderInfo { return { id: provider, name: this.displayName } }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined { return this.inner.providerRetryPolicy(provider) }
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.ready()
    return this.inner.listModels(provider)
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    this.ready()
    return this.inner.resolveModel(provider, model, signal)
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    this.ready()
    const prepared = await this.inner.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => readableStream(prepared.stream(options), this.unauthorized) }
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return readableStream(this.inner.stream(options), this.unauthorized) }
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
 * Register the Ahel route while signed in and keep its model list current.
 * Until `GET <baseURL>/models` answers 200 the route lists no model and the
 * model menu shows one disabled "connecting" row; the read backs off up to
 * `retryIntervalMs`. Models keep the server's order. Once models are listed
 * and no default model is saved, the first model matching `defaultModels`
 * becomes the default unless another provider route (a bring-your-own key)
 * is configured; signing out removes a saved Ahel default.
 * @param ctx - plugin context with `llm` and `ahelAccount`.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const baseURL = config.baseURL.replace(/\/+$/, '')
  let models: readonly AhelModel[] | undefined
  let profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  type Profiles = ReadonlyMap<string, ResolvedPiAiProviderProfile>
  const build = (list: readonly AhelModel[], workspace: string | undefined): Profiles => resolveProfiles({
    [config.provider]: {
      displayName: config.displayName,
      api: 'openai-completions',
      baseURL,
      ...workspace === undefined ? {} : { headers: { 'X-Ahel-Workspace': workspace } },
      models: list.map((model): PiAiModelProfile => ({
        id: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      })),
    },
  })
  const adapter = new AhelAdapter(new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      const token = await ctx.ahelAccount.accessToken()
      if (token === undefined) throw new LlmError('Sign in to Ahel to use Ahel models, or pick a model with your own key.', 'MISSING_CREDENTIAL')
      return token
    },
    auth: NO_AMBIENT_AUTH,
  }), config.displayName, () => models === undefined ? config.connectingLabel : undefined, async () => {
    try {
      await ctx.ahelAccount.revalidate()
    } catch (error) {
      ctx.logger.warn(`llm-ahel: the Ahel sign-in could not be refreshed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  let route: AdapterRegistrationHandle | undefined
  let published = ''
  /** Announce the route (or its absence) only when what the model menu shows changes. */
  const publish = (signedIn: boolean): void => {
    const shown = signedIn ? JSON.stringify(models?.map(model => model.id) ?? null) : ''
    if (route === undefined || shown === published) return
    published = shown
    route.replace(signedIn ? [config.provider] : [])
  }
  ctx.effect(() => {
    const handle = ctx.llm.registerAdapter([config.provider], adapter)
    route = handle
    published = 'null'
    return () => { route = undefined; handle() }
  }, 'llm-ahel.route')

  const chooseDefault = async (list: readonly AhelModel[]): Promise<void> => {
    const defaults = ctx.get('agentDefaultModel')
    const preferred = config.defaultModels.map(prefix => list.find(model => model.id.startsWith(prefix))).find(model => model !== undefined)
    const chosen = preferred ?? list[0]
    if (defaults === undefined || chosen === undefined || defaults.configuredSelection() !== undefined) return
    if (ctx.llm.listProviders().some(provider => provider.id !== config.provider)) return
    await defaults.saveSelection({ provider: config.provider, model: chosen.id })
  }
  /** A saved Ahel default names a route that no longer exists once signed out. */
  const dropDefault = async (): Promise<void> => {
    const defaults = ctx.get('agentDefaultModel')
    if (defaults?.configuredSelection()?.provider === config.provider) await defaults.clearSelection()
  }

  let generation = 0
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async (): Promise<void> => {
    const current = ++generation
    clearTimeout(timer)
    timer = undefined
    const token = await ctx.ahelAccount.accessToken()
    if (current !== generation) return
    if (token === undefined) {
      models = undefined
      profiles = new Map()
      publish(false)
      await dropDefault()
      return
    }
    // The menu and composer show "connecting" while the first read is in flight.
    if (models === undefined) publish(true)
    const workspace = await ctx.ahelAccount.workspace()
    let listed: AhelModel[] | undefined
    try {
      listed = await fetchModels(baseURL, token, workspace, config.requestTimeoutMs)
    } finally {
      if (current === generation && listed === undefined) {
        models = undefined
        profiles = new Map()
        publish(true)
        // A list that is late by seconds after sign-in arrives within seconds; a missing endpoint settles at the interval.
        timer = setTimeout(refreshLogged, Math.min(config.retryIntervalMs, 2_000 * 2 ** failures++))
      }
    }
    if (current !== generation || listed === undefined) return
    failures = 0
    models = listed
    profiles = build(listed, workspace)
    publish(true)
    await chooseDefault(listed)
  }
  const refreshLogged = (): void => {
    refresh().catch((error: unknown) => {
      ctx.logger.warn(`llm-ahel: model list unavailable, retrying: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  ctx.effect(() => () => { ++generation; clearTimeout(timer) }, 'llm-ahel.model-list')
  ctx.on('ahel-account/changed', (view) => {
    if (view.attempt === null || view.attempt.phase === 'succeeded' || view.status === 'signed-out') {
      failures = 0
      refreshLogged()
    }
  })
  refreshLogged()
}
