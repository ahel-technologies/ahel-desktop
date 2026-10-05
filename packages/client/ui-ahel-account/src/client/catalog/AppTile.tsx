/** A catalog row's tile: the vendor mark from ahel.ai, or one or two letters on a toned square. */
import { useState } from 'react'
import type { CatalogRowTile } from '@ahel/dsh-ahel-account/types'
import css from './Catalog.module.css'

/**
 * ahel.ai's pale brand marks, painted for dark tiles; the mono library is too.
 * Mirrors ahel's `PALE_BRAND_MARKS` (src/lib/integrations/logo-assets.ts).
 */
const PALE_BRAND_MARKS = new Set([
  'angular', 'ansible', 'anthropic', 'bun', 'curl', 'deno', 'devdotto', 'django', 'flydotio', 'helm', 'ifttt', 'insomnia', 'jest',
  'make', 'mariadb', 'nextdotjs', 'numpy', 'pandas', 'pinterest', 'planetscale', 'prisma', 'railway', 'remix', 'render', 'resend',
  'retool', 'rust', 'sqlite', 'square', 'squarespace', 'threads', 'tiktok', 'unity', 'vercel', 'x',
])

/**
 * Whether a mark was painted for a dark tile and needs darkening on a light one.
 * @param url - absolute mark URL on ahel.ai.
 * @returns true for a mono mark or a listed pale brand mark.
 */
function paleMark(url: string): boolean {
  const match = /\/logos\/(brand|mono)\/([^/]+)\.svg$/.exec(new URL(url).pathname)
  return match !== null && (match[1] === 'mono' || PALE_BRAND_MARKS.has(match[2] ?? ''))
}

/**
 * Render a tile. A mark that fails to load falls back to the letters.
 * @param props.tile - letters, tone and optional mark URL from the listing.
 * @param props.size - edge: `md` for list rows, `lg` for the detail sheet.
 * @returns the decorative tile; the row names the item.
 */
export function AppTile({ tile, size = 'md' }: { tile: CatalogRowTile; size?: 'md' | 'lg' }) {
  const [failed, setFailed] = useState<string | null>(null)
  const mark = tile.mark !== null && tile.mark !== failed ? tile.mark : null
  return (
    <span className={[css.tile, css[`tile-${size}`], mark === null ? css[`tone-${tile.tone}`] : css.tileWithMark].join(' ')}
      aria-hidden="true">
      {mark !== null
        ? <img className={css.tileMark} src={mark} alt="" loading="lazy" data-pale={paleMark(mark) ? '' : undefined}
          onError={() => { setFailed(mark) }} />
        : tile.text.slice(0, 2)}
    </span>
  )
}
