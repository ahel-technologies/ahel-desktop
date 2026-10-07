/**
 * Rail glyphs the shared icon set has no match for, drawn on the sidebar's
 * 16px grid at its one-pixel stroke. They show only on the collapsed rail;
 * the wide rail's rows are text, like ahel.ai's own sidebar.
 */
import type { ReactNode } from 'react'

/** A glyph component: square edge in pixels. */
export type Glyph = (props: { size: number }) => ReactNode

/**
 * Wrap stroke paths in the shared 16px frame.
 * @param size - square edge in pixels.
 * @param children - the paths.
 * @returns the decorative glyph.
 */
function frame(size: number, children: ReactNode): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A house: ahel.ai's app home. */
export const HomeGlyph: Glyph = ({ size }) => frame(size, <>
  <path d="M2.5 7.2 8 2.5l5.5 4.7" />
  <path d="M4 6v6.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
  <path d="M6.5 13.5V10h3v3.5" />
</>)

/** A speech bubble: the chat. */
export const ChatGlyph: Glyph = ({ size }) => frame(size, <>
  <path d="M3.5 3h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
</>)

/** Stacked layers: the workspace's apps. */
export const AppsGlyph: Glyph = ({ size }) => frame(size, <>
  <path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5Z" />
  <path d="m2.5 8.5 5.5 3 5.5-3" />
  <path d="m2.5 11 5.5 3 5.5-3" />
</>)

/** A compass: Discover. */
export const DiscoverGlyph: Glyph = ({ size }) => frame(size, <>
  <circle cx="8" cy="8" r="5.5" />
  <path d="m10.2 5.8-1.3 3.1-3.1 1.3 1.3-3.1Z" />
</>)

/** An inbox tray: teammate handoffs and issue rows. */
export const InboxGlyph: Glyph = ({ size }) => frame(size, <>
  <path d="M2.5 9.5 4.2 3.8a1 1 0 0 1 1-.8h5.6a1 1 0 0 1 1 .8l1.7 5.7" />
  <path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3h-3l-1 1.5h-3l-1-1.5Z" />
</>)

/** A door with an arrow leaving it: log out. */
export const LogOutGlyph: Glyph = ({ size }) => frame(size, <>
  <path d="M6.5 13.5h-3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3" />
  <path d="M10.5 11 13.5 8l-3-3" />
  <path d="M13.5 8H6" />
</>)
