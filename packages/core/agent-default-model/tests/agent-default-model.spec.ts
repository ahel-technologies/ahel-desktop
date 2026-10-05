/** Default model references remain live without a settings service. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import DefaultModel from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

/** Adapter advertising a fixed catalog per provider route; a missing route fails its catalog. */
class CatalogAdapter extends LlmAdapter {
  constructor(private readonly catalogs: Record<string, readonly string[]>) { super() }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const ids = this.catalogs[provider]
    if (ids === undefined) return Promise.reject(new LlmError(`no catalog for ${provider}`, 'INVALID_CATALOG'))
    return Promise.resolve(ids.map(id => ({ provider, id, name: id })))
  }

  override async *stream(): AsyncIterable<StreamChunk> {
    // Default-model tests never enter provider streaming.
  }
}

async function routedContext(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(DefaultModel, {})
  await ctx.fiber.await()
  return ctx
}

it('has no selection when nothing is configured and no provider is routable', async () => {
  const ctx = await routedContext()
  expect(ctx.agentDefaultModel.currentSelection()).toBeUndefined()
  await expect(ctx.agentDefaultModel.resolveSelection()).resolves.toBeUndefined()
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, {})
  expect(standalone.agentDefaultModel.currentSelection()).toBeUndefined()
  await expect(standalone.agentDefaultModel.resolveSelection()).resolves.toBeUndefined()
})

it('falls back to the first model of the first provider that advertises one', async () => {
  const ctx = await routedContext()
  const dispose = ctx.llm.registerAdapter(['broken', 'empty', 'anthropic', 'openai'], new CatalogAdapter({
    empty: [], anthropic: ['claude-sonnet', 'claude-haiku'], openai: ['gpt'],
  }))
  await expect(ctx.agentDefaultModel.resolveSelection()).resolves.toEqual({ provider: 'anthropic', model: 'claude-sonnet' })
  await vi.waitFor(() => {
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'anthropic', model: 'claude-sonnet' })
  })
  dispose()
  await vi.waitFor(() => { expect(ctx.agentDefaultModel.currentSelection()).toBeUndefined() })
})

it('prefers a configured selection over the routed fallback', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['anthropic'], new CatalogAdapter({ anthropic: ['claude-sonnet'] }))
  const live = await liveConfig(ctx, DefaultModel, { provider: 'openai', model: 'gpt' })
  await expect(ctx.agentDefaultModel.resolveSelection()).resolves.toEqual({ provider: 'openai', model: 'gpt' })
  await live.replace({ provider: 'openai' })
  await expect(ctx.agentDefaultModel.resolveSelection()).resolves.toEqual({ provider: 'anthropic', model: 'claude-sonnet' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'anthropic', model: 'claude-sonnet' })
})

it('reads complete selections from volatile config and clears omitted reasoning effort', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm' })
  const consumer = ctx.agentDefaultModel
  await live.update({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  expect(consumer.currentSelection()).toEqual({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  await live.replace({ provider: 'p', model: 'm' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
  await consumer.saveSelection({ provider: 'unsaved', model: 'unsaved' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
})

it('persists complete selections through its owning profile entry', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')
  const { ctx } = await configurationFixture({ hmr: false })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'next', reasoningEffort: ReasoningEffortId('high') })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'next', reasoningEffort: 'high' })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'final' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, { provider: 'test', model: 'original' })
  await standalone.agentDefaultModel.saveSelection({ provider: 'test', model: 'ignored' })
  expect(standalone.agentDefaultModel.currentSelection()?.model).toBe('original')
})

it('serializes overlapping saves and continues after a rejected write', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editor = ctx.configEditor
  const edit = editor.edit.bind(editor)
  const calls: string[] = []
  const intercepted = vi.spyOn(editor, 'edit').mockImplementationOnce(async () => {
    calls.push('rejected')
    entered.resolve(undefined)
    await release.promise
    throw new Error('read-only document')
  }).mockImplementation(async (entry, change) => {
    calls.push('saved')
    await edit(entry, change)
  })
  const first = ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'rejected' })
  const failed = expect(first).rejects.toThrow('read-only document')
  const lastSelection = { provider: 'test', model: 'final' }
  const last = ctx.agentDefaultModel.saveSelection(lastSelection)
  onTestFinished(async () => {
    release.resolve(undefined)
    await Promise.allSettled([failed, last])
    intercepted.mockRestore()
  })
  lastSelection.model = 'mutated'
  await entered.promise
  expect(calls).toEqual(['rejected'])
  release.resolve(undefined)
  await failed
  await last
  expect(calls).toEqual(['rejected', 'saved'])
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
})
