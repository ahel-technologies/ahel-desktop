/**
 * Sidebar glyphs: a checklist square for Issues with the count of open
 * issues assigned to the person, and a pen on a square for New issue. Both
 * are drawn on the library's 16px grid at its one-pixel stroke and ride
 * currentColor, like every other panel glyph.
 */
import type { ReactNode } from 'react'
import type { IssuesPanelIconProps } from './contract.ts'
import css from './Issues.module.css'

/**
 * Render the Issues glyph and badge; the badge hides at zero and caps at 9+.
 * @param props - the sidebar's icon share and the Issues face.
 * @returns the decorative glyph and badge.
 */
export function IssuesPanelIcon({ size, useIssues }: IssuesPanelIconProps): ReactNode {
  const count = useIssues(value => value.mine)
  return (
    <span className={css.glyph}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <path d="m5 6 1 1 2-2" />
        <path d="M9.5 6.5H11" />
        <path d="M5 10.2h6" />
      </svg>
      {count > 0 && <span className={css.badge}>{count > 9 ? '9+' : count}</span>}
    </span>
  )
}

/**
 * Render the New issue glyph.
 * @param props - the sidebar's icon share.
 * @returns the decorative glyph.
 */
export function NewIssuePanelIcon({ size }: IssuesPanelIconProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 2.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V7.5" />
      <path d="m12 2.2 1.8 1.8L8.4 9.4 6 10l.6-2.4z" />
    </svg>
  )
}
