/**
 * The team at a glance: the header at the top of the sidebar (workspace name,
 * member faces, member count) and the strip of quiet tiles under the welcome
 * greeting (members, open approvals, inbox, connected apps), each opening its panel.
 */
import type { ReactNode } from 'react'
import type { AhelAccountView, DesktopMember, DesktopSummary } from '@ahel/dsh-ahel-account/types'
import type { AhelAccountKey } from '../locales.ts'
import type { TeamGlanceTarget, TeamHeaderProps, TeamStripProps } from './contract.ts'
import css from './TeamGlance.module.css'

type Translate = TeamHeaderProps['t']

/** Faces drawn before the stack ends in "+n". */
const FACES_MAX = 4

/** What both surfaces show; null until signed in with a summary. */
export interface TeamGlance {
  readonly workspace: string
  /** The caller first; the caller alone while ahel.ai sends no members. */
  readonly faces: readonly DesktopMember[]
  /** Every active seat; null while ahel.ai sends no members. */
  readonly total: number | null
  /** Pending held calls; null for a Member or a plan without approval rules. */
  readonly approvals: number | null
  readonly inbox: number | null
  readonly apps: number | null
}

/**
 * Fold the account and the summary into what the team surfaces draw.
 * @param view - the live account view.
 * @param summary - the latest summary.
 * @returns the glance, or null while signed out or before the first summary.
 */
export function teamGlance(view: AhelAccountView | null, summary: DesktopSummary | null): TeamGlance | null {
  if (view?.status !== 'signed-in' || summary === null) return null
  const profile = view.profile
  const self: DesktopMember = summary.me ?? { id: 'me', name: profile?.name ?? null, email: profile?.email ?? '' }
  const members = summary.members ?? null
  return {
    workspace: summary.workspace.name,
    faces: members === null || members.rows.length === 0 ? [self] : members.rows,
    total: members?.total ?? null,
    approvals: summary.approvals?.rows.length ?? null,
    inbox: summary.inbox?.unread ?? null,
    apps: summary.apps?.installed ?? null,
  }
}

/**
 * Up to two initials: the first letters of the name's first and last words, else the email's first letter.
 * @param member - one seat.
 * @returns the initials, upper-cased.
 */
export function initials(member: DesktopMember): string {
  const words = member.name?.trim().split(/\s+/).filter(Boolean) ?? []
  const first = words[0]?.charAt(0) ?? member.email.charAt(0)
  const last = words.length > 1 ? words.at(-1)?.charAt(0) ?? '' : ''
  const letters = `${first}${last}`
  return letters === '' ? '?' : letters.toUpperCase()
}

/**
 * Pick the singular or plural copy for a count.
 * @param n - the count.
 * @param one - key for exactly one.
 * @param many - key for any other count.
 * @returns the key.
 */
function plural(n: number, one: AhelAccountKey, many: AhelAccountKey): AhelAccountKey {
  return n === 1 ? one : many
}

/**
 * The overlapping member faces, the caller first; the rest beyond four as "+n".
 * @param props - the faces, the seat count and the size.
 * @returns the decorative stack.
 */
function Faces({ faces, total, small }: { faces: readonly DesktopMember[]; total: number | null; small?: boolean }): ReactNode {
  const shown = faces.slice(0, FACES_MAX)
  const rest = Math.max((total ?? faces.length) - shown.length, 0)
  return (
    <span className={`${css.faces} ${small === true ? css.small : ''}`} aria-hidden="true">
      {shown.map(member => (
        <span key={member.id} className={css.face} title={member.name ?? member.email}>{initials(member)}</span>
      ))}
      {rest > 0 && <span className={`${css.face} ${css.more}`}>+{rest}</span>}
    </span>
  )
}

/**
 * The member count line, absent while ahel.ai sends no members.
 * @param total - the seat count.
 * @param t - locale seat.
 * @returns the copy, or null.
 */
function membersText(total: number | null, t: Translate): string | null {
  return total === null ? null : t(plural(total, 'teamMembersOne', 'teamMembers'), { n: total })
}

/**
 * Header at the top of the sidebar: member faces, workspace name and member count.
 * A press opens the team settings on ahel.ai. Nothing renders in the rail or while signed out.
 * @param props - column state and the team face.
 * @returns the header, or null.
 */
export function TeamHeader({ wide, openMembers, useAccount, useSummary, t }: TeamHeaderProps) {
  const view = useAccount(value => value)
  const summary = useSummary(value => value.summary)
  const glance = teamGlance(view, summary)
  if (!wide || glance === null) return null
  const members = membersText(glance.total, t)
  return (
    <button type="button" className={css.header} title={t('teamSettings')} onClick={() => { openMembers() }}>
      <Faces faces={glance.faces} total={glance.total} />
      <span className={css.headerText}>
        <span className={css.workspace}>{glance.workspace}</span>
        {members !== null && <span className={css.caption}>{members}</span>}
      </span>
    </button>
  )
}

/**
 * One quiet tile: a count in ink, then its words.
 * @param props - count, words and the press.
 * @returns the tile.
 */
function Tile({ count, words, onPress }: { count: number; words: string; onPress: () => void }): ReactNode {
  return (
    <button type="button" className={css.tile} onClick={onPress}>
      <span className={css.count}>{count}</span>
      <span>{words}</span>
    </button>
  )
}

/**
 * The team strip under the welcome greeting, above the composer: the workspace with its
 * members, then open approvals (owners and team leads), inbox items and
 * connected apps. Each tile opens its panel; parts ahel.ai did not send stay out.
 * @param props - the team face.
 * @returns the strip, or null while signed out or before the first summary.
 */
export function TeamStrip({ openPanel, openMembers, useAccount, useSummary, t }: TeamStripProps) {
  const view = useAccount(value => value)
  const summary = useSummary(value => value.summary)
  const glance = teamGlance(view, summary)
  if (glance === null) return null
  const members = membersText(glance.total, t)
  const open = (target: TeamGlanceTarget) => () => { openPanel(target) }
  return (
    <div className={css.strip} role="group" aria-label={t('team')}>
      <button type="button" className={css.tile} title={t('teamSettings')} onClick={() => { openMembers() }}>
        <Faces faces={glance.faces} total={glance.total} small />
        <span className={css.count}>{glance.workspace}</span>
        {members !== null && <span>{members}</span>}
      </button>
      {glance.approvals !== null && (
        <Tile count={glance.approvals} words={t(plural(glance.approvals, 'tileApprovalsOne', 'tileApprovals'))} onPress={open('approvals')} />
      )}
      {glance.inbox !== null && <Tile count={glance.inbox} words={t('tileInbox')} onPress={open('inbox')} />}
      {glance.apps !== null && <Tile count={glance.apps} words={t(plural(glance.apps, 'tileAppsOne', 'tileApps'))} onPress={open('apps')} />}
    </div>
  )
}
