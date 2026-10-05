/** The app detail sheet: tile, facts, description, the install button and a vendor's nested skills. */
import { useRef, useState } from 'react'
import {
  Button, IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular, Modal, Tag, writeClipboard,
} from '@ahel/dsh-client-ui-primitives'
import type { CatalogBrowseQuery, CatalogGroup, CatalogInstalled, CatalogRow } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps } from './contract.ts'
import { AppRow, failureOf, rowAction, setupUrl } from './AppRow.tsx'
import type { RowAction } from './AppRow.tsx'
import { AppTile } from './AppTile.tsx'
import css from './DetailDrawer.module.css'

/** Nested skills revealed per "Show 24 more" press; ahel.ai serves larger slices, held until shown. */
const NEST_STEP = 24

/** How long the copy button shows its check after a copy. */
const COPIED_MS = 1_000

/** Props of the detail sheet. */
export type DetailDrawerProps = Pick<CatalogFaceProps, 'browsePart' | 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  /** The opened listing group; its nested skills fill the vendor section. */
  readonly group: CatalogGroup
  /** The query the group was listed under; `browsePart` needs it to find the group again. */
  readonly query: CatalogBrowseQuery
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  /** Show another group in the sheet, such as one of the nested skills. */
  readonly onSelect: (group: CatalogGroup) => void
  readonly onClose: () => void
}

/** What the last press of the primary button left to show. */
type Outcome =
  | { readonly kind: 'added'; readonly prompt: string | null }
  | { readonly kind: 'error'; readonly text: string }

/**
 * Render the detail sheet for one group. Key it by the row id so a new row starts fresh.
 * @param props - the group, its listing query, the person's installs and the catalog actions.
 * @returns the right-side sheet.
 */
export function DetailDrawer(props: DetailDrawerProps) {
  const { group, query, installed, signedIn, onSelect, onClose, browsePart, install, setEnabled, signIn, openLink, t } = props
  const { row, skills } = group
  const origin = new URL(row.href).origin
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pendingSetup, setPendingSetup] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [nest, setNest] = useState<readonly CatalogRow[]>(skills?.rows ?? [])
  const [held, setHeld] = useState<readonly CatalogRow[]>([])
  const [unfetched, setUnfetched] = useState(skills === null ? 0 : Math.max(0, skills.count - skills.rows.length))
  const [nestStatus, setNestStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const nestLoading = useRef(false)

  const listed = rowAction(row, installed, signedIn)
  // An install that answered needs_setup stays "Needs setup" until the installs read says otherwise.
  const action: RowAction | null = pendingSetup !== null && listed?.kind === 'install'
    ? { key: 'stateNeedsSetup', kind: 'setup' }
    : listed

  const run = async (): Promise<void> => {
    if (action === null || action.kind === 'none') return
    if (action.kind === 'signIn') { await signIn(); return }
    if (action.kind === 'setup') {
      openLink(action.capability !== undefined ? setupUrl(origin, action.capability) : pendingSetup ?? new URL('/app/vault', origin).href)
      return
    }
    if (action.kind === 'enable' && action.capability !== undefined) { await setEnabled(action.capability.key, true); return }
    const result = await install(row.id)
    if (result.state === 'on') {
      setOutcome({ kind: 'added', prompt: result.try })
    } else if (result.state === 'needs_setup') {
      const url = result.signInUrl ?? result.connectUrl ?? new URL('/app/vault', origin).href
      setPendingSetup(url)
      openLink(url)
    }
  }
  const press = (): void => {
    setBusy(true)
    setOutcome(null)
    void run().catch((error: unknown) => {
      const failure = failureOf(error)
      setOutcome({ kind: 'error', text: failure.code === 'ahel-catalog/refused' && failure.message !== '' ? failure.message : t('actionFailed') })
    }).finally(() => { setBusy(false) })
  }

  const copy = (prompt: string): void => {
    void writeClipboard(prompt).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    })
  }

  const showMoreSkills = (): void => {
    if (nestLoading.current) return
    if (held.length > 0) {
      setNest([...nest, ...held.slice(0, NEST_STEP)])
      setHeld(held.slice(NEST_STEP))
      return
    }
    nestLoading.current = true
    setNestStatus('loading')
    browsePart(query, group.key, nest.length).then((part) => {
      setNest(current => [...current, ...part.rows.slice(0, NEST_STEP)])
      setHeld(part.rows.slice(NEST_STEP))
      setUnfetched(part.rows.length === 0 ? 0 : part.remaining)
      setNestStatus('idle')
    }, () => { setNestStatus('error') }).finally(() => { nestLoading.current = false })
  }
  const nestHasMore = held.length > 0 || unfetched > 0

  return (
    <Modal open headless title={row.name} onClose={onClose} className={css.sheet ?? ''}>
      <div className={css.bar}>
        <button type="button" className={css.close} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      <div className={css.body}>
        <div className={css.hero}>
          <AppTile tile={row.tile} size="lg" />
          <div className={css.heroText}>
            <h2 className={css.name}>{row.name}</h2>
            <span className={css.tags}>
              <Tag tone="outline">{t(row.kind === 'app' ? 'tagApp' : 'tagSkill')}</Tag>
            </span>
          </div>
        </div>
        {row.facts.length > 0 && (
          <ul className={css.facts}>
            {row.facts.map(fact => (
              <li key={fact.key} className={css.fact} data-fact={fact.key}>
                {fact.key === 'provenance' ? t(fact.official ? 'official' : 'community') : fact.text}
              </li>
            ))}
          </ul>
        )}
        {row.description !== null && row.description !== '' && <p className={css.description}>{row.description}</p>}
        <div className={css.actions}>
          {action !== null && (
            <Button variant="primary" disabled={busy || action.kind === 'none'} onClick={press} data-modal-autofocus>
              {t(action.key)}
            </Button>
          )}
          <Button variant="outline" onClick={() => { openLink(row.href) }}>{t('openOnAhel')}</Button>
        </div>
        {outcome?.kind === 'added' && (
          <div className={css.outcome} role="status">
            <span className={css.outcomeText}>{outcome.prompt === null ? t('stateAdded') : t('addedTry', { prompt: outcome.prompt })}</span>
            {outcome.prompt !== null && (
              <button type="button" className={css.copy} aria-label={t('addedTry', { prompt: outcome.prompt })}
                onClick={() => { if (outcome.prompt !== null) copy(outcome.prompt) }}>
                {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
              </button>
            )}
          </div>
        )}
        {outcome?.kind === 'error' && <p className={`${css.outcome} ${css.outcomeError}`} role="alert">{outcome.text}</p>}
        {skills !== null && nest.length > 0 && (
          <section className={css.nest} aria-labelledby="ahel-detail-nest">
            <h3 id="ahel-detail-nest" className={css.nestTitle}>{t('skillsFor', { vendor: skills.vendorName })}</h3>
            <ul className={css.nestList}>
              {nest.map(skill => (
                <AppRow key={skill.id} row={skill} installed={installed} signedIn={signedIn}
                  onOpen={(item) => { onSelect({ key: item.id, row: item, skills: null, copies: 0 }) }}
                  install={install} setEnabled={setEnabled} signIn={signIn} openLink={openLink} t={t} />
              ))}
            </ul>
            {nestStatus === 'error' && (
              <div className={css.nestNotice} role="alert">
                <span>{t('browseFailed')}</span>
                <Button variant="ghost" size="sm" onClick={showMoreSkills}>{t('retry')}</Button>
              </div>
            )}
            {nestHasMore && nestStatus !== 'error' && (
              <Button variant="outline" size="sm" className={css.nestMore} disabled={nestStatus === 'loading'} onClick={showMoreSkills}>
                {t('showMore')}
              </Button>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
