/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@ahel/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('dsh-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@ahel/dsh-sdk-app'],
      ['sdk-jsonrpc-server', '@ahel/dsh-sdk-jsonrpc-server'],
      ['sandbox', '@ahel/dsh-sandbox-local'],
      ['session-projection', '@ahel/dsh-session-projection'],
      ['sandbox-policy', '@ahel/dsh-sandbox-policy'],
      ['subprocess', '@ahel/dsh-subprocess-local'],
      ['pty', '@ahel/dsh-terminal'],
      ['terminal-bash', '@ahel/dsh-terminal-bash'],
      ['terminal-pwsh', '@ahel/dsh-terminal-bash'],
      ['timer', '@ahel/cordis-plugin-timer'],
      ['llm', '@ahel/dsh-llm'],
      ['session', '@ahel/dsh-session'],
      ['session-title', '@ahel/dsh-session-title'],
      ['system-prompt', '@ahel/dsh-system-prompt'],
      ['tools', '@ahel/dsh-tools'],
      ['mcp-resources', '@ahel/dsh-mcp-resources'],
      ['agent', '@ahel/dsh-agent'],
      ['llm-retry', '@ahel/dsh-llm-retry'],
      ['jobs', '@ahel/dsh-jobs-local'],
      ['agent-loop', '@ahel/dsh-agent-loop'],
      ['persistent-bash', '@ahel/dsh-tool-bash-persistent'],
      ['persistent-pwsh', '@ahel/dsh-tool-pwsh-persistent'],
      ['sessions', '@ahel/dsh-session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')).toBeUndefined()
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.DSH_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
