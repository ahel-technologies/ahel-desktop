/**
 * The blank chat's page header: the eyebrow "Chat", the greeting as the title
 * with the brand red full stop, and one line naming how many apps are ready.
 * The hero's brand mark gives way to it.
 */
import type { ReactNode } from 'react'
import type { BrandHomeLinkProps, HostedGreetingProps, HostedHeroMarkProps, HostedSubtitleProps } from './contract.ts'
import { APP_HOME } from './Rail.tsx'
import css from './Hero.module.css'

/**
 * First name to greet: the first word of ahel.ai's current display name, else of the name captured at sign-in.
 * @param names - candidates, most current first.
 * @returns the name, or undefined when there is none to greet by.
 */
export function firstName(...names: readonly (string | null | undefined)[]): string | undefined {
  for (const name of names) {
    const first = name?.trim().split(/\s+/)[0]
    if (first !== undefined && first !== '') return first
  }
  return undefined
}

/**
 * Render the greeting as a page header.
 * @param props - composed slot props.
 * @returns eyebrow and title.
 */
export function HostedGreeting({ greet, useAccount, useSummary, t }: HostedGreetingProps): ReactNode {
  const profileName = useAccount(view => view?.status === 'signed-in' ? view.profile?.name ?? null : null)
  const liveName = useSummary(state => state.summary?.me?.name ?? null)
  const text = greet(firstName(liveName, profileName))
  // A greeting that already ends in punctuation ("Still up, Karl?") keeps it.
  const stop = !/\p{P}$/u.test(text)
  return (
    <span className={css.header}>
      <span className={css.eyebrow}>{t('eyebrow')}</span>
      <span className={css.title}>{text}{stop && <span className={css.stop} aria-hidden="true">.</span>}</span>
    </span>
  )
}

/**
 * Render the line under the greeting with the live count of switched-on apps.
 * @param props - composed slot props.
 * @returns the subtitle.
 */
export function HostedSubtitle({ useSummary, t }: HostedSubtitleProps): ReactNode {
  const count = useSummary(state => state.summary?.apps?.installed ?? null)
  const text = count === null || count === 0 ? t('subtitleNone') : count === 1 ? t('subtitleOne') : t('subtitle', { count: String(count) })
  return <p className={css.subtitle}>{text}</p>
}

/**
 * Take the hero mark's seat with an empty marker; the stylesheet folds the mark's box away.
 * @param _props - the mark geometry, unused.
 * @returns the marker.
 */
export function HostedHeroMark(_props: HostedHeroMarkProps): ReactNode {
  return <span className={css.noMark} />
}

/**
 * The brand mark and name as a same-tab link to the app home.
 * @param props - the shell's brand-row class and identity, and the locale seat.
 * @returns the link.
 */
export function BrandHomeLink({ className, identity, t }: BrandHomeLinkProps): ReactNode {
  return <a href={APP_HOME} className={className} aria-label={t('openWorkspace')}>{identity}</a>
}
