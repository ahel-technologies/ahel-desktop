/**
 * The in-app Connect sheet over the workspace vault: a key app's form (values
 * go to the Host and are sealed on ahel.ai, never kept here), a sign-in app's
 * hand-off to the browser, or the way to finish on ahel.ai.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular, Modal, writeClipboard,
} from '@ahel/dsh-client-ui-primitives'
import type {
  AhelIcon, CatalogCapability, CatalogInstalled, CatalogRowTile, KeyConnectAnswer, KeyConnectView,
} from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps, DiscoverInjected } from './contract.ts'
import { AppTile } from './AppTile.tsx'
import catalogCss from './Catalog.module.css'
import drawerCss from './DetailDrawer.module.css'
import css from './ConnectSheet.module.css'

/** The face calls the sheet needs; Discover and Your apps provide them through context. */
export type ConnectFace = Pick<DiscoverInjected, 'connectPanel' | 'connect' | 'refreshInstalled' | 'openLink'>

const ConnectFaceContext = createContext<ConnectFace | null>(null)

/** @returns the Connect face of the enclosing catalog panel, or null outside one. */
export function useConnectFace(): ConnectFace | null {
  return useContext(ConnectFaceContext)
}

/**
 * Wrap a catalog panel so its rows and sheets reach the Connect calls without threading props.
 * @param Page - the panel component.
 * @returns the panel with the face in context.
 */
export function withConnect<P extends ConnectFace & object>(Page: (props: P) => ReactNode): (props: P) => ReactNode {
  function WithConnect(props: P) {
    const { connectPanel, connect, refreshInstalled, openLink } = props
    const face = useMemo<ConnectFace>(
      () => ({ connectPanel, connect, refreshInstalled, openLink }), [connectPanel, connect, refreshInstalled, openLink],
    )
    return <ConnectFaceContext.Provider value={face}><Page {...props} /></ConnectFaceContext.Provider>
  }
  WithConnect.displayName = `WithConnect(${Page.name})`
  return WithConnect
}

/** What the sheet connects. */
export interface ConnectTarget {
  /** The name `connectPanel` takes: the item id, else the stack key, else the listing id. */
  readonly app: string
  readonly name: string
  /** The installed row's stack key, to notice when it turns on. */
  readonly key: string | null
  /** The browser sign-in for an OAuth app, when ahel.ai gave one. */
  readonly signInUrl: string | null
  /** The ahel.ai page that finishes setup when ahel.ai has no desktop vault route yet. */
  readonly fallbackUrl: string
}

/**
 * The sheet's target for an installed capability.
 * @param capability - the installed row.
 * @param fallbackUrl - its ahel.ai setup page.
 * @returns the target.
 */
export function targetOf(capability: CatalogCapability, fallbackUrl: string): ConnectTarget {
  return {
    app: capability.itemId ?? capability.key, name: capability.name, key: capability.key,
    signInUrl: capability.signInUrl ?? null, fallbackUrl,
  }
}

/** A Remote failure as the sheet shows it. */
export interface TeamFailure {
  readonly code: string | null
  /** ahel.ai's own sentence for a refusal, else null. */
  readonly own: string | null
  /** The ahel.ai page a refusal points to, such as the vault for a choice of accounts. */
  readonly webUrl: string | null
}

/**
 * Read an `ahel-team/*` rejection.
 * @param error - the rejection value.
 * @returns its code, ahel.ai's sentence and link.
 */
export function teamFailure(error: unknown): TeamFailure {
  const value = typeof error === 'object' && error !== null ? error as { code?: unknown; message?: unknown; details?: unknown } : {}
  const code = typeof value.code === 'string' ? value.code : null
  const message = typeof value.message === 'string' && value.message !== '' ? value.message : null
  const details = typeof value.details === 'object' && value.details !== null ? value.details as { webUrl?: unknown } : {}
  const own = code === 'ahel-team/refused' || code === 'ahel-team/forbidden' ? message : null
  return { code, own, webUrl: typeof details.webUrl === 'string' ? webLink(details.webUrl) : null }
}

/**
 * Accept only a web page from ahel.ai.
 * @param url - absolute URL.
 * @returns the URL, or null for anything that is not http(s).
 */
export function webLink(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch (_invalid) {
    return null
  }
}

/**
 * The vendor tile from the panel's icon.
 * @param icon - ahel.ai's icon, if any.
 * @param name - the vendor name, for letters.
 * @param base - the origin a relative logo path resolves against.
 * @returns the tile.
 */
function tileOf(icon: AhelIcon | null | undefined, name: string, base: string): CatalogRowTile {
  const letters = name.split(/[\s\-_.:/]+/).filter(word => word !== '').slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?'
  if (icon?.type === 'logo') {
    let mark: string | null = null
    try { mark = webLink(new URL(icon.src, base).href) } catch (_invalid) { mark = null }
    return { text: letters, tone: 'plain', mark }
  }
  if (icon?.type === 'letter') return { text: icon.letter, tone: 'plain', mark: null }
  if (icon?.type === 'glyph') return { text: icon.glyph, tone: 'plain', mark: null }
  return { text: letters, tone: 'plain', mark: null }
}

/**
 * The starting values of a key form: each field's default.
 * @param panel - the key panel.
 * @returns field id to value.
 */
function initialValues(panel: KeyConnectView | null): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of panel?.fields ?? []) values[field.id] = field.defaultValue ?? ''
  return values
}

/** What reading the app's Connect state left. */
type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly answer: KeyConnectAnswer }
  | { readonly kind: 'outdated' }
  | { readonly kind: 'error'; readonly text: string }

/** How long the Try chip shows its check after a copy. */
const COPIED_MS = 1_000

/** Props of the Connect sheet. */
export type ConnectSheetProps = ConnectFace & Pick<CatalogFaceProps, 't'> & {
  readonly target: ConnectTarget
  /** The person's installs, to close the sheet once a browser sign-in switches the row on. */
  readonly installed: CatalogInstalled | null
  readonly onClose: () => void
}

/**
 * Render the Connect sheet. Mount it only while open: the typed values live in its state and go with it.
 * @param props - the target, the installs and the Connect calls.
 * @returns the right-side sheet.
 */
export function ConnectSheet(props: ConnectSheetProps) {
  const { target, installed, onClose, connectPanel, connect, refreshInstalled, openLink, t } = props
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ readonly ask: string | null } | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [copied, setCopied] = useState(false)
  const alive = useRef(true)
  const fellBack = useRef(false)

  const read = (): void => {
    setLoad({ kind: 'loading' })
    connectPanel(target.app).then((answer) => {
      if (!alive.current) return
      setLoad({ kind: 'ready', answer })
      setValues(initialValues(answer.panel))
    }, (error: unknown) => {
      if (!alive.current) return
      const failure = teamFailure(error)
      if (failure.code === 'ahel-team/outdated') {
        setLoad({ kind: 'outdated' })
        // Today's path: ahel.ai finishes the setup in the browser.
        if (!fellBack.current) { fellBack.current = true; openLink(target.fallbackUrl) }
        return
      }
      setLoad({ kind: 'error', text: failure.own ?? t('actionFailed') })
    })
  }
  useEffect(() => {
    alive.current = true
    read()
    return () => { alive.current = false }
    // One read per target.
  }, [target.app])

  const answer = load.kind === 'ready' ? load.answer : null
  const panel = answer?.panel ?? null
  const signInUrl = target.signInUrl === null ? null : webLink(target.signInUrl)
  // A browser flow finishes outside the app: re-read on focus and close once the row is on.
  const browserFlow = (load.kind === 'ready' && panel === null) || load.kind === 'outdated'
  const row = installed?.rows.find(item =>
    (target.key !== null && item.key === target.key) || item.itemId === target.app || item.key === target.app)
  const rowOn = row?.state === 'on'
  const wasOn = useRef(rowOn)
  useEffect(() => {
    if (!rowOn) { wasOn.current = false; return }
    if (!wasOn.current && browserFlow) onClose()
  }, [rowOn, browserFlow, onClose])
  useEffect(() => {
    if (!browserFlow) return
    const onFocus = (): void => { void refreshInstalled().catch(() => undefined) }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [browserFlow, refreshInstalled])

  const vendor = panel?.vendor ?? target.name
  const webUrl = answer === null ? null : webLink(answer.webUrl)
  const tile = tileOf(panel?.icon ?? answer?.signIn?.icon, vendor, webUrl ?? target.fallbackUrl)
  const missing = panel?.fields.some(field => field.required && (values[field.id] ?? '').trim() === '') ?? true
  const connected = saved !== null || (panel?.connected === true && panel.fields.length === 0)
  const ask = saved?.ask ?? panel?.ask ?? null

  const save = (event: FormEvent): void => {
    event.preventDefault()
    if (answer === null || panel === null || busy || missing) return
    const typed: Record<string, string> = {}
    for (const field of panel.fields) {
      const value = (values[field.id] ?? '').trim()
      if (value !== '') typed[field.id] = value
    }
    setBusy(true)
    setSaveError(null)
    connect(panel.app, typed).then((result) => {
      if (!alive.current) return
      const next = result.panel
      if (next !== null && !next.connected && next.fields.length > 0) {
        // ahel.ai still misses values: show the form it sent back.
        setLoad({ kind: 'ready', answer: { ...answer, panel: next } })
        setValues(initialValues(next))
        return
      }
      setValues({})
      setSaved({ ask: next?.ask ?? panel.ask })
    }, (error: unknown) => {
      if (!alive.current) return
      const failure = teamFailure(error)
      setSaveError(failure.code === 'ahel-team/outdated' ? t('connectUpdateAhel') : failure.own ?? t('actionFailed'))
    }).finally(() => { if (alive.current) setBusy(false) })
  }

  const copy = (prompt: string): void => {
    void writeClipboard(prompt).then((ok) => {
      if (!ok || !alive.current) return
      setCopied(true)
      window.setTimeout(() => { if (alive.current) setCopied(false) }, COPIED_MS)
    })
  }

  const open = (url: string | null): void => { if (url !== null) openLink(url) }

  let content: ReactNode
  if (load.kind === 'loading') {
    content = <p className={css.muted} role="status">{t('connectLoading', { name: target.name })}</p>
  } else if (load.kind === 'error') {
    content = (
      <>
        <p className={`${drawerCss.outcome} ${drawerCss.outcomeError}`} role="alert">{load.text}</p>
        <div className={drawerCss.actions}>
          <button type="button" className={`${catalogCss.btn} ${catalogCss.btnSecondary}`} onClick={read}>{t('retry')}</button>
          <button type="button" className={`${catalogCss.btn} ${catalogCss.btnGhost}`} onClick={() => { open(webLink(target.fallbackUrl)) }}>
            {t('connectFinishOnAhel')}
          </button>
        </div>
      </>
    )
  } else if (load.kind === 'outdated') {
    content = (
      <>
        <p className={css.muted}>{t('connectUpdateAhel')}</p>
        <div className={drawerCss.actions}>
          <button type="button" className={`${catalogCss.btn} ${catalogCss.btnDark}`} onClick={() => { open(webLink(target.fallbackUrl)) }}>
            {t('connectFinishOnAhel')}
          </button>
        </div>
      </>
    )
  } else if (connected) {
    content = (
      <div className={css.connected} role="status">
        <p className={css.connectedLine}><IconCheckOutlineRegular size={16} />{t('connectConnected')}</p>
        {ask !== null && (
          <button type="button" className={css.try} title={t('connectCopyTry')} onClick={() => { copy(ask) }}>
            <span className={css.tryText}>{t('connectTry', { prompt: ask })}</span>
            {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
          </button>
        )}
      </div>
    )
  } else if (answer?.canManage !== true) {
    content = <p className={css.muted}>{t('connectAskManager')}</p>
  } else if (panel !== null) {
    const keyPage = panel.keyPageUrl === null ? null : webLink(panel.keyPageUrl)
    content = (
      <form className={css.form} onSubmit={save} autoComplete="off">
        {(keyPage !== null || (panel.keySteps?.length ?? 0) > 0) && (
          <section className={css.steps}>
            {keyPage !== null
              ? <button type="button" className={css.keyLink} onClick={() => { open(keyPage) }}>{t('connectGetKey', { vendor: panel.vendor })}</button>
              : <h3 className={css.stepsTitle}>{t('connectGetKey', { vendor: panel.vendor })}</h3>}
            {(panel.keySteps?.length ?? 0) > 0 && (
              <ol className={css.stepList}>
                {panel.keySteps?.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
            )}
          </section>
        )}
        {panel.readOnlyEnough && <p className={css.hint}>{t('connectReadOnly')}</p>}
        {panel.fields.map((field, index) => (
          <label key={field.id} className={css.field}>
            <span className={css.label}>{field.label}{field.required ? '' : ` ${t('connectOptional')}`}</span>
            <input className={css.input} type={field.secret ? 'password' : 'text'} name={field.id} value={values[field.id] ?? ''}
              placeholder={field.placeholder} required={field.required} spellCheck={false} autoCapitalize="off" autoCorrect="off"
              autoComplete={field.secret ? 'new-password' : 'off'} data-modal-autofocus={index === 0 ? '' : undefined}
              onChange={(event) => { const value = event.target.value; setValues(current => ({ ...current, [field.id]: value })) }} />
          </label>
        ))}
        {saveError !== null && <p className={`${drawerCss.outcome} ${drawerCss.outcomeError}`} role="alert">{saveError}</p>}
        <div className={drawerCss.actions}>
          <button type="submit" className={`${catalogCss.btn} ${catalogCss.btnPrimary}`} disabled={busy || missing}>
            {busy ? t('connectSaving') : t('connectSave')}
          </button>
        </div>
        <p className={css.muted}>{t('connectPrivacy')}</p>
      </form>
    )
  } else if (signInUrl !== null) {
    content = (
      <>
        {answer.signIn?.expired === true && <p className={css.expired}>{t('connectExpired')}</p>}
        <p className={css.lead}>{t('connectSignInLead', { name: target.name })}</p>
        <div className={drawerCss.actions}>
          <button type="button" className={`${catalogCss.btn} ${catalogCss.btnPrimary}`} data-modal-autofocus
            onClick={() => { setWaiting(true); open(signInUrl) }}>
            {t('connectSignInWith', { name: vendor })}
          </button>
        </div>
        {waiting && <p className={css.muted} role="status">{t('connectWaiting', { name: target.name })}</p>}
      </>
    )
  } else {
    content = (
      <>
        <p className={css.lead}>{t('connectFinishLead', { name: target.name })}</p>
        <div className={drawerCss.actions}>
          <button type="button" className={`${catalogCss.btn} ${catalogCss.btnDark}`} disabled={webUrl === null} data-modal-autofocus
            onClick={() => { setWaiting(true); open(webUrl) }}>
            {t('connectFinishOnAhel')}
          </button>
        </div>
        {waiting && <p className={css.muted} role="status">{t('connectWaiting', { name: target.name })}</p>}
      </>
    )
  }

  return (
    <Modal open headless title={t('connectTitle', { name: target.name })} onClose={onClose}
      className={`${drawerCss.sheet ?? ''} ${catalogCss.tokens ?? ''}`}>
      <div className={drawerCss.bar}>
        <button type="button" className={drawerCss.close} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      <div className={drawerCss.body}>
        <div className={drawerCss.hero}>
          <AppTile tile={tile} size="lg" />
          <div className={drawerCss.heroText}>
            <h2 className={drawerCss.name}>{t('connectTitle', { name: target.name })}</h2>
            {vendor !== target.name && <span className={css.muted}>{vendor}</span>}
          </div>
        </div>
        {content}
      </div>
    </Modal>
  )
}
