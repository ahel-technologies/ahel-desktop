/** Settings > General > Dictation: who transcribes, in which language, and the desktop push-to-talk shortcut. */
import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { SpeechProviderId, SpeechSelectionPatch } from '@ahel/dsh-experimental-speech-to-text/types'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type { SpeechReadiness } from './readiness.ts'
import { DICTATION_ACCELERATORS, presentAccelerator, type DesktopDictationBridge, type DictationHotkeyState } from './hotkey.ts'
import { NS } from './locales.ts'
import css from './DictationRow.module.css'

/** Injected face shared with the composer control. */
export interface DictationRowInjected {
  hooks: { speechReadiness: HostObservable<SpeechReadiness> }
  configure: (patch: SpeechSelectionPatch) => Promise<void>
  /** The desktop shell's shortcut bridge; undefined in a browser, which has no global shortcut. */
  hotkey: DesktopDictationBridge | undefined
}

/** Props of the Dictation row. */
export type DictationRowProps = PropsRuntime<'settings.general.item'> & InjectFace<DictationRowInjected> & PropsLocale<typeof NS>

const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

function languageName(code: string, auto: string): string {
  if (code === 'auto') return auto
  try {
    return new Intl.DisplayNames([typeof navigator === 'undefined' ? 'en' : navigator.language], { type: 'language' }).of(code) ?? code
  } catch (_unknown) {
    return code
  }
}

/**
 * Render the dictation preferences.
 * @param props - readiness, preference writers and localized copy.
 * @returns the row.
 */
export function DictationRow({ useSpeechReadiness, configure, hotkey, t }: DictationRowProps) {
  const readiness = useSpeechReadiness(value => value), catalog = readiness.catalog
  const selected = catalog?.providers.find(provider => provider.id === catalog.selection.providerId)
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [shortcut, setShortcut] = useState<DictationHotkeyState | undefined>()
  useEffect(() => {
    if (hotkey === undefined) return
    let live = true
    hotkey.get().then((state) => { if (live) setShortcut(state) }, () => undefined)
    return () => { live = false }
  }, [hotkey])
  const save = async (action: () => Promise<unknown>): Promise<void> => {
    setSaving(true); setError('')
    try { await action() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setSaving(false) }
  }
  const disabled = !readiness.connected || saving
  return <div className={css.row} data-dictation-provider={selected?.id}>
    <div className={css.title}>{t('settings.title')}</div>
    <div className={css.description}>{t(selected?.location === 'host-local' ? 'local' : 'cloud')}</div>
    {catalog && <div className={css.fields}>
      {catalog.providers.length > 1 && <label className={css.field}>{t('settings.provider')}
        <select value={catalog.selection.providerId} disabled={disabled}
          onChange={(event) => { void save(() => configure({ providerId: event.target.value as SpeechProviderId })) }}>
          {catalog.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select></label>}
      <label className={css.field}>{t('settings.language')}
        <select value={catalog.selection.language} disabled={disabled}
          onChange={(event) => { void save(() => configure({ language: event.target.value })) }}>
          {(selected?.languages ?? [catalog.selection.language]).map(code =>
            <option key={code} value={code}>{languageName(code, t('auto'))}</option>)}
        </select></label>
      {hotkey !== undefined && shortcut !== undefined && <label className={css.field}>{t('settings.hotkey')}
        <select value={shortcut.accelerator ?? ''} disabled={saving}
          onChange={(event) => { void save(async () => { setShortcut(await hotkey.set(event.target.value === '' ? null : event.target.value)) }) }}>
          {DICTATION_ACCELERATORS.map(accelerator =>
            <option key={accelerator} value={accelerator}>{presentAccelerator(accelerator, MAC)}</option>)}
          <option value="">{t('settings.hotkeyOff')}</option>
        </select></label>}
    </div>}
    {hotkey !== undefined && <div className={css.description}>{t('settings.hotkeyHelp')}</div>}
    {shortcut !== undefined && shortcut.accelerator !== null && !shortcut.registered
      && <div className={css.alert} role="alert">{t('settings.hotkeyTaken')}</div>}
    {!catalog && <div className={css.description} role="status">{t('loading')}</div>}
    {error && <div className={css.alert} role="alert">{t('settings.failed', { message: error })}</div>}
  </div>
}
