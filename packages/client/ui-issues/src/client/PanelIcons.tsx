/**
 * Sidebar glyph: a checklist square for Issues with the count of open issues
 * assigned to the person, drawn on the library's 16px grid at its one-pixel
 * stroke and riding currentColor, like every other panel glyph.
 */
import type { ReactNode } from 'react'
import type { IssuesPanelIconProps } from './contract.ts'
import css from './Issues.module.css'

/**
 * Render the Issues glyph and badge; the badge hides at zero and caps at 9+.
 * In the wide column it is a pill at the row's trailing edge (the glyph
 * wrapper is unpositioned there, so the sidebar row is the pill's containing
 * block); in the rail it rides the glyph's corner.
 * @param props - the sidebar's icon share and the Issues face.
 * @returns the decorative glyph and badge.
 */
export function IssuesPanelIcon({ size, wide, useIssues }: IssuesPanelIconProps): ReactNode {
  const count = useIssues(value => value.mine)
  return (
    <span className={wide === true ? css.glyphWide : css.glyph}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <path d="m5 6 1 1 2-2" />
        <path d="M9.5 6.5H11" />
        <path d="M5 10.2h6" />
      </svg>
      {count > 0 && <span className={wide === true ? css.trailingBadge : css.badge}>{count > 9 ? '9+' : count}</span>}
    </span>
  )
}
