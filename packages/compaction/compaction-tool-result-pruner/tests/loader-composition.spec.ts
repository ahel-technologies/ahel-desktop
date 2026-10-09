import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import Loader from '@ahel/cordis-plugin-loader'
import Include from '@ahel/cordis-plugin-include'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import TokenMeter from '@ahel/dsh-token-meter'
import ToolResultPruner from '@ahel/dsh-compaction-tool-result-pruner'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('compaction-tool-result-pruner real Loader composition', () => {
  it('loads and resolves the flat YAML plugin shape', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-compact-tool-result-prune-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@ahel/dsh-session-projection'",
      "- name: '@ahel/dsh-token-meter'",
      "- name: '@ahel/dsh-compaction-tool-result-pruner'",
      '  config:',
      '    thresholdChars: 100',
      '    headChars: 20',
      '    tailChars: 10',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@ahel/dsh-session-projection') return SessionProjectionRegistry
        if (specifier === '@ahel/dsh-token-meter') return TokenMeter
        if (specifier === '@ahel/dsh-compaction-tool-result-pruner') return ToolResultPruner
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.get('toolResultPruner')).toBeInstanceOf(ToolResultPruner)
    expect(context.toolResultPruner.config).toEqual({
      thresholdChars: 100,
      headChars: 20,
      tailChars: 10,
      earlierResults: { enabled: false, thresholdChars: 8192, keepChars: 2048 },
    })
  })

  it('reads the earlier-result knob from the Host environment', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-compact-tool-result-trim-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@ahel/dsh-session-projection'",
      "- name: '@ahel/dsh-token-meter'",
      "- name: '@ahel/dsh-compaction-tool-result-pruner'",
      '  config:',
      '    earlierResults:',
      '      enabled: !!js "process.env.DSH_TRIM_EARLIER_TOOL_RESULTS !== \'off\'"',
      '',
    ].join('\n'))
    const load = async (): Promise<boolean> => {
      const ctx = new Context()
      context = ctx
      ctx.baseUrl = pathToFileURL(root!).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = {
        version: 'v2',
        async import(specifier: string) {
          if (specifier === '@ahel/dsh-session-projection') return SessionProjectionRegistry
          if (specifier === '@ahel/dsh-token-meter') return TokenMeter
          if (specifier === '@ahel/dsh-compaction-tool-result-pruner') return ToolResultPruner
          throw new Error(`unexpected Loader import: ${specifier}`)
        },
      } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      const enabled = ctx.toolResultPruner.config.earlierResults.enabled
      await ctx.fiber.dispose()
      context = undefined
      return enabled
    }
    const previous = process.env.DSH_TRIM_EARLIER_TOOL_RESULTS
    try {
      delete process.env.DSH_TRIM_EARLIER_TOOL_RESULTS
      expect(await load()).toBe(true)
      process.env.DSH_TRIM_EARLIER_TOOL_RESULTS = 'off'
      expect(await load()).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_TRIM_EARLIER_TOOL_RESULTS
      else process.env.DSH_TRIM_EARLIER_TOOL_RESULTS = previous
    }
  })

  it('rejects stale config after plugin schema normalization', async () => {
    context = new Context()
    // Satisfy the declared injections first: config normalization runs in the
    // service constructor, which a pending fiber never reaches.
    await context.plugin(SessionProjectionRegistry)
    await context.plugin(TokenMeter)
    await expect(context.plugin(ToolResultPruner, {
      maxChars: 100,
    } as never)).rejects.toThrow(/unknown key "maxChars"/)
  })
})
