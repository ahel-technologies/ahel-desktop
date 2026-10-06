/**
 * One-key provider presets on the Models page: a route id, its endpoint, and
 * the profile fields the provider needs, so connecting takes only an API key.
 * A preset writes an ordinary `llm-pi-ai` profile; once written the route is
 * edited and deleted like any other row.
 */

import type { JsonValue } from '@ahel/dsh-util-values'
import type { LlmDiscoveredModel } from '@ahel/dsh-api-remotes/client'
import type { ModelsOperations } from './operations.ts'
import { deriveKeyRef } from './store.ts'
import type { en } from './locales.ts'

/** The settings namespace preset routes are written into. */
const NS = 'llm-pi-ai'

/** Attribution OpenRouter shows on its app rankings. */
const OPENROUTER_ATTRIBUTION = { 'HTTP-Referer': 'https://ahel.ai', 'X-Title': 'Ahel Desktop' }

/**
 * Wire switches for an OpenAI-compatible gateway pi-ai does not recognize by
 * URL: no `store` field and no `developer` role, which such gateways reject.
 */
const GATEWAY_COMPAT = { supportsStore: false, supportsDeveloperRole: false }

/** One provider the page connects with a key alone. */
export interface ProviderPreset {
  /** Route id, settings key, and credential stem. */
  route: string
  /** Name on the tile and in model pickers. */
  displayName: string
  /** Letter drawn on the tile. */
  glyph: string
  /** Copy key of the one-line description under the name. */
  blurbKey: keyof typeof en
  /** Page where the user creates a key. */
  keyUrl: string
  /**
   * OpenAI-compatible endpoint whose `GET /models` supplies the route's
   * models. Absent for a route pi-ai ships, whose installed catalog serves.
   */
  baseURL?: string
  /** Request headers the provider asks apps to send. */
  headers?: Record<string, string>
  /** Provider-specific top-level request-body fields. */
  body?: Record<string, JsonValue>
}

/** Presets in tile order. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    route: 'venice',
    displayName: 'Venice',
    glyph: 'V',
    blurbKey: 'presetVeniceBlurb',
    keyUrl: 'https://venice.ai/settings/api',
    baseURL: 'https://api.venice.ai/api/v1',
    // Venice prepends its own system prompt unless told not to; the agent
    // brings its own.
    body: { venice_parameters: { include_venice_system_prompt: false } },
  },
  {
    route: 'openrouter',
    displayName: 'OpenRouter',
    glyph: 'O',
    blurbKey: 'presetOpenRouterBlurb',
    keyUrl: 'https://openrouter.ai/keys',
    headers: OPENROUTER_ATTRIBUTION,
  },
  {
    route: 'orcarouter',
    displayName: 'OrcaRouter',
    glyph: 'O',
    blurbKey: 'presetOrcaRouterBlurb',
    keyUrl: 'https://www.orcarouter.ai/console',
    baseURL: 'https://api.orcarouter.ai/v1',
  },
]

/**
 * The host part of a preset's key page, for the "Get a key at …" link.
 * @param preset - the preset.
 * @returns the host without a leading `www.`.
 */
export function keyHost(preset: ProviderPreset): string {
  return new URL(preset.keyUrl).host.replace(/^www\./, '')
}

/** One model entry of a written profile. */
type PresetModel = Record<string, JsonValue>

function modelOf(candidate: LlmDiscoveredModel): PresetModel {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.inputModalities === undefined ? {} : { input: [...candidate.inputModalities] },
  }
}

/**
 * The `llm-pi-ai` profile one preset writes.
 * @param preset - the preset.
 * @param models - the listed models for an endpoint preset, in listing order; ignored for a catalog preset.
 * @returns the profile for `providers.<route>`.
 */
export function presetProfile(preset: ProviderPreset, models: readonly LlmDiscoveredModel[]): Record<string, JsonValue> {
  return {
    displayName: preset.displayName,
    apiKeyEnv: deriveKeyRef(preset.route),
    ...preset.baseURL === undefined
      ? {}
      : {
        api: 'openai-completions',
        baseURL: preset.baseURL,
        compat: GATEWAY_COMPAT,
        models: models.map(modelOf),
      },
    ...preset.headers === undefined ? {} : { headers: preset.headers },
    ...preset.body === undefined ? {} : { body: preset.body },
  }
}

/**
 * Connect one preset: list an endpoint preset's models with the typed key,
 * write the profile, then store the key under the profile's reference.
 * @param preset - the preset.
 * @param apiKey - the typed key, trimmed.
 * @param operations - the page's Host operations.
 * @param revision - the `llm-pi-ai` user-section revision the card opened at.
 * @param noModels - message when the endpoint lists no usable model.
 * @returns the failure message, or undefined once both writes landed.
 */
export async function connectPreset(
  preset: ProviderPreset,
  apiKey: string,
  operations: ModelsOperations,
  revision: number,
  noModels: string,
): Promise<string | undefined> {
  let models: readonly LlmDiscoveredModel[] = []
  if (preset.baseURL !== undefined) {
    const found = await operations.discoverModels(NS, { baseURL: preset.baseURL, api: 'openai-completions', apiKey })
    if (found.kind !== 'found') return found.message
    if (found.models.length === 0) return noModels
    models = found.models
  }
  const written = await operations.writeSettings(
    NS,
    [{ op: 'set', path: ['providers', preset.route], value: presetProfile(preset, models) }],
    revision,
  )
  if (written.kind !== 'written') return written.message
  return operations.storeCredential(deriveKeyRef(preset.route), apiKey)
}
