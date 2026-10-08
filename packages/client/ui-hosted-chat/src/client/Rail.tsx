/**
 * The hosted chat's left column, in the order of ahel.ai's own sidebar: the
 * workspace switcher, the rows Home, Chat, Apps, Discover, Inbox, Team and
 * Settings, and at the foot Help, the account entry, Theme and Log out. The
 * account entry names the person and their email and opens a menu with the
 * in-app Chat settings; the settings seat itself stays mounted out of sight,
 * so its window and its shortcut keep working.
 * Until the Host's account check has answered, the switcher and the account
 * entry are placeholders: no Sign in and no Log out, so a signed-in person
 * never sees the signed-out rail while the Host starts.
 * ahel.ai pages open in the same tab; Chat and Inbox are in-app panels. The
 * rail draws New chat and the Chats list into the chat column through a
 * portal, so the session rows keep the sidebar's own browser.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  IconCheckOutlineRegular, IconChevronsUpDownOutlineRegular, IconDarkOutlineRegular, IconFollowsystemOutlineRegular,
  IconLightOutlineRegular, IconNewChatOutlineRegular, IconQuestionOutlineRegular, IconSettingsOutlineRegular,
  IconUsersOutlineRegular, MenuSurface, Tooltip, useDismissOnOutsidePointer,
} from '@ahel/dsh-client-ui-primitives'
import type { AhelWorkspace } from '@ahel/dsh-ahel-account/types'
import type { ThemePreference } from '@ahel/dsh-client-ui-theme/client'
import type { HostedRailProps } from './contract.ts'
import type { HostedChatKey } from './locales.ts'
import { AppsGlyph, ChatGlyph, DiscoverGlyph, HomeGlyph, InboxGlyph, LogOutGlyph, type Glyph } from './glyphs.tsx'
import css from './Rail.module.css'

/** ahel.ai's app home, the hosted chat's parent site. */
export const APP_HOME = 'https://app.ahel.ai/app'

/** ahel.ai's public contact page, the rail's Help. */
export const HELP_URL = 'https://ahel.ai/contact'

/** Main panel id of the Inbox that ui-ahel-account registers while signed in. */
export const INBOX_PANEL = 'ahel-inbox'

/** One rail row: an ahel.ai page, or an in-app panel (null is the Conversation). */
type NavRow = { key: HostedChatKey; glyph: Glyph } & ({ href: string } | { panel: string | null })

const UsersGlyph: Glyph = ({ size }) => <IconUsersOutlineRegular size={size} />
const SettingsGlyph: Glyph = ({ size }) => <IconSettingsOutlineRegular size={size} />
const HelpGlyph: Glyph = ({ size }) => <IconQuestionOutlineRegular size={size} />

/** The rows, item for item ahel.ai's PRIMARY_NAV with Chat after Home and the in-app Inbox before Team. */
export const NAV: readonly NavRow[] = [
  { key: 'home', glyph: HomeGlyph, href: APP_HOME },
  { key: 'chat', glyph: ChatGlyph, panel: null },
  { key: 'apps', glyph: AppsGlyph, href: 'https://app.ahel.ai/app/apps' },
  { key: 'discover', glyph: DiscoverGlyph, href: 'https://app.ahel.ai/app/catalog' },
  { key: 'inbox', glyph: InboxGlyph, panel: INBOX_PANEL },
  { key: 'team', glyph: UsersGlyph, href: 'https://app.ahel.ai/app/settings/organization' },
  { key: 'settings', glyph: SettingsGlyph, href: 'https://app.ahel.ai/app/settings' },
]

/** Theme row label and glyph per preference. */
const THEMES: Readonly<Record<ThemePreference, { key: HostedChatKey; glyph: Glyph }>> = {
  system: { key: 'theme.system', glyph: ({ size }) => <IconFollowsystemOutlineRegular size={size} /> },
  light: { key: 'theme.light', glyph: ({ size }) => <IconLightOutlineRegular size={size} /> },
  dark: { key: 'theme.dark', glyph: ({ size }) => <IconDarkOutlineRegular size={size} /> },
}

const NO_WORKSPACES: readonly AhelWorkspace[] = []

/** Shared content of a rail row: the active bar, the glyph (in both widths, like ahel.ai's rail), the wide label and an optional count. */
function RowContent({ wide, label, glyph: RowGlyph, count }: { wide: boolean; label: string; glyph: Glyph; count?: number }): ReactNode {
  return <>
    <span className={css.bar} aria-hidden="true" />
    <span className={css.glyph} aria-hidden={wide || undefined}><RowGlyph size={wide ? 16 : 18} /></span>
    {wide && <span className={css.label}>{label}</span>}
    {count !== undefined && count > 0 && <span className={css.count} aria-hidden="true">{count > 99 ? '99+' : count}</span>}
  </>
}

/**
 * Format USD cents for the balance line: `$12.40`, `$3`, `-$0.50`.
 * @param cents - amount in cents.
 * @returns the dollar amount.
 */
function formatCents(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(cents / 100)
}

/**
 * The signed-in account entry: "name · email" on the wide rail, the initial on
 * the collapsed one, opening a menu with the balance, Top up and Chat settings.
 */
function AccountEntry({
  wide, useAccount, useSummary, openChatSettings, openBilling, t,
}: Pick<HostedRailProps, 'wide' | 'useAccount' | 'useSummary' | 'openChatSettings' | 'openBilling' | 't'>): ReactNode {
  const email = useAccount(view => view?.profile?.email ?? null)
  const profileName = useAccount(view => view?.profile?.name ?? null)
  const liveName = useSummary(state => state.summary?.me?.name ?? null)
  const credits = useSummary(state => state.summary?.credits ?? null)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen)
  const name = liveName ?? profileName
  const label = [name, email].filter((part): part is string => part !== null && part !== '').join(' · ') || t('account')
  return (
    <div ref={root} className={css.accountEntry}>
      <button type="button" className={css.accountTrigger} aria-haspopup="menu" aria-expanded={open} aria-label={`${t('accountMenu')}: ${label}`}
        title={label} onClick={() => { setOpen(value => !value) }}>
        <span className={css.avatar} aria-hidden="true">{(name ?? email ?? 'A').charAt(0).toUpperCase()}</span>
        {wide && <span className={css.label}>{label}</span>}
      </button>
      {open && (
        <MenuSurface compact role="menu" aria-label={t('accountMenu')} className={css.accountMenu}>
          <div className={css.identity}>
            {name !== null && <div className={css.identityName}>{name}</div>}
            {email !== null && <div className={css.identityCaption}>{email}</div>}
          </div>
          {credits?.visible === true && (
            <div className={css.balance}>
              <div className={css.identityCaption}>
                {t('balanceToday', { amount: formatCents(credits.balanceCents), spent: formatCents(credits.workspaceSpentTodayCents) })}
              </div>
              {credits.low && <div className={css.low}>{t('balanceLow')}</div>}
              {credits.canTopUp
                ? (
                  <button type="button" role="menuitem" className={css.option} onClick={() => { setOpen(false); openBilling() }}>
                    <span className={css.optionName}>{t('topUp')}</span>
                  </button>
                )
                : <div className={css.identityCaption}>{t('askOwnerTopUp')}</div>}
            </div>
          )}
          <button type="button" role="menuitem" className={css.option} onClick={() => { setOpen(false); openChatSettings() }}>
            <IconSettingsOutlineRegular size={14} />
            <span className={css.optionName}>{t('chatSettings')}</span>
          </button>
        </MenuSurface>
      )}
    </div>
  )
}

/** The account check's answer: `pending` until the Host's first account view arrives. */
type AccountPhase = 'pending' | 'signed-in' | 'signed-out'

/**
 * Read the account phase from a view.
 * @param view - the account view, or null before the first answer.
 * @returns the phase.
 */
function accountPhase(view: { readonly status: 'signed-in' | 'signed-out' } | null): AccountPhase {
  return view === null ? 'pending' : view.status
}

/** Placeholder of the account entry while the account check has not answered: no control to press. */
function AccountPending({ wide, t }: Pick<HostedRailProps, 'wide' | 't'>): ReactNode {
  return (
    <div className={css.pending} role="status" aria-busy="true" aria-label={t('accountLoading')}>
      <span className={clsx(css.avatar, css.skeleton)} aria-hidden="true" />
      {wide && <span className={clsx(css.pendingBar, css.skeleton)} aria-hidden="true" />}
    </div>
  )
}

/**
 * The workspace switcher: the current workspace and a list of the account's
 * workspaces. On the collapsed rail it opens the column instead.
 */
function WorkspaceSwitcher({
  wide, expandSidebar, selectWorkspace, useAccount, useSummary, t,
}: Pick<HostedRailProps, 'wide' | 'expandSidebar' | 'selectWorkspace' | 'useAccount' | 'useSummary' | 't'>): ReactNode {
  const workspaces = useAccount(view => view?.status === 'signed-in' ? view.profile?.workspaces ?? NO_WORKSPACES : NO_WORKSPACES)
  const selected = useAccount(view => view?.workspace ?? null)
  // With no choice stored, ahel.ai names the workspace it picked in the summary.
  const picked = useSummary(state => state.summary?.workspace ?? null)
  const [pending, setPending] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen)
  useEffect(() => { if (pending !== null && selected === pending) setPending(null) }, [pending, selected])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open])

  const currentId = pending ?? selected ?? picked?.id ?? null
  const name = workspaces.find(item => item.id === currentId)?.name
    ?? (picked !== null && picked.id === currentId ? picked.name : undefined)
  if (name === undefined) return null
  const choose = (id: string): void => {
    setOpen(false)
    if (id === currentId) return
    setPending(id)
    void selectWorkspace(id).catch(() => { setPending(null) })
  }
  const initial = name.trim().charAt(0).toUpperCase()

  if (!wide) {
    return (
      <Tooltip label={name} delayMs={500} side="right">
        <button type="button" className={css.switcherRail} aria-label={t('switchWorkspace')} onClick={expandSidebar}>
          <span className={css.initial} aria-hidden="true">{initial}</span>
        </button>
      </Tooltip>
    )
  }
  return (
    <div ref={root} className={css.switcher}>
      <button type="button" className={css.switcherTrigger} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t('switchWorkspace')}: ${name}`} disabled={workspaces.length < 2}
        onClick={() => { setOpen(value => !value) }}>
        <span className={css.initial} aria-hidden="true">{initial}</span>
        <span className={css.switcherName}>{name}</span>
        {workspaces.length > 1 && <IconChevronsUpDownOutlineRegular size={14} className={css.chevrons} />}
      </button>
      {open && (
        <MenuSurface compact role="listbox" aria-label={t('workspaces')} className={css.switcherMenu}>
          {workspaces.map(item => (
            <button key={item.id} type="button" role="option" aria-selected={item.id === currentId} className={css.option}
              onClick={() => { choose(item.id) }}>
              <span className={css.optionName}>{item.name}</span>
              {item.id === currentId && <IconCheckOutlineRegular size={14} className={css.check} />}
            </button>
          ))}
        </MenuSurface>
      )}
    </div>
  )
}

/**
 * Render the app rail in place of the sidebar's own body.
 * @param props - composed slot props.
 * @returns the rail, plus New chat and the Chats list portalled into the chat column.
 */
export function HostedRail(props: HostedRailProps): ReactNode {
  const {
    wide, startSession, renderWorkspaces, renderFooterActions, renderSettings, usePanelInfo, useAccount, useSummary, useTheme, useChatSeat,
    selectPanel, signOut, cycleTheme, t,
  } = props
  const activePanel = usePanelInfo(info => info.activePanelId)
  const phase = useAccount(accountPhase)
  const signedIn = phase === 'signed-in'
  const unread = useSummary(state => state.summary?.inbox?.unread ?? 0)
  const theme = THEMES[useTheme(preference => preference)]
  const seat = useChatSeat(element => element)
  const tooltip = (label: string, node: ReactElement): ReactNode => (
    <Tooltip key={label} label={label} delayMs={500} side="right" disabled={wide}>{node}</Tooltip>
  )

  return (
    <div className={clsx(css.rail, !wide && css.collapsed)}>
      {phase === 'pending'
        ? <div className={clsx(wide ? css.switcherPending : css.switcherRailPending, css.skeleton)} aria-hidden="true" />
        : <WorkspaceSwitcher {...props} />}
      <nav className={css.nav} aria-label={t('navLabel')}>
        {NAV.map((row) => {
          const label = t(row.key)
          if ('href' in row) {
            return tooltip(label, (
              <a href={row.href} className={css.row} aria-label={wide ? undefined : label}>
                <RowContent wide={wide} label={label} glyph={row.glyph} />
              </a>
            ))
          }
          // The Inbox panel exists only while signed in.
          if (row.panel !== null && !signedIn) return null
          const active = activePanel === row.panel
          const count = row.panel === INBOX_PANEL ? unread : undefined
          const name = count !== undefined && count > 0 ? t('inboxUnread', { count: String(count) }) : label
          return tooltip(label, (
            <button type="button" className={clsx(css.row, active && css.active)} aria-current={active ? 'page' : undefined}
              aria-label={name} onClick={() => { selectPanel(row.panel) }}>
              <RowContent wide={wide} label={label} glyph={row.glyph} {...count === undefined ? {} : { count }} />
            </button>
          ))
        })}
      </nav>
      <div className={css.foot} role="group" aria-label={t('footLabel')}>
        {tooltip(t('help'), (
          <a href={HELP_URL} className={css.util} aria-label={wide ? undefined : t('help')}>
            {!wide && <HelpGlyph size={16} />}
            {wide && <span className={css.label}>{t('help')}</span>}
          </a>
        ))}
        {/* Signed out, the shared entry offers Sign in; before the account check answers, neither. */}
        <div className={css.account}>
          {signedIn ? <AccountEntry {...props} /> : phase === 'pending' ? <AccountPending wide={wide} t={t} /> : renderFooterActions()}
        </div>
        {/* Out of sight: the settings window portals beside the app root, so it shows when opened. */}
        <div className={css.settingsSeat}>{renderSettings()}</div>
        {tooltip(t(theme.key), (
          <button type="button" className={css.util} aria-label={t(theme.key)} onClick={cycleTheme}>
            <theme.glyph size={16} />
            {wide && <span className={css.label}>{t(theme.key)}</span>}
          </button>
        ))}
        {signedIn && tooltip(t('logOut'), (
          <button type="button" className={css.util} aria-label={t('logOut')} onClick={() => { void signOut().catch(() => undefined) }}>
            {!wide && <LogOutGlyph size={16} />}
            {wide && <span className={css.label}>{t('logOut')}</span>}
          </button>
        ))}
      </div>
      {seat !== null && createPortal(
        <>
          <button type="button" className={css.newChat} onClick={startSession}>
            <IconNewChatOutlineRegular size={16} />
            <span>{t('newChat')}</span>
          </button>
          <div className={css.chats}>{renderWorkspaces()}</div>
        </>,
        seat,
      )}
    </div>
  )
}
