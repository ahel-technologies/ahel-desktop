/** The Your apps main panel in ahel.ai's design: what the person's workspace has installed, each with an On/Off switch. */
import { useState } from 'react'
import { Button, IconRefreshOutlineRegular, Switch } from '@ahel/dsh-client-ui-primitives'
import type { CatalogCapability, CatalogRowTile } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps, DiscoverPageProps } from './contract.ts'
import { failureOf, LOOK_CLASS, setupUrl } from './AppRow.tsx'
import { AppTile } from './AppTile.tsx'
import css from './Catalog.module.css'

/** ahel.ai, where setup and removal happen. */
const APP_ORIGIN = 'https://ahel.ai'

/** Skeleton rows shown before the first read. */
const SKELETON_ROWS = 4

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
  const { useInstalled, refreshInstalled, signIn, openPanel, t } = props
  const installed = useInstalled(value => value)
  const [refreshing, setRefreshing] = useState(false)

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
                  refreshInstalled={refreshInstalled} openLink={props.openLink} t={t} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** Props of one installed row. */
type YourAppRowProps = Pick<CatalogFaceProps, 'setEnabled' | 'refreshInstalled' | 'openLink' | 't'> & {
  readonly capability: CatalogCapability
}

/**
 * Render one installed capability.
 * @param props - the capability and the face's write and link actions.
 * @returns the row.
 */
function YourAppRow({ capability, setEnabled, refreshInstalled, openLink, t }: YourAppRowProps) {
  const [pending, setPending] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const skill = capability.type === 'Skill'
  const tile: CatalogRowTile = { text: initials(capability.name), tone: skill ? 'skill' : 'plain', mark: null }
  const locked = capability.state === 'unavailable' || capability.state === 'needs_setup'

  const toggle = (next: boolean): void => {
    setPending(next)
    setError(null)
    // Hold the requested position until the re-read lands, so the switch never flips back in between.
    void setEnabled(capability.key, next).then(() => refreshInstalled(), (failure: unknown) => {
      const { code, message } = failureOf(failure)
      setError(code === 'ahel-catalog/refused' && message !== '' ? message : t('actionFailed'))
    }).catch(() => undefined).finally(() => { setPending(null) })
  }

  let line: string
  switch (capability.state) {
    case 'on': line = t('switchOn'); break
    case 'off': line = t('switchOff'); break
    case 'needs_setup':
      line = capability.needs.length > 0 ? `${t('stateNeedsSetup')} · ${capability.needs.join(', ')}` : t('stateNeedsSetup')
      break
    case 'unavailable': line = capability.reason ?? t('stateUnavailable'); break
    default: line = t('stateTurnOn')
  }

  return (
    <li className={css.row}>
      <div className={css.vrow}>
        <AppTile tile={tile} />
        <div className={css.body}>
          <div className={css.name}>
            <span>{capability.name}</span>
            <span className={skill ? `${css.kind} ${css.kindSkill}` : css.kind}>{t(skill ? 'tagSkill' : 'tagApp')}</span>
          </div>
          <p className={capability.state === 'needs_setup' ? `${css.line} ${css.lineSetup}` : css.line} title={line}>{line}</p>
        </div>
        <div className={css.rowControls}>
          {capability.state === 'needs_setup' && (
            <button type="button" className={LOOK_CLASS.setup} onClick={() => { openLink(setupUrl(APP_ORIGIN, capability)) }}>
              {t('finishSetup')}
            </button>
          )}
          <button type="button" className={`${css.btn} ${css.btnGhost}`}
            onClick={() => { openLink(new URL('/app/apps', APP_ORIGIN).href) }}>
            {t('removeOnAhel')}
          </button>
          <Switch checked={pending ?? capability.state === 'on'} disabled={pending !== null || locked}
            label={capability.name}
            onChange={toggle} />
        </div>
      </div>
      {error !== null && <p className={`${css.rowNote} ${css.rowNoteError}`} role="status">{error}</p>}
    </li>
  )
}
