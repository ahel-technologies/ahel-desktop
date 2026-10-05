/** One Discover result: tile, name, tags, one fact line, price, and the one state button. */
import { useState } from 'react'
import { Button, Tag } from '@ahel/dsh-client-ui-primitives'
import type { CatalogCapability, CatalogInstalled, CatalogRow } from '@ahel/dsh-ahel-account/types'
import type { AhelAccountKey } from '../locales.ts'
import type { CatalogFaceProps, OpenRow } from './contract.ts'
import { AppTile } from './AppTile.tsx'
import css from './Catalog.module.css'

/** What the state button does when pressed. */
type RowActionKind = 'install' | 'enable' | 'setup' | 'signIn' | 'none'

/** The state button of one row; null shows no button. */
export interface RowAction {
  readonly key: AhelAccountKey
  readonly kind: RowActionKind
  readonly capability?: CatalogCapability
}

/** Button label and action per listing state, for a row the person has not installed. */
const LISTING_ACTION: Record<CatalogRow['state'], RowAction | null> = {
  'connect': { key: 'stateConnect', kind: 'install' },
  'add': { key: 'stateAdd', kind: 'install' },
  'added': { key: 'stateAdded', kind: 'none' },
  'on': { key: 'stateOn', kind: 'none' },
  'needs-setup': { key: 'stateNeedsSetup', kind: 'install' },
  'install': { key: 'stateInstall', kind: 'install' },
  'turn-on': { key: 'stateTurnOn', kind: 'install' },
  'unavailable': null,
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
  if (!signedIn) return { key: 'signInToAdd', kind: 'signIn' }
  if (capability === undefined) return LISTING_ACTION[row.state]
  switch (capability.state) {
    case 'on': return { key: 'stateOn', kind: 'none', capability }
    case 'off': return { key: 'stateTurnOn', kind: 'enable', capability }
    case 'needs_setup': return { key: 'stateNeedsSetup', kind: 'setup', capability }
    default: return { key: 'stateTurnOn', kind: 'install', capability }
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

/** Props of one Discover result row. */
export type AppRowProps = Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly row: CatalogRow
  /** The person's installs, or null before the first read. */
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  /** Opens the row; defaults to its ahel.ai page. */
  readonly onOpen?: OpenRow | undefined
  /** Hide the kind and Official tags, for rows whose list already says what they are. */
  readonly bare?: boolean
}

/**
 * Render one result row.
 * @param props - the row, the person's installs and the catalog actions.
 * @returns the row.
 */
export function AppRow({ row, installed, signedIn, onOpen, bare = false, install, setEnabled, signIn, openLink, t }: AppRowProps) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [pendingSetup, setPendingSetup] = useState<string | null>(null)
  const origin = new URL(row.href).origin
  const listed = rowAction(row, installed, signedIn)
  // An install that answered needs_setup stays "Needs setup" until the installs read says otherwise.
  const action: RowAction | null = pendingSetup !== null && listed?.kind === 'install'
    ? { key: 'stateNeedsSetup', kind: 'setup' }
    : listed
  const price = row.facts.find(fact => fact.key === 'price')?.text
  const line = row.description ?? row.facts.filter(fact => fact.key === 'by' || fact.key === 'runs').map(fact => fact.text).join(' · ')

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

  return (
    <li className={css.row}>
      <div className={css.rowBody}>
        <button type="button" className={css.rowMain} onClick={() => { (onOpen ?? ((item) => { openLink(item.href) }))(row) }}>
          <AppTile tile={row.tile} />
          <span className={css.rowText}>
            <span className={css.rowHead}>
              <span className={css.rowName}>{row.name}</span>
              {!bare && <Tag tone="outline">{t(row.kind === 'app' ? 'tagApp' : 'tagSkill')}</Tag>}
              {!bare && row.official && <Tag tone="info">{t('official')}</Tag>}
            </span>
            {line !== '' && <span className={css.rowLine}>{line}</span>}
          </span>
        </button>
        <div className={css.rowEnd}>
          {price !== undefined && <Tag tone="neutral">{price}</Tag>}
          {action !== null && (
            <Button variant="outline" size="sm" disabled={busy || action.kind === 'none'} onClick={press}>
              {t(action.key)}
            </Button>
          )}
        </div>
      </div>
      {note !== null && (
        <p className={note.error ? `${css.rowNote} ${css.rowNoteError}` : css.rowNote} role="status">{note.text}</p>
      )}
    </li>
  )
}
