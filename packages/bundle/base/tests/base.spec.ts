/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list holding the chat core only.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Row { id?: string; name?: string; config?: Record<string, unknown>; disabled?: unknown }

interface Manifest { dependencies?: Record<string, string>; dsh?: { bundle?: { patch?: string } } }

function readBundle(): { manifest: Manifest; rows: Row[]; text: string } {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Manifest
  const text = readFileSync(resolve(root, manifest.dsh?.bundle?.patch ?? 'missing'), 'utf8')
  const parsed = yaml.load(text, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
  const rows = (parsed as { insert?: Row[] }[]).flatMap(patch => patch.insert ?? [])
  return { manifest, rows, text }
}

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const { manifest, rows } = readBundle()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({ config: { root: [] } })
    expect(rows.find(row => row.id === 'llm-pi-ai')).toBeDefined()
    expect(rows.find(row => row.id === 'mcp-resources')).toBeDefined()
  })

  it('pins no default model provider', () => {
    const { rows } = readBundle()
    expect(rows.find(row => row.id === 'agent-default-model')?.config).toBeUndefined()
  })

  it('mounts no local agent tools, telemetry, or DeepSeek services', () => {
    const { manifest, rows, text } = readBundle()
    for (const id of ['tool-bash', 'tool-pwsh', 'tool-fs', 'subprocess', 'sandbox', 'subagent', 'ptc-runtime', 'tool-web', 'otel', 'session-telemetry-otel', 'skill', 'jobs']) {
      expect(rows.find(row => row.id === id), id).toBeUndefined()
    }
    expect(text.toLowerCase()).not.toContain('deepseeksvc')
    expect(text).not.toMatch(/deepseek-(official|account|llm|api)/)
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      expect(name).not.toMatch(/deepseek-account|llm-deepseek|deepseek-llm|session-log-deepseek|inventory-deepseek|search-deepseek|otel/)
    }
  })
})
