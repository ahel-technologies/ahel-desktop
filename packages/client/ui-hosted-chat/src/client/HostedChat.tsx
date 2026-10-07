/**
 * The hosted chat's way back to the workspace: a Workspace row at the top of
 * the sidebar and the brand row as a link, both to ahel.ai's app home in the
 * same tab.
 */
import type { ReactNode } from 'react'
import { Tooltip } from '@ahel/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import css from './HostedChat.module.css'

/** ahel.ai's app home, the hosted chat's parent site. */
export const APP_HOME = 'https://app.ahel.ai/app'

/** Props of the Workspace row in `sidebar.header`. */
export type WorkspaceRowProps = PropsRuntime<'sidebar.header'> & PropsLocale<'hosted-chat'>

/** Props of the brand link in `sidebar.brand.link`. */
export type BrandHomeLinkProps = PropsRuntime<'sidebar.brand.link'> & PropsLocale<'hosted-chat'>

/**
 * A house drawn on the sidebar's 16px glyph grid at its one-pixel stroke.
 * @param props - square edge in pixels.
 * @returns the decorative glyph.
 */
function HomeGlyph({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.2 8 2.5l5.5 4.7" />
      <path d="M4 6v6.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
      <path d="M6.5 13.5V10h3v3.5" />
    </svg>
  )
}

/**
 * The Workspace row: glyph, "Workspace" and the app's host in the wide column; the glyph alone in the rail.
 * @param props - column state and the locale seat.
 * @returns a same-tab link to the app home.
 */
export function WorkspaceRow({ wide, t }: WorkspaceRowProps): ReactNode {
  const label = t('workspace')
  return (
    <Tooltip label={label} delayMs={500} side="right" disabled={wide}>
      <a href={APP_HOME} className={wide ? css.row : css.rail} aria-label={wide ? undefined : label} title={wide ? t('openWorkspace') : undefined}>
        <span className={css.glyph}><HomeGlyph size={wide ? 16 : 18} /></span>
        {wide && (
          <span className={css.text}>
            <span className={css.title}>{label}</span>
            <span className={css.caption}>{new URL(APP_HOME).host}</span>
          </span>
        )}
      </a>
    </Tooltip>
  )
}

/**
 * The brand mark and name as a same-tab link to the app home.
 * @param props - the shell's brand-row class and identity, and the locale seat.
 * @returns the link.
 */
export function BrandHomeLink({ className, identity, t }: BrandHomeLinkProps): ReactNode {
  return <a href={APP_HOME} className={className} aria-label={t('openWorkspace')}>{identity}</a>
}
