/** A catalog row's tile, as ahel.ai's DiscoverRow draws it: the vendor mark on a light plate, or one or two letters. */
import { useState } from 'react'
import type { CatalogRowTile } from '@ahel/dsh-ahel-account/types'
import css from './Catalog.module.css'

/**
 * ahel.ai's pale brand marks, painted for dark grounds; the mono library is too.
 * Mirrors ahel's `PALE_BRAND_MARKS` (src/lib/integrations/logo-assets.ts).
 */
const PALE_BRAND_MARKS = new Set([
  'angular', 'ansible', 'anthropic', 'bun', 'curl', 'deno', 'devdotto', 'django', 'flydotio', 'helm', 'ifttt', 'insomnia', 'jest',
  'make', 'mariadb', 'nextdotjs', 'numpy', 'pandas', 'pinterest', 'planetscale', 'prisma', 'railway', 'remix', 'render', 'resend',
  'retool', 'rust', 'sqlite', 'square', 'squarespace', 'threads', 'tiktok', 'unity', 'vercel', 'x',
])

/**
 * Whether a mark was painted for a dark ground and needs darkening on the light plate.
 * @param url - absolute mark URL on ahel.ai.
 * @returns true for a mono mark or a listed pale brand mark.
 */
function paleMark(url: string): boolean {
  const match = /\/logos\/(brand|mono)\/([^/]+)\.svg$/.exec(new URL(url).pathname)
  return match !== null && (match[1] === 'mono' || PALE_BRAND_MARKS.has(match[2] ?? ''))
}

/**
 * Render a tile: ahel's light plate with the vendor mark, or its letters on the plate's tone.
 * A mark that fails to load falls back to the letters.
 * @param props.tile - letters, tone and optional mark URL from the listing.
 * @param props.size - edge: `sm` 32px for nested rows, `md` 44px for rows, `lg` 76px for the detail sheet.
 * @returns the decorative tile; the row names the item.
 */
export function AppTile({ tile, size = 'md' }: { tile: CatalogRowTile; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState<string | null>(null)
  const mark = tile.mark !== null && tile.mark !== failed ? tile.mark : null
  const sized = size === 'sm' ? css.tileSm : size === 'lg' ? css.tileLg : ''
  return (
    <span className={`${css.tile} ${sized}`} data-tone={mark === null ? tile.tone : undefined} aria-hidden="true">
      {mark !== null
        ? <img className={css.tileMark} src={mark} alt="" loading="lazy" data-pale={paleMark(mark) ? '' : undefined}
          onError={() => { setFailed(mark) }} />
        : <span className={css.tileText}>{tile.text.slice(0, 2)}</span>}
    </span>
  )
}
