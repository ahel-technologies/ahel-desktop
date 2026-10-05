/** A Knowledge product's tile: ahel.ai's store tile with the product's named glyph, as on ahel.ai/knowledge. */
import type { ReactNode } from 'react'
import css from './Catalog.module.css'

/** ahel.ai's product glyphs, drawn on a 24px grid at its 2px stroke. */
const GLYPHS: Record<string, ReactNode> = {
  'building': (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1" />
      <path d="M10.5 21v-3h3v3" />
    </>
  ),
  'shield-alert': (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M12 8v4.5M12 15.5v.5" />
    </>
  ),
  'gavel': (
    <>
      <path d="M13.5 4.5l6 6M11 7l6 6M12.2 5.8l-2.4 2.4 6 6 2.4-2.4" />
      <path d="M11.5 11.5L4 19" />
      <path d="M3 21h9" />
    </>
  ),
  'bug': (
    <>
      <rect x="7" y="7" width="10" height="13" rx="5" />
      <path d="M9 7.5V6a3 3 0 0 1 6 0v1.5M12 11v9M7 12H3M21 12h-4M7.5 17H4M20 17h-3.5M4 7l3 2.5M20 7l-3 2.5" />
    </>
  ),
}

/**
 * Render a product tile, 48px with a 24px glyph.
 * @param props.glyph - ahel.ai's glyph name; an unknown name draws the building.
 * @returns the decorative tile; the card names the product.
 */
export function KnowledgeTile({ glyph }: { glyph: string }) {
  return (
    <span className={css.cardTile} aria-hidden="true">
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round">
        {GLYPHS[glyph] ?? GLYPHS.building}
      </svg>
    </span>
  )
}
