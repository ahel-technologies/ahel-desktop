/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Default model selection supplied by plugin configuration; every field is optional. */
export interface Config {
  /** Registered provider route; omitted until the user picks a default. */
  provider: Volatile<string | undefined>
  /** Provider-owned model id; omitted until the user picks a default. */
  model: Volatile<string | undefined>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Pick the first model the first routable provider advertises. A provider
 * whose catalog fails or is empty is skipped, so one broken route never hides
 * a working one behind it.
 * @param llm - live provider registry.
 * @returns the fallback selection, or undefined when no provider offers a model.
 */
async function firstAdvertisedModel(llm: LlmRuntime): Promise<ModelSelection | undefined> {
  for (const provider of llm.listProviders()) {
    let models: readonly { id: string }[]
    try { models = await llm.listModels(provider.id) }
    catch { continue }
    const first = models[0]
    if (first !== undefined) return { provider: provider.id, model: first.id }
  }
  return undefined
}

/**
 * Owns the default model selection independently of any Host or transport.
 * A configured provider and model win. Without them the default follows the
 * first model of the first registered provider route, so a fresh install
 * becomes usable as soon as the user adds one provider in Settings → Models.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()
  /** Last discovered fallback; refreshed on every provider topology change. */
  private fallback: ModelSelection | undefined
  /** Latest discovery wins; an older answer never overwrites a newer one. */
  private discovery = 0

  static Config = z.object({
    provider: z.string().volatile(),
    model: z.string().volatile(),
    reasoningEffort: z.string().volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
    ownerContext.inject(['llm'], (child) => {
      child.on('llm/adapters-updated', () => { void this.refreshFallback(child.llm) })
      void this.refreshFallback(child.llm)
      child.effect(() => () => {
        ++this.discovery
        this.fallback = undefined
      })
    })
  }

  /** The configured selection, or undefined while provider or model is unset. */
  private configuredSelection(): ModelSelection | undefined {
    const provider = this.config.provider.get()
    const model = this.config.model.get()
    if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) return undefined
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({ provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } })
  }

  /** Rediscover the fallback; a superseded discovery leaves the cache alone. */
  private async refreshFallback(llm: LlmRuntime): Promise<ModelSelection | undefined> {
    const generation = ++this.discovery
    const found = await firstAdvertisedModel(llm)
    if (generation === this.discovery) this.fallback = found
    return found === undefined ? undefined : { ...found }
  }

  /**
   * Read the current default model selection without waiting for the provider registry.
   * @returns the configured selection, else the last discovered fallback, else undefined.
   */
  currentSelection(): ModelSelection | undefined {
    const configured = this.configuredSelection()
    if (configured !== undefined) return configured
    return this.fallback === undefined ? undefined : { ...this.fallback }
  }

  /**
   * Resolve the default model selection against the live provider registry.
   * Entry points call this before creating an Agent or admitting a prompt, so
   * a provider added since the last topology event is still found.
   * @returns the configured selection, else the first advertised model, else undefined.
   */
  async resolveSelection(): Promise<ModelSelection | undefined> {
    const configured = this.configuredSelection()
    if (configured !== undefined) return configured
    const llm = this.ctx.get('llm')
    return llm === undefined ? this.currentSelection() : this.refreshFallback(llm)
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    const saved = this.saves.then(() => editor.edit(entry, () => config))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
