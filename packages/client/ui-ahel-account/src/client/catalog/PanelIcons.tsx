/**
 * Sidebar row glyphs for the catalog panels: a four-tile grid for Discover and
 * a stack of tiles for Your apps. Both are drawn on the library's 16px grid at
 * its one-pixel Regular stroke and ride currentColor, so the sidebar's row
 * states color them like every other panel glyph.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-sidebar/client'

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
