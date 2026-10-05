/**
 * One Discover row, as ahel.ai's DiscoverRow draws it: the 44px tile, the
 * name and its kind badge, the one fact line, an optional description, and
 * one state control on the right.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CatalogCapability, CatalogFactPart, CatalogInstalled, CatalogRow } from '@ahel/dsh-ahel-account/types'
import type { AhelAccountKey } from '../locales.ts'
import type { CatalogFaceProps, OpenRow } from './contract.ts'
import { AppTile } from './AppTile.tsx'
import css from './Catalog.module.css'

/** What the state button does when pressed. */
type RowActionKind = 'install' | 'enable' | 'setup' | 'signIn' | 'none'

/** The look of a state control; ahel's `STATE_CLASS`. */
export type RowActionLook = 'primary' | 'dark' | 'secondary' | 'added' | 'on' | 'setup'

/** The state button of one row; null shows no button. */
export interface RowAction {
  readonly key: AhelAccountKey
  readonly kind: RowActionKind
  readonly look: RowActionLook
  readonly capability?: CatalogCapability
}

/** Button label, action and look per listing state, for a row the person has not installed. */
const LISTING_ACTION: Record<CatalogRow['state'], RowAction | null> = {
  'connect': { key: 'stateConnect', kind: 'install', look: 'primary' },
  'add': { key: 'stateAdd', kind: 'install', look: 'dark' },
  'added': { key: 'stateAdded', kind: 'none', look: 'added' },
  'on': { key: 'stateOn', kind: 'none', look: 'on' },
  'needs-setup': { key: 'stateNeedsSetup', kind: 'install', look: 'setup' },
  'install': { key: 'stateInstall', kind: 'install', look: 'dark' },
  'turn-on': { key: 'stateTurnOn', kind: 'install', look: 'secondary' },
  'unavailable': null,
}

/** Button classes per look. */
export const LOOK_CLASS: Record<RowActionLook, string> = {
  primary: `${css.btn} ${css.btnPrimary} ${css.state}`,
  dark: `${css.btn} ${css.btnDark} ${css.state}`,
  secondary: `${css.btn} ${css.btnSecondary} ${css.state}`,
  added: `${css.btn} ${css.stateAdded} ${css.state}`,
  on: `${css.btn} ${css.stateOn} ${css.state}`,
  setup: `${css.btn} ${css.stateSetup} ${css.state}`,
}

/**
 * The installed capability a listing row stands for.
 * @param row - listing row.
 * @param installed - the person's installs, if read.
 * @returns the capability installed from the row, if any.
 */
export function capabilityOf(row: CatalogRow, installed: CatalogInstalled | null): CatalogCapability | undefined {
  // A catalog item's stack key is its id slugged ("ahel.datasets/epss" is "ahel-datasets-epss").
  const key = row.id.replace(/[^a-z0-9:]+/gi, '-').toLowerCase()
  return installed?.rows.find(item => item.itemId === row.id || item.key === row.id || item.key === key)
}

/**
 * Work out the row's state button from the person's installs, falling back to the listing state.
 * @param row - listing row.
 * @param installed - the person's installs, if read.
 * @param signedIn - whether an Ahel account is signed in.
 * @returns the button, or null for an unavailable row.
 */
export function rowAction(row: CatalogRow, installed: CatalogInstalled | null, signedIn: boolean): RowAction | null {
  const capability = capabilityOf(row, installed)
  if (capability?.state === 'unavailable' || (capability === undefined && row.state === 'unavailable')) return null
  // Signed out, the row wears ahel.ai's own label and the press starts the sign-in.
  if (!signedIn) {
    const listed = LISTING_ACTION[row.state]
    return listed === null ? null : { ...listed, kind: 'signIn' }
  }
  if (capability === undefined) return LISTING_ACTION[row.state]
  switch (capability.state) {
    case 'on': return { key: 'stateOn', kind: 'none', look: 'on', capability }
    case 'off': return { key: 'stateTurnOn', kind: 'enable', look: 'secondary', capability }
    case 'needs_setup': return { key: 'stateNeedsSetup', kind: 'setup', look: 'setup', capability }
    default: return { key: 'stateTurnOn', kind: 'install', look: 'secondary', capability }
  }
}

/**
 * The ahel.ai page that finishes an installed capability's setup.
 * @param origin - the ahel.ai origin the row came from.
 * @param capability - the capability that needs setup.
 * @returns its sign-in page, or the Vault.
 */
export function setupUrl(origin: string, capability: CatalogCapability): string {
  if (capability.signInUrl !== undefined) return capability.signInUrl
  const vault = new URL('/app/vault', origin)
  if (capability.key.startsWith('app:')) vault.searchParams.set('app', capability.key.slice(4))
  return vault.href
}

/**
 * Read a Remote failure's code and message from a rejection.
 * @param error - the rejection value.
 * @returns its code, if any, and message.
 */
export function failureOf(error: unknown): { code: string | null; message: string } {
  const value = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown } : {}
  return { code: typeof value.code === 'string' ? value.code : null, message: typeof value.message === 'string' ? value.message : '' }
}

/** The check before Official and Added; ahel's `Check`. */
export function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/**
 * One part of the fact line.
 * @param props.part - the part.
 * @param props.t - the dictionary.
 * @returns the part's element.
 */
function Part({ part, t }: { part: CatalogFactPart; t: CatalogFaceProps['t'] }) {
  switch (part.key) {
    case 'provenance':
      return part.official ? <span className={css.official}><Check />{t('official')}</span> : <span>{t('community')}</span>
    case 'tools': return <b className={css.tools}>{part.text}</b>
    case 'price': return <span className={css.price} data-source={part.source}>{part.text}</span>
    default: return <span>{part.text}</span>
  }
}

/**
 * The one fact line, parts separated by a middle dot.
 * @param props.parts - the row's facts.
 * @param props.unavailable - append "unavailable".
 * @param props.t - the dictionary.
 * @returns the line, or null with nothing to say.
 */
export function FactLine({ parts, unavailable, t }: { parts: readonly CatalogFactPart[]; unavailable: boolean; t: CatalogFaceProps['t'] }) {
  const items: ReactNode[] = parts.map((part, index) => <Part key={`${part.key}-${index}`} part={part} t={t} />)
  if (unavailable) items.push(<span key="unavailable" className={css.unavailable}>{t('unavailableFact')}</span>)
  if (items.length === 0) return null
  return (
    <p className={css.line}>
      {items.map((item, index) => (
        <span key={index} className={css.part}>
          {index > 0 && <span className={css.sep} aria-hidden="true">·</span>}
          {item}
        </span>
      ))}
    </p>
  )
}

/** Props of one Discover row. */
export type AppRowProps = Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly row: CatalogRow
  /** The person's installs, or null before the first read. */
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  /** Opens the row; defaults to its ahel.ai page. */
  readonly onOpen?: OpenRow | undefined
  /** A vendor's skill under its App: the 32px tile. */
  readonly nested?: boolean
  /** Show the one-line description under the facts (search results). */
  readonly showDescription?: boolean
  /** Nested rows drawn behind the left rule. */
  readonly children?: ReactNode
}

/**
 * Render one row.
 * @param props - the row, the person's installs and the catalog actions.
 * @returns the row.
 */
export function AppRow(props: AppRowProps) {
  const { row, installed, signedIn, onOpen, nested = false, showDescription = false, children } = props
  const { install, setEnabled, signIn, openLink, t } = props
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [pendingSetup, setPendingSetup] = useState<string | null>(null)
  const origin = new URL(row.href).origin
  const listed = rowAction(row, installed, signedIn)
  // An install that answered needs_setup stays "Needs setup" until the installs read says otherwise.
  const action: RowAction | null = pendingSetup !== null && listed?.kind === 'install'
    ? { key: 'stateNeedsSetup', kind: 'setup', look: 'setup' }
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
      setNote({ text: result.try === null ? t('stateAdded') : t('addedTry', { prompt: result.try }), error: false })
    } else if (result.state === 'needs_setup') {
      const url = result.signInUrl ?? result.connectUrl ?? new URL('/app/vault', origin).href
      setPendingSetup(url)
      openLink(url)
    }
  }
  const press = (): void => {
    setBusy(true)
    setNote(null)
    void run().catch((error: unknown) => {
      const failure = failureOf(error)
      setNote({ text: failure.code === 'ahel-catalog/refused' && failure.message !== '' ? failure.message : t('actionFailed'), error: true })
    }).finally(() => { setBusy(false) })
  }
  const open = (): void => { (onOpen ?? ((item: CatalogRow) => { openLink(item.href) }))(row) }

  return (
    <li className={nested ? `${css.row} ${css.nested}` : css.row} data-kind={row.kind}>
      <div className={css.vrow}>
        <AppTile tile={row.tile} size={nested ? 'sm' : 'md'} />
        <div className={css.body}>
          <div className={css.name}>
            <button type="button" className={css.nameLink} onClick={open}>{row.name}</button>
            <span className={row.kind === 'skill' ? `${css.kind} ${css.kindSkill}` : css.kind}>{t(row.kind === 'app' ? 'tagApp' : 'tagSkill')}</span>
          </div>
          <FactLine parts={row.facts} unavailable={action === null} t={t} />
          {showDescription && row.description !== null && row.description !== '' && <p className={css.desc}>{row.description}</p>}
        </div>
        <div className={css.rowControls}>
          {action !== null && (
            <button type="button" className={LOOK_CLASS[action.look]} disabled={busy || action.kind === 'none'} onClick={press}>
              {(action.look === 'added' || action.look === 'on') && <Check />}
              {t(action.key)}
            </button>
          )}
        </div>
      </div>
      {note !== null && <p className={note.error ? `${css.rowNote} ${css.rowNoteError}` : css.rowNote} role="status">{note.text}</p>}
      {children}
    </li>
  )
}
