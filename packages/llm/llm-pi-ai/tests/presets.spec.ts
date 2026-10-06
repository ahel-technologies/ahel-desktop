/**
 * The profiles the Models page's one-key presets write (Venice, OpenRouter,
 * OrcaRouter), sent against a local stand-in with a fake key: endpoint path,
 * auth and attribution headers, model id, and provider body fields.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import LlmRuntime from '@ahel/dsh-llm'
import { PiAiAdapter } from '@ahel/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@ahel/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { resolveProfiles } from '../src/config.ts'
import { discoverModels } from '../src/discovery.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

const FAKE_KEY = 'fake-preset-key'
const GATEWAY_COMPAT = { supportsStore: false, supportsDeveloperRole: false }

async function send(route: string, profile: PiAiProviderProfile, model: string): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter([route], new PiAiAdapter({
    profiles: () => resolveProfiles({ [route]: profile }),
    resolveApiKey: () => Promise.resolve(FAKE_KEY),
    auth: memoryAuth(),
  }))
  await assemble(ctx, { provider: route, model, messages: [] })
}

describe('provider presets', () => {
  it('venice: chat completions with the Venice system prompt off', async () => {
    const server = await mockServer([{ events: textEvents }])
    await send('venice', {
      displayName: 'Venice',
      apiKeyEnv: 'VENICE_API_KEY',
      api: 'openai-completions',
      baseURL: `${server.url}/api/v1`,
      compat: GATEWAY_COMPAT,
      models: [{ id: 'zai-org-glm-5-2', name: 'GLM 5.2' }],
      body: { venice_parameters: { include_venice_system_prompt: false } },
    }, 'zai-org-glm-5-2')
    expect(server.paths).toEqual(['/api/v1/chat/completions'])
    expect(server.headers[0]?.authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(server.requests[0]).toMatchObject({
      model: 'zai-org-glm-5-2',
      stream: true,
      venice_parameters: { include_venice_system_prompt: false },
    })
    expect(server.requests[0]).not.toHaveProperty('store')
  })

  it('openrouter: the catalog route with the Ahel attribution headers', async () => {
    const server = await mockServer([{ events: textEvents }])
    const model = getBuiltinModels('openrouter').find(entry => entry.api === 'openai-completions')
    if (model === undefined) throw new Error('pi-ai ships no OpenRouter chat model')
    await send('openrouter', {
      displayName: 'OpenRouter',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      // The preset keeps the catalog endpoint; only the stand-in replaces it here.
      baseURL: server.url,
      headers: { 'HTTP-Referer': 'https://ahel.ai', 'X-Title': 'Ahel Desktop' },
    }, model.id)
    expect(server.paths).toEqual(['/chat/completions'])
    expect(server.headers[0]?.authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(server.headers[0]?.['http-referer']).toBe('https://ahel.ai')
    expect(server.headers[0]?.['x-title']).toBe('Ahel Desktop')
    expect(server.requests[0]).toMatchObject({ model: model.id, stream: true })
  })

  it('orcarouter: chat completions on the namespaced model id', async () => {
    const server = await mockServer([{ events: textEvents }])
    await send('orcarouter', {
      displayName: 'OrcaRouter',
      apiKeyEnv: 'ORCAROUTER_API_KEY',
      api: 'openai-completions',
      baseURL: `${server.url}/v1`,
      compat: GATEWAY_COMPAT,
      models: [{ id: 'anthropic/claude-sonnet-5' }],
    }, 'anthropic/claude-sonnet-5')
    expect(server.paths).toEqual(['/v1/chat/completions'])
    expect(server.headers[0]?.authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(server.requests[0]).toMatchObject({ model: 'anthropic/claude-sonnet-5', stream: true })
  })

  it('lists Venice and OrcaRouter chat models only, Venice default first', async () => {
    const server = await mockServer([{
      body: JSON.stringify({
        data: [
          { id: 'qwen-3-8-max', type: 'text', model_spec: { name: 'Qwen 3.8 Max', availableContextTokens: 1_000_000, maxCompletionTokens: 131_072, capabilities: { supportsFunctionCalling: true, supportsVision: false }, traits: [] } },
          { id: 'hermes-3-llama-3.1-405b', type: 'text', model_spec: { capabilities: { supportsFunctionCalling: false } } },
          { id: 'zai-org-glm-5-2', type: 'text', model_spec: { name: 'GLM 5.2', capabilities: { supportsFunctionCalling: true, supportsVision: true }, traits: ['default'] } },
          { id: 'flux-2', type: 'image' },
          { id: 'openai/gpt-image-1', supported_endpoint_types: ['image-generation'] },
        ],
      }),
    }])
    const models = await discoverModels({ baseURL: server.url, api: 'openai-completions', apiKey: FAKE_KEY })
    expect(server.paths).toEqual(['/models'])
    expect(models).toEqual([
      { id: 'zai-org-glm-5-2', name: 'GLM 5.2', inputModalities: ['text', 'image'] },
      { id: 'qwen-3-8-max', name: 'Qwen 3.8 Max', contextWindow: 1_000_000, maxTokens: 131_072, inputModalities: ['text'] },
    ])
  })
})
