/**
 * The Your apps main panel in ahel.ai's design: what the person's workspace has
 * installed, each with an On/Off switch, its connection status, the in-app
 * Connect sheet for setup and, for owners and team leads, Disconnect.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Button, IconEllipsisOutlineRegular, IconRefreshOutlineRegular, Menu, MenuItemButton, Modal, Switch,
} from '@ahel/dsh-client-ui-primitives'
import type { CatalogCapability, CatalogRowTile, VaultSignIn } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps, DiscoverPageProps } from './contract.ts'
import { failureOf, LOOK_CLASS, setupUrl } from './AppRow.tsx'
import { AppTile } from './AppTile.tsx'
import { ConnectSheet, targetOf, teamFailure, webLink } from './ConnectSheet.tsx'
import type { ConnectTarget } from './ConnectSheet.tsx'
import css from './Catalog.module.css'
import connectCss from './ConnectSheet.module.css'

/** ahel.ai, where setup and removal happen. */
const APP_ORIGIN = 'https://ahel.ai'

/** Skeleton rows shown before the first read. */
const SKELETON_ROWS = 4

/** The workspace's sign-ins and whether this seat may connect and disconnect; null until read or on an outdated ahel.ai. */
interface SignInState {
  readonly rows: readonly VaultSignIn[]
  readonly canManage: boolean
}

/**
 * The sign-in a capability stands on, if any.
 * @param signIns - the workspace's sign-ins.
 * @param capability - the installed row.
 * @returns the matching sign-in.
 */
function signInOf(signIns: readonly VaultSignIn[], capability: CatalogCapability): VaultSignIn | undefined {
  const service = capability.key.startsWith('app:') ? capability.key.slice(4) : null
  return signIns.find(row => row.key === capability.key
    || (row.itemId !== null && row.itemId === capability.itemId)
    || (service !== null && row.service === service))
}

/**
 * One or two initials of a capability name.
 * @param name - display name.
 * @returns the first letters of its first two words, or the first letter of one word.
 */
function initials(name: string): string {
  const words = name.split(/[\s\-_.:/]+/).filter(word => word !== '')
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0]?.[0] ?? '?')
  return letters.toUpperCase()
}

/**
 * Render the Your apps panel.
 * @param props - composed slot props: the catalog face, its hooks and `t`.
 * @returns the page.
 */
export function YourAppsPage(props: DiscoverPageProps) {
  const { useInstalled, refreshInstalled, signIn, openPanel, signIns, t } = props
  const installed = useInstalled(value => value)
  const [refreshing, setRefreshing] = useState(false)
  const [vault, setVault] = useState<SignInState | null>(null)
  const [connecting, setConnecting] = useState<ConnectTarget | null>(null)
  const signedIn = installed?.signedIn === true

  // Each installs read also re-reads the sign-ins, so expiry and Disconnect follow the same triggers.
  const vaultRead = useRef(0)
  useEffect(() => {
    if (!signedIn) { setVault(null); return }
    const mine = ++vaultRead.current
    signIns().then((list) => {
      if (mine === vaultRead.current) setVault({ rows: list.signIns, canManage: list.canManage })
    }, () => {
      // An outdated or unreachable ahel.ai shows no sign-in status and no Disconnect.
      if (mine === vaultRead.current) setVault(null)
    })
  }, [installed, signedIn, signIns])

  const refresh = (): void => {
    setRefreshing(true)
    void refreshInstalled().catch(() => undefined).finally(() => { setRefreshing(false) })
  }

  return (
    <div className={`${css.tokens} ${css.page}`}>
      <div className={css.top} data-window-drag />
      <div className={css.wrap}>
        <header className={css.appsHead}>
          <div>
            <h1 className={css.h1}>{t('appsTitle')}<span className={css.stop}>.</span></h1>
            <p className={css.lead} style={{ marginTop: 14 }}>{t('appsLead')}</p>
          </div>
          {installed?.signedIn === true && (
            <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={16} />}
              aria-label={t('refresh')} title={t('refresh')} disabled={refreshing} onClick={refresh} />
          )}
        </header>
        <div className={css.appsList} aria-busy={installed === null || refreshing}>
          {installed === null && (
            <ul className={css.list} aria-hidden="true">
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <li key={index} className={css.row}>
                  <div className={css.vrow}>
                    <span className={`${css.tile} ${css.skeletonFill}`} />
                    <span>
                      <span className={`${css.skeletonBar} ${css.skeletonName} ${css.skeletonFill}`} />
                      <span className={`${css.skeletonBar} ${css.skeletonLine} ${css.skeletonFill}`} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {installed?.signedIn === false && (
            <div className={css.empty}>
              <b>{t('appsSignedOut')}</b>
              <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={() => { void signIn().catch(() => undefined) }}>{t('signIn')}</button>
            </div>
          )}
          {installed?.signedIn === true && installed.rows.length === 0 && (
            <div className={css.empty}>
              <b>{t('appsEmpty')}</b>
              <button type="button" className={`${css.btn} ${css.btnDark}`} onClick={() => { openPanel('ahel-discover') }}>{t('openDiscover')}</button>
            </div>
          )}
          {installed?.signedIn === true && installed.rows.length > 0 && (
            <ul className={css.list}>
              {installed.rows.map(capability => (
                <YourAppRow key={capability.key} capability={capability} setEnabled={props.setEnabled}
                  refreshInstalled={refreshInstalled} disconnect={props.disconnect} openLink={props.openLink} t={t}
                  signIn={vault === null ? undefined : signInOf(vault.rows, capability)} canManage={vault?.canManage === true}
                  onSetup={setConnecting} />
              ))}
            </ul>
          )}
        </div>
      </div>
      {connecting !== null && (
        <ConnectSheet key={connecting.app} target={connecting} installed={installed} onClose={() => { setConnecting(null) }}
          connectPanel={props.connectPanel} connect={props.connect} refreshInstalled={refreshInstalled} openLink={props.openLink} t={t} />
      )}
    </div>
  )
}

/** Props of one installed row. */
type YourAppRowProps = Pick<CatalogFaceProps, 'setEnabled' | 'refreshInstalled' | 'disconnect' | 'openLink' | 't'> & {
  readonly capability: CatalogCapability
  /** The workspace sign-in the row stands on, if any. */
  readonly signIn: VaultSignIn | undefined
  /** Whether this seat may disconnect it. */
  readonly canManage: boolean
  /** Open the Connect sheet. */
  readonly onSetup: (target: ConnectTarget) => void
}

/** What the last Disconnect left to show under the row. */
type RowNote =
  | { readonly kind: 'error'; readonly text: string; readonly webUrl: string | null }
  | { readonly kind: 'info'; readonly text: string }

/**
 * Render one installed capability.
 * @param props - the capability, its sign-in and the face's write and link actions.
 * @returns the row.
 */
function YourAppRow({ capability, signIn, canManage, onSetup, setEnabled, refreshInstalled, disconnect, openLink, t }: YourAppRowProps) {
  const [pending, setPending] = useState<boolean | null>(null)
  const [note, setNote] = useState<RowNote | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const skill = capability.type === 'Skill'
  const tile: CatalogRowTile = { text: initials(capability.name), tone: skill ? 'skill' : 'plain', mark: null }
  const locked = capability.state === 'unavailable' || capability.state === 'needs_setup'
  const expired = capability.state === 'on' && signIn?.expired === true
  const target = targetOf(capability, setupUrl(APP_ORIGIN, capability))

  const toggle = (next: boolean): void => {
    setPending(next)
    setNote(null)
    // Hold the requested position until the re-read lands, so the switch never flips back in between.
    void setEnabled(capability.key, next).then(() => refreshInstalled(), (failure: unknown) => {
      const { code, message } = failureOf(failure)
      setNote({ kind: 'error', text: code === 'ahel-catalog/refused' && message !== '' ? message : t('actionFailed'), webUrl: null })
    }).catch(() => undefined).finally(() => { setPending(null) })
  }

  const signInAgain = (): void => {
    const url = capability.signInUrl === undefined ? null : webLink(capability.signInUrl)
    if (url !== null) openLink(url)
    else onSetup(target)
  }

  const remove = (): void => {
    setRemoving(true)
    setNote(null)
    disconnect(target.app).then((result) => {
      setConfirming(false)
      setNote({ kind: 'info', text: result.removed ? t('disconnectDone') : t('disconnectNothing', { name: capability.name }) })
    }, (error: unknown) => {
      setConfirming(false)
      const failure = teamFailure(error)
      const text = failure.code === 'ahel-team/outdated' ? t('connectUpdateAhel') : failure.own ?? t('actionFailed')
      setNote({ kind: 'error', text, webUrl: failure.webUrl })
    }).finally(() => { setRemoving(false) })
  }

  let line: string
  if (expired) {
    line = t('connectExpired')
  } else {
    switch (capability.state) {
      case 'on': line = skill ? t('switchOn') : t('connectConnected'); break
      case 'off': line = t('switchOff'); break
      case 'needs_setup': line = t('stateNeedsSetup'); break
      case 'unavailable': line = capability.reason ?? t('stateUnavailable'); break
      default: line = t('stateTurnOn')
    }
  }
  const warn = expired || capability.state === 'needs_setup'
  const canDisconnect = canManage && !skill && (capability.state === 'on' || capability.state === 'off')

  return (
    <li className={css.row}>
      <div className={css.vrow}>
        <AppTile tile={tile} />
        <div className={css.body}>
          <div className={css.name}>
            <span>{capability.name}</span>
            <span className={skill ? `${css.kind} ${css.kindSkill}` : css.kind}>{t(skill ? 'tagSkill' : 'tagApp')}</span>
          </div>
          <p className={warn ? `${css.line} ${css.lineSetup}` : css.line} title={line}>{line}</p>
        </div>
        <div className={css.rowControls}>
          {capability.state === 'needs_setup' && (
            <button type="button" className={LOOK_CLASS.setup} onClick={() => { onSetup(target) }}>
              {t('finishSetup')}
            </button>
          )}
          {expired && (
            <button type="button" className={LOOK_CLASS.setup} onClick={signInAgain}>
              {t('connectSignInAgain')}
            </button>
          )}
          <button type="button" className={`${css.btn} ${css.btnGhost}`}
            onClick={() => { openLink(new URL('/app/apps', APP_ORIGIN).href) }}>
            {t('removeOnAhel')}
          </button>
          <Switch checked={pending ?? capability.state === 'on'} disabled={pending !== null || locked}
            label={capability.name}
            onChange={toggle} />
          {canDisconnect && (
            <Menu open={menuOpen} onClose={() => { setMenuOpen(false) }} align="end" portal dense
              anchor={(
                <Button size="sm" aria-label={t('moreFor', { name: capability.name })} title={t('moreFor', { name: capability.name })}
                  aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(open => !open) }}>
                  <IconEllipsisOutlineRegular />
                </Button>
              )}>
              <MenuItemButton danger onSelect={() => { setMenuOpen(false); setConfirming(true) }}>{t('disconnect')}</MenuItemButton>
            </Menu>
          )}
        </div>
      </div>
      {note !== null && (
        <p className={note.kind === 'error' ? `${css.rowNote} ${css.rowNoteError}` : css.rowNote} role="status">
          {note.text}
          {note.kind === 'error' && note.webUrl !== null && (
            <>
              {' '}
              <button type="button" className={connectCss.rowLink} onClick={() => { if (note.webUrl !== null) openLink(note.webUrl) }}>{t('openOnAhel')}</button>
            </>
          )}
        </p>
      )}
      <Modal open={confirming} title={t('disconnectConfirm', { name: capability.name })} closeLabel={t('close')}
        onClose={() => { if (!removing) setConfirming(false) }} className={css.tokens ?? ''}
        footer={(
          <div className={connectCss.confirmActions}>
            <button type="button" className={`${css.btn} ${css.btnSecondary}`} disabled={removing} onClick={() => { setConfirming(false) }}>
              {t('cancel')}
            </button>
            <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={removing} onClick={remove} data-modal-autofocus>
              {t('disconnect')}
            </button>
          </div>
        )} />
    </li>
  )
}
