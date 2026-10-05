/** The Your apps main panel: what the person's ahel.ai workspace has installed, each with an On/Off switch. */
import { useState } from 'react'
import { Button, IconRefreshOutlineRegular, Switch, Tag } from '@ahel/dsh-client-ui-primitives'
import type { CatalogCapability, CatalogRowTile } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps, DiscoverPageProps } from './contract.ts'
import { failureOf, setupUrl } from './AppRow.tsx'
import { AppTile } from './AppTile.tsx'
import shared from './Catalog.module.css'
import css from './YourAppsPage.module.css'

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
    <div className={shared.page}>
      <header className={`${shared.head} ${css.head}`} data-window-drag>
        <div className={css.headText}>
          <h1 className={shared.title}>{t('appsTitle')}</h1>
          <p className={shared.lead}>{t('appsLead')}</p>
        </div>
        {installed?.signedIn === true && (
          <Button variant="ghost" size="sm" className={css.iconButton} icon={<IconRefreshOutlineRegular size={16} />}
            aria-label={t('refresh')} title={t('refresh')} disabled={refreshing} onClick={refresh} />
        )}
      </header>
      <div aria-busy={installed === null || refreshing}>
        {installed === null && (
          <ul className={shared.list} aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <li key={index} className={shared.row}>
                <div className={shared.rowBody}>
                  <span className={`${shared.tile} ${shared['tile-md']} ${shared.skeletonFill}`} />
                  <span className={shared.rowText}>
                    <span className={`${shared.skeletonBar} ${shared.skeletonName} ${shared.skeletonFill}`} />
                    <span className={`${shared.skeletonBar} ${shared.skeletonLine} ${shared.skeletonFill}`} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {installed?.signedIn === false && (
          <div className={shared.state}>
            <p className={shared.stateTitle}>{t('appsSignedOut')}</p>
            <Button variant="outline" size="sm" onClick={() => { void signIn().catch(() => undefined) }}>{t('signIn')}</Button>
          </div>
        )}
        {installed?.signedIn === true && installed.rows.length === 0 && (
          <div className={shared.state}>
            <p className={shared.stateTitle}>{t('appsEmpty')}</p>
            <Button variant="outline" size="sm" onClick={() => { openPanel('ahel-discover') }}>{t('openDiscover')}</Button>
          </div>
        )}
        {installed?.signedIn === true && installed.rows.length > 0 && (
          <ul className={shared.list}>
            {installed.rows.map(capability => (
              <YourAppRow key={capability.key} capability={capability} setEnabled={props.setEnabled}
                refreshInstalled={refreshInstalled} openLink={props.openLink} t={t} />
            ))}
          </ul>
        )}
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
    <li className={shared.row}>
      <div className={`${shared.rowBody} ${css.rowBody}`}>
        <AppTile tile={tile} />
        <span className={shared.rowText}>
          <span className={shared.rowHead}>
            <span className={shared.rowName}>{capability.name}</span>
            <Tag tone="outline">{t(skill ? 'tagSkill' : 'tagApp')}</Tag>
          </span>
          <span className={capability.state === 'needs_setup' ? `${shared.rowLine} ${css.lineSetup}` : shared.rowLine}
            title={line}>
            {line}
          </span>
        </span>
        <div className={shared.rowEnd}>
          {capability.state === 'needs_setup' && (
            <Button variant="outline" size="sm" onClick={() => { openLink(setupUrl(APP_ORIGIN, capability)) }}>
              {t('finishSetup')}
            </Button>
          )}
          <Button variant="ghost" size="sm" className={css.remove}
            onClick={() => { openLink(new URL('/app/apps', APP_ORIGIN).href) }}>
            {t('removeOnAhel')}
          </Button>
          <Switch checked={pending ?? capability.state === 'on'} disabled={pending !== null || locked}
            label={capability.name}
            onChange={toggle} />
        </div>
      </div>
      {error !== null && <p className={`${shared.rowNote} ${shared.rowNoteError}`} role="status">{error}</p>}
    </li>
  )
}
