/**
 * The Detected-on-this-computer rows in Settings > Models: one row per coding
 * CLI the person installed, with a one-click Enable, a Refresh, and a fresh
 * detection whenever the window regains focus while the page is open.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular, IconWarningOutlineRegular, Toast, Tooltip, isDarwinDesktop } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { LocalCliId, LocalCliView } from '@ahel/dsh-llm-local-cli/types'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-settings-models/client'
import type {} from './locales.ts'
import css from './LocalCli.module.css'

/** Row order; matches the Host's detection order. */
const ORDER: readonly LocalCliId[] = ['claude-code', 'codex-cli', 'gemini-cli']

/** Oldest version each bridge supports, as the Host's detection enforces it. */
const MIN_VERSION: Record<LocalCliId, string> = { 'claude-code': '2.0', 'codex-cli': '0.100', 'gemini-cli': '0.11' }

/** CLIs the Host serves as a model route. */
const SERVED: ReadonlySet<LocalCliId> = new Set(['claude-code', 'codex-cli', 'gemini-cli'])

/** Vendor install pages for the empty state. */
const INSTALL_LINKS = [
  { key: 'installClaude', url: 'https://claude.com/claude-code' },
  { key: 'installCodex', url: 'https://developers.openai.com/codex/cli' },
  { key: 'installGemini', url: 'https://geminicli.com' },
] as const

/** Focus and visibility re-detect at most this often. */
const REDETECT_THROTTLE_MS = 10_000

/** One transient outcome on display. */
export interface LocalCliToastState {
  seq: number
  text: string
  tone: 'success' | 'warning'
}

/** Operations and live state the rows and the toast share; no credential reaches the browser. */
export interface LocalCliInjected {
  /** Probe every CLI again. */
  detect(): Promise<void>
  /** Turn a CLI on; the Host saves it as the default model when it serves it. @param id - the CLI. */
  enable(id: LocalCliId): Promise<void>
  /** Turn a CLI off. @param id - the CLI. */
  disable(id: LocalCliId): Promise<void>
  /** Open an absolute https URL outside the app. @param url - the page. */
  openLink(url: string): void
  /** Announce a transient outcome. @param text - resolved copy. @param tone - success or warning. */
  notify(text: string, tone: 'success' | 'warning'): void
  /** Take the toast down. */
  dismissToast(): void
  hooks: {
    /** The latest detection, or null before the first frame. */
    views: HostObservable<LocalCliView[] | null>
    /** The toast on display, or null. */
    toast: HostObservable<LocalCliToastState | null>
  }
}

/** Props of the Settings > Models rows. */
export type DetectedRowsProps = PropsRuntime<'settings.models.footer'> & InjectFace<LocalCliInjected> & PropsLocale<'local-cli'>

/** Props of the `shell.overlay` toast. */
export type LocalCliToastProps = PropsRuntime<'shell.overlay'> & InjectFace<LocalCliInjected> & PropsLocale<'local-cli'>

/** @returns the error's message, or its string form. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** @returns the plain tool name, without the " (installed)" suffix. */
function nameOf(view: LocalCliView): string {
  return view.label.replace(/ \(installed\)$/, '')
}

/**
 * Render the detected CLIs with their Enable or Disable action, or the install links when none is found.
 * @param props - composed slot props.
 * @returns the section.
 */
export function DetectedRows({ detect, enable, disable, openLink, notify, useViews, t }: DetectedRowsProps) {
  const views = useViews(value => value)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<LocalCliId | null>(null)
  const lastDetect = useRef(0)

  const runDetect = (): Promise<void> => {
    lastDetect.current = Date.now()
    return detect()
  }

  // Mount detects once; focus and visibility re-detect, throttled, only while the Models page is open.
  useEffect(() => {
    void runDetect().catch(() => undefined)
    const onFocus = (): void => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastDetect.current < REDETECT_THROTTLE_MS) return
      void runDetect().catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])

  const refresh = (): void => {
    setRefreshing(true)
    runDetect()
      .catch((error: unknown) => { notify(t('refreshFailed', { message: messageOf(error) }), 'warning') })
      .finally(() => { setRefreshing(false) })
  }

  const toggle = (view: LocalCliView): void => {
    const name = nameOf(view)
    setBusy(view.id)
    const turnOff = (): Promise<void> => disable(view.id)
      .catch((error: unknown) => { notify(t('disableFailed', { name, message: messageOf(error) }), 'warning') })
    // Enabling a served CLI also makes it the default model, a change felt on every page.
    const turnOn = (): Promise<void> => enable(view.id).then(
      () => { notify(t(SERVED.has(view.id) ? 'enabled' : 'enabledNoDefault', { name }), 'success') },
      (error: unknown) => { notify(t('enableFailed', { name, message: messageOf(error) }), 'warning') },
    )
    void (view.enabled ? turnOff() : turnOn()).finally(() => { setBusy(null) })
  }

  const rows = views === null
    ? []
    : ORDER.flatMap(id => views.filter(view => view.id === id && (view.installed || view.enabled)))

  return (
    <section className={css.section}>
      <div className={css.header}>
        <div className={css.heading}>{isDarwinDesktop() || /Mac/.test(navigator.userAgent) ? t('headingMac') : t('headingOther')}</div>
        <Button
          variant="ghost"
          size="sm"
          icon={<span className={refreshing ? css.spinning : undefined}><IconRefreshOutlineRegular /></span>}
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={refresh}
        >
          {t('refresh')}
        </Button>
      </div>
      {views === null && <div className={css.caption}>{t('looking')}</div>}
      {views !== null && rows.length === 0 && (
        <div className={css.empty}>
          <div className={css.emptyText}>{t('empty')}</div>
          <div className={css.links}>
            {INSTALL_LINKS.map(link => (
              <button key={link.key} type="button" className={css.link} onClick={() => { openLink(link.url) }}>
                {t(link.key)}
              </button>
            ))}
          </div>
        </div>
      )}
      {rows.map(view => (
        <Row key={view.id} view={view} busy={busy === view.id} onToggle={() => { toggle(view) }} t={t} />
      ))}
      <div className={css.caption}>{t('caption')}</div>
    </section>
  )
}

/**
 * One CLI row: label, state caption and its single action.
 * @param props.view - the detected CLI.
 * @param props.busy - an enable or disable is in flight.
 * @param props.onToggle - turn the CLI on or off.
 * @param props.t - locale seat.
 * @returns the row.
 */
function Row({ view, busy, onToggle, t }: { view: LocalCliView; busy: boolean; onToggle: () => void; t: DetectedRowsProps['t'] }) {
  const min = MIN_VERSION[view.id]
  const blocked = !view.enabled && (!SERVED.has(view.id) || view.login === 'signed-out' || !view.versionOk)
  const reason = !SERVED.has(view.id)
    ? t('comingSoon')
    : view.login === 'signed-out'
      ? t('enableSignedOut', { hint: view.signInHint })
      : !view.versionOk ? t('enableTooOld', { min }) : ''
  const button = (
    <Button variant={view.enabled ? 'outline' : 'primary'} size="sm" disabled={busy || blocked} onClick={onToggle}>
      {view.enabled ? t('disable') : t('enable')}
    </Button>
  )
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.rowTitle}>{view.label}</div>
        <div className={css.caption}>{captionOf(view, min, t)}</div>
      </div>
      {blocked
        ? <Tooltip label={reason} side="top" align="end" portal><span className={css.anchor} tabIndex={0}>{button}</span></Tooltip>
        : button}
    </div>
  )
}

/** @returns the row's state line. */
function captionOf(view: LocalCliView, min: string, t: DetectedRowsProps['t']): string {
  if (!view.installed) return t('notFound')
  if (view.version === undefined) return t('noVersion')
  if (!view.versionOk) return t('tooOld', { min })
  if (view.login === 'signed-out') return t('signedOut', { hint: view.signInHint })
  if (view.login === 'signed-in') return t('signedIn', { version: view.version })
  return t('versionOnly', { version: view.version })
}

/**
 * The `shell.overlay` entry: one toast at a time, held outside the Settings page so closing it does not cut the toast.
 * @param props - composed slot props.
 * @returns the toast on display, or null.
 */
export function LocalCliToast({ useToast, dismissToast }: LocalCliToastProps) {
  const toast = useToast(value => value)
  if (toast === null) return null
  return toast.tone === 'success'
    ? <Toast key={`local-cli-${String(toast.seq)}`} text={toast.text} tone="success" onDone={dismissToast} />
    : <Toast key={`local-cli-${String(toast.seq)}`} text={toast.text} icon={<IconWarningOutlineRegular />} holdMs={6000} onDone={dismissToast} />
}
