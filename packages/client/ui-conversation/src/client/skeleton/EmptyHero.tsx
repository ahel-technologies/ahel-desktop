// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  BrandPulse, BrandPulseDot, IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@ahel/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@ahel/dsh-util-workspace-path'
import type { ConversationContentProps } from '../contract/slots.ts'
import { dayOfYear, heroGreeting, heroGreetingBand } from './hero-greeting.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationContentProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseRegular className={css.folder} size={16} />
        : <IconFolderOpenRegular className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationContentProps['renderSlot']
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/** How often the hero checks whether the part of the day changed. */
const GREETING_TICK_MS = 60_000

/**
 * Day of the year with the day starting at 05:00, so one late night keeps one phrase across midnight.
 * @param date - the local moment.
 * @returns the greeting seed.
 */
function greetingDay(date: Date): number {
  return dayOfYear(new Date(date.getTime() - 5 * 3_600_000))
}

/**
 * The moment the greeting was last chosen; it moves only when the part of
 * the day or the date changes, so the headline does not re-render every tick.
 * @returns the greeting's reference time.
 */
function useGreetingClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => {
      const next = new Date()
      setNow(prev => heroGreetingBand(prev.getHours()) === heroGreetingBand(next.getHours())
        && greetingDay(prev) === greetingDay(next) ? prev : next)
    }, GREETING_TICK_MS)
    return () => { clearInterval(timer) }
  }, [])
  return now
}

/**
 * Render the hero chrome (headline only; no composer, no workspace row).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, children }: HeroShellProps) {
  const [hovering, setHovering] = useState(false)
  const now = useGreetingClock()
  const greet = useCallback(
    (name?: string) => heroGreeting({ hour: now.getHours(), name, seed: greetingDay(now) }, t),
    [now, t],
  )
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: mark 34px leading the headline, gap 10. Hover breathes it. */}
          <span
            className={css.markHitbox}
            onMouseEnter={() => {
              if (window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
                setHovering(true)
              }
            }}
            onMouseLeave={() => { setHovering(false) }}
          >
            <BrandPulse size={34} active={hovering}>
              {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.mark }, {
                fallback: <BrandPulseDot />,
              })}
            </BrandPulse>
          </span>
          <span className={css.titleGroup}>
            {/* Own element: keeps the headline text addressable apart from the badge. */}
            <span>{renderSlot('conversation.hero.greeting', { greet }, { fallback: greet() })}</span>
          </span>
        </div>
        {renderSlot('conversation.hero.subhead', {})}
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
