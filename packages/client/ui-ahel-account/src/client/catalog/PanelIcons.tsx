/**
 * Sidebar row glyphs for this package's panels: a four-tile grid for Discover,
 * a stack of tiles for Your apps, a checked shield for Approvals and a tray for
 * the Inbox. All are drawn on the library's 16px grid at
 * its one-pixel Regular stroke and ride currentColor, so the sidebar's row
 * states color them like every other panel glyph.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type { ApprovalsPanelIconProps, InboxPanelIconProps } from '../team/contract.ts'
import team from '../team/Team.module.css'

/**
 * Render the Discover grid at the size the sidebar asks for.
 * @param props - the sidebar's icon share.
 * @returns the decorative glyph.
 */
export function DiscoverPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1.2" />
    </svg>
  )
}

/**
 * Render the Your apps tile stack at the size the sidebar asks for.
 * @param props - the sidebar's icon share.
 * @returns the decorative glyph.
 */
export function AppsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="11" height="7" rx="1.6" />
      <path d="M4 4.5h8" />
      <path d="M5.5 2.5h5" />
    </svg>
  )
}

/**
 * Render the Approvals shield-and-check glyph with the count of held calls
 * waiting for a yes; the badge hides at zero and caps at 9+. In the wide column
 * it is a pill at the row's trailing edge, in the rail it rides the glyph's corner.
 * @param props - the sidebar's icon share and the Approvals face.
 * @returns the decorative glyph and badge.
 */
export function ApprovalsPanelIcon({ size, wide, useSummary }: ApprovalsPanelIconProps): ReactNode {
  const count = useSummary(value => value.summary?.approvals?.rows.length ?? 0)
  return (
    <span className={team.glyph}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 2.2 13 4v4c0 2.9-2.1 5-5 5.8C5.1 13 3 10.9 3 8V4z" />
        <path d="m5.8 8 1.5 1.5 3-3" />
      </svg>
      {count > 0 && <span className={wide === true ? team.trailingBadge : team.badge}>{count > 9 ? '9+' : count}</span>}
    </span>
  )
}

/**
 * Render the Inbox tray glyph with the count of unread handoffs; the badge
 * hides at zero, caps at 9+ and sits like the Approvals badge.
 * @param props - the sidebar's icon share and the Inbox face.
 * @returns the decorative glyph and badge.
 */
export function InboxPanelIcon({ size, wide, useSummary }: InboxPanelIconProps): ReactNode {
  const count = useSummary(value => value.summary?.inbox?.unread ?? 0)
  return (
    <span className={team.glyph}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 9.5 4.2 4a1.4 1.4 0 0 1 1.3-1h5a1.4 1.4 0 0 1 1.3 1l1.7 5.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12z" />
        <path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" />
      </svg>
      {count > 0 && <span className={wide === true ? team.trailingBadge : team.badge}>{count > 9 ? '9+' : count}</span>}
    </span>
  )
}
