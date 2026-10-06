/** Brand-neutral activity mark: a slotted brand mark, or a neutral dot, breathing on a 1.2s cycle. */
import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'
import css from './BrandPulse.module.css'

/** Props for {@link BrandPulse}. */
export interface BrandPulseProps {
  /** The mark to animate, usually a brand slot's output; omitted renders {@link BrandPulseDot}. */
  children?: ReactNode
  /** Square edge in px (default 14). */
  size?: number | undefined
  /** Whether the mark breathes; false holds it still. Reduced motion always holds it still. */
  active?: boolean | undefined
  className?: string | undefined
}

/**
 * The neutral stand-in mark: a small dot in the tertiary label ink.
 * @returns the decorative dot.
 */
export function BrandPulseDot() {
  return <span className={css.dot} data-brand-pulse-dot="" />
}

/**
 * Render an activity mark that gently scales and fades while active.
 * Callers pass the brand mark from their slot so this primitive carries no brand.
 * @param props - see {@link BrandPulseProps}.
 * @returns the decorative mark box (aria-hidden; pair it with a text status).
 */
export function BrandPulse({ children, size = 14, active = true, className }: BrandPulseProps) {
  return (
    <span
      className={clsx(css.root, className)}
      style={{ '--brand-pulse-size': `${String(size)}px` } as CSSProperties}
      data-brand-pulse={active ? 'active' : 'still'}
      aria-hidden="true"
    >
      {children ?? <BrandPulseDot />}
    </span>
  )
}
