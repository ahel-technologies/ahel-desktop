/** The hosted chat Host half: the account-theme boot row's place in the index table and its canvas colors. */
import { Context } from '@ahel/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@ahel/dsh-host-webserver'
import { apply as applyTheme, type Config as ThemeConfig, type ThemePreference } from '@ahel/dsh-client-ui-theme'
import { apply } from '../src/index.ts'
import { accountThemeStyle } from '../src/boot-account-theme.ts'

/** Collect the table the way an index render does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** ui-theme's live config with a fixed preference. */
function themeConfig(preference: ThemePreference): ThemeConfig {
  return { preference: { get: () => preference }, fontSize: { get: () => 14 } }
}

describe('hosted chat Host half', () => {
  it('pushes one body script after ui-theme\'s prepended rows, whatever the activation order', () => {
    const ctx = new Context()
    apply(ctx)
    applyTheme(ctx, themeConfig('system'))
    const rows = collect(ctx)
    expect(rows.map(row => row.kind)).toEqual(['style', 'script', 'script'])
    expect(rows[1]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(rows[2]).toMatchObject({ kind: 'script', placement: 'body' })
    if (rows[2]?.kind !== 'script') throw new Error('expected the account-theme script row')
    expect(rows[2].text).toContain('ahel\\.theme=(light|dark|system)')
    expect(rows[2].text).not.toContain('</script')
  })

  it.each(['light', 'dark', 'system'] as const)('paints the %s canvas exactly as ui-theme\'s boot style does', (preference) => {
    const ctx = new Context()
    applyTheme(ctx, themeConfig(preference))
    const [style] = collect(ctx)
    if (style?.kind !== 'style') throw new Error('expected ui-theme\'s boot style row')
    expect(accountThemeStyle(preference)).toBe(style.text)
  })
})
