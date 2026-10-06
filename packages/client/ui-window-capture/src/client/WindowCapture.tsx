/**
 * The composer capture button, the capture notice toast and the global
 * shortcut row in Settings > General.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Button, IconFullscreenOutlineRegular, IconWarningOutlineRegular, ShortcutKeys, Toast, Tooltip, isDarwinDesktop,
} from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { WindowCapture, WindowCaptureResult, WindowCaptureShortcut, WindowCaptureShortcutResult } from '@ahel/dsh-window-capture/protocol'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import { acceleratorFromKey, acceleratorKeys } from './accelerator.ts'
import type { WindowCaptureKey } from './locales.ts'
import css from './WindowCapture.module.css'

/** Props the composer gives the capture button. */
export type WindowCaptureChipProps = PropsRuntime<'conversation.input.left'> & InjectFace<WindowCaptureInjected> & PropsLocale<'window-capture'>

/** Session identity of the composer that attaches a capture. */
export type WindowCaptureSessionId = WindowCaptureChipProps['sessionId']

/** Draft actions of that composer. */
export type WindowCaptureInputActions = WindowCaptureChipProps['inputActions']

/** One notice on display. */
export interface WindowCaptureNotice {
  readonly seq: number
  readonly key: WindowCaptureKey
  readonly message?: string
}

/** Plugin calls injected without exposing a Cordis Context to React. */
export interface WindowCaptureInjected {
  hooks: {
    /** Increments each time the shell reports a shortcut capture. */
    captured: HostObservable<number>
    shortcut: HostObservable<WindowCaptureShortcut | null>
    notice: HostObservable<WindowCaptureNotice | null>
  }
  /** @returns a capture of the front window that is not Ahel Desktop's. */
  capture(): Promise<WindowCaptureResult>
  /**
   * Track a mounted composer button so a shortcut capture with no visible composer opens a new chat.
   * @returns untrack.
   */
  track(element: HTMLElement): () => void
  /** @returns the waiting shortcut capture, once; null when another composer took it. */
  take(): Promise<WindowCaptureResult | null>
  /**
   * Add the capture's image and text to the draft through the composer's file attachment path and insert its caption line.
   * @returns null, or the notice key explaining why nothing was attached.
   */
  attach(sessionId: WindowCaptureSessionId, inputActions: WindowCaptureInputActions, capture: WindowCapture): WindowCaptureKey | null
  notify(key: WindowCaptureKey, message?: string): void
  dismissNotice(): void
  setShortcut(accelerator: string | null): Promise<WindowCaptureShortcutResult>
}

const FAILURE: Record<Extract<WindowCaptureResult, { ok: false }>['reason'], WindowCaptureKey> = {
  'permission': 'permission', 'no-window': 'noWindow', 'unsupported': 'unsupported', 'failed': 'failed',
}

function mac(): boolean {
  return isDarwinDesktop() || /Mac/u.test(navigator.userAgent)
}

/**
 * Composer button: click captures the front non-Ahel window; a shortcut
 * capture lands in the visible composer.
 * @param props - composer session, draft actions and plugin calls.
 * @returns the button.
 */
export function WindowCaptureChip(props: WindowCaptureChipProps) {
  const { sessionId, inputActions, useCaptured, useShortcut, capture, take, track, attach, notify, t } = props
  const captured = useCaptured(value => value)
  const shortcut = useShortcut(value => value)
  const supported = shortcut?.supported === true
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const deliver = (result: WindowCaptureResult | null): void => {
    if (result === null) return
    if (!result.ok) { notify(FAILURE[result.reason], result.message ?? ''); return }
    const failure = attach(sessionId, inputActions, result.capture)
    if (failure !== null) notify(failure)
  }
  const deliverRef = useRef(deliver)
  deliverRef.current = deliver
  useEffect(() => {
    const element = ref.current
    return element === null ? undefined : track(element)
  }, [supported, track])
  useEffect(() => {
    // Hidden composers of other sessions leave the capture to the visible one.
    const element = ref.current
    if (element === null || element.offsetParent === null) return
    void take().then((result) => { deliverRef.current(result) }, () => undefined)
  }, [captured, supported, take])
  const onClick = (): void => {
    if (busy) return
    setBusy(true)
    void capture().then(deliver, (error: unknown) => { notify('failed', error instanceof Error ? error.message : String(error)) })
      .finally(() => { setBusy(false) })
  }
  if (!supported) return null
  const keys = shortcut.accelerator === null ? undefined : acceleratorKeys(shortcut.accelerator, mac())
  return <Tooltip label={t(busy ? 'capturing' : 'button')} shortcutKeys={keys} side="top" delayMs={500}>
    <button ref={ref} type="button" className={css.chip} aria-label={t('button')} aria-busy={busy} disabled={busy}
      onMouseDown={(event) => { event.preventDefault() }} onClick={onClick}>
      <IconFullscreenOutlineRegular size={14} />
    </button>
  </Tooltip>
}

/** Props of the notice toast. */
export type WindowCaptureToastProps = PropsRuntime<'shell.overlay'> & InjectFace<WindowCaptureInjected> & PropsLocale<'window-capture'>

/**
 * @param props - the current notice and its dismissal.
 * @returns the toast, or nothing.
 */
export function WindowCaptureToast({ useNotice, dismissNotice, t }: WindowCaptureToastProps) {
  const notice = useNotice(value => value)
  if (notice === null) return null
  return <Toast key={`window-capture-${String(notice.seq)}`} text={t(notice.key, { message: notice.message ?? '' }).trim()}
    icon={<IconWarningOutlineRegular />} holdMs={notice.key === 'permission' ? 10_000 : 6000} onDone={dismissNotice} />
}

/** Props of the shortcut row. */
export type WindowCaptureSettingsRowProps = PropsRuntime<'settings.general.item'> & InjectFace<WindowCaptureInjected> & PropsLocale<'window-capture'>

/**
 * The global capture shortcut: its keys, Change (records the next key press), Turn off and reset.
 * @param props - the shortcut and its setter.
 * @returns the row.
 */
export function WindowCaptureSettingsRow({ useShortcut, setShortcut, t }: WindowCaptureSettingsRowProps) {
  const shortcut = useShortcut(value => value)
  const [recording, setRecording] = useState(false)
  const [problem, setProblem] = useState<WindowCaptureKey | null>(null)
  const onMac = mac()
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') { setRecording(false); return }
      const accelerator = acceleratorFromKey(event, onMac)
      if (accelerator === undefined) return
      if (accelerator === null) { setProblem('needsModifier'); return }
      setRecording(false)
      void setShortcut(accelerator).then((result) => { setProblem(result.ok ? null : result.reason) }, () => { setProblem('invalid') })
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [recording, onMac, setShortcut])
  if (shortcut === null) return null
  if (!shortcut.supported) {
    return <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('title')}</div>
        <div className={css.description}>{t('macOnly')}</div>
      </div>
    </div>
  }
  const change = (accelerator: string | null): void => {
    setProblem(null)
    void setShortcut(accelerator).then((result) => { setProblem(result.ok ? null : result.reason) }, () => { setProblem('invalid') })
  }
  const description = recording ? t('recording')
    : problem !== null ? t(problem)
      : shortcut.accelerator !== null && !shortcut.registered ? t('taken') : t('description')
  const defaultKeys = acceleratorKeys(shortcut.defaultAccelerator, onMac).join(onMac ? '' : '+')
  return <div className={css.row}>
    <div className={css.rowText}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.value}>
        {shortcut.accelerator === null ? t('off') : <ShortcutKeys keys={acceleratorKeys(shortcut.accelerator, onMac)} />}
      </div>
      <div className={css.description}>{description}</div>
    </div>
    <div className={css.actions}>
      <Button variant="outline" size="sm" onClick={() => { setProblem(null); setRecording(!recording) }}>
        {t(recording ? 'cancel' : 'change')}
      </Button>
      {shortcut.accelerator === null || shortcut.accelerator !== shortcut.defaultAccelerator
        ? <Button variant="ghost" size="sm" onClick={() => { change(shortcut.defaultAccelerator) }}>{t('reset', { keys: defaultKeys })}</Button>
        : <Button variant="ghost" size="sm" onClick={() => { change(null) }}>{t('turnOff')}</Button>}
    </div>
  </div>
}
