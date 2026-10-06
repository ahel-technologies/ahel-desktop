/** One-key presets: Connect lists the endpoint's models, writes the profile, then stores the key. */
import { describe, expect, it, vi } from 'vitest'
import { connectPreset, PROVIDER_PRESETS } from '../src/client/presets.ts'
import type { ModelsOperations } from '../src/client/operations.ts'

function fakeOperations() {
  const store = vi.fn((_ref: string, _value: string) => Promise.resolve(undefined))
  const write = vi.fn(() => Promise.resolve({ kind: 'written' as const, view: {} as never }))
  const discover = vi.fn(() => Promise.resolve({
    kind: 'found' as const,
    models: [{ id: 'zai-org-glm-5-2', name: 'GLM 5.2', inputModalities: ['text' as const] }],
  }))
  const operations: ModelsOperations = {
    describeCredential: vi.fn(),
    storeCredential: store,
    removeCredential: vi.fn(),
    writeSettings: write,
    discoverModels: discover,
  }
  return { operations, store, write, discover }
}

describe('provider presets', () => {
  it('connects Venice with its endpoint, models, body field, and key', async () => {
    const venice = PROVIDER_PRESETS.find(preset => preset.route === 'venice')
    if (venice === undefined) throw new Error('no Venice preset')
    const { operations, store, write, discover } = fakeOperations()

    await expect(connectPreset(venice, 'fake-key', operations, 3, 'none')).resolves.toBeUndefined()

    expect(discover).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://api.venice.ai/api/v1', api: 'openai-completions', apiKey: 'fake-key',
    })
    expect(write).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'venice'],
      value: {
        displayName: 'Venice',
        apiKeyEnv: 'VENICE_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://api.venice.ai/api/v1',
        compat: { supportsStore: false, supportsDeveloperRole: false },
        models: [{ id: 'zai-org-glm-5-2', name: 'GLM 5.2', input: ['text'] }],
        body: { venice_parameters: { include_venice_system_prompt: false } },
      },
    }], 3)
    expect(store).toHaveBeenCalledWith('VENICE_API_KEY', 'fake-key')
  })

  it('connects OpenRouter on its catalog with the attribution headers and no listing', async () => {
    const openrouter = PROVIDER_PRESETS.find(preset => preset.route === 'openrouter')
    if (openrouter === undefined) throw new Error('no OpenRouter preset')
    const { operations, store, write, discover } = fakeOperations()

    await expect(connectPreset(openrouter, 'fake-key', operations, 0, 'none')).resolves.toBeUndefined()

    expect(discover).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'openrouter'],
      value: {
        displayName: 'OpenRouter',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        headers: { 'HTTP-Referer': 'https://ahel.ai', 'X-Title': 'Ahel Desktop' },
      },
    }], 0)
    expect(store).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'fake-key')
  })

  it('connects OrcaRouter to its OpenAI-compatible endpoint', async () => {
    const orca = PROVIDER_PRESETS.find(preset => preset.route === 'orcarouter')
    if (orca === undefined) throw new Error('no OrcaRouter preset')
    const { operations, store, discover } = fakeOperations()

    await expect(connectPreset(orca, 'fake-key', operations, 0, 'none')).resolves.toBeUndefined()

    expect(discover).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://api.orcarouter.ai/v1', api: 'openai-completions', apiKey: 'fake-key',
    })
    expect(store).toHaveBeenCalledWith('ORCAROUTER_API_KEY', 'fake-key')
  })
})
