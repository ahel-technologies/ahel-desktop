/**
 * Settings > General, under the computer-use switch row: the apps computer
 * use never drives, built in and the user's own list.
 */
import { useState } from 'react'
import { Button } from '@ahel/dsh-client-ui-primitives'
import type { SettingsRowProps } from './contract.ts'
import { parseBlockedApps } from './view.ts'
import css from './ComputerUse.module.css'

/**
 * Render the row.
 * @param props - the computer-use face and copy.
 * @returns the row.
 */
export function ComputerUseSettingsRow({ useView, setBlockedApps, t }: SettingsRowProps) {
  const view = useView(value => value)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const save = (text: string): void => {
    setBusy(true)
    setFailed(false)
    setBlockedApps(parseBlockedApps(text)).then(() => { setDraft(null) }, () => { setFailed(true) }).finally(() => { setBusy(false) })
  }
  return (
    <div className={css.settings}>
      <div className={css.blocked}>
        <label className={css.settingsTitle} htmlFor="computer-use-blocked-apps">{t('settings.blocked')}</label>
        <div className={css.settingsDescription}>{t('settings.description')}</div>
        {view !== null && <div className={css.settingsDescription}>{t('settings.builtIn', { apps: view.builtInBlocked.join(', ') })}</div>}
        <textarea id="computer-use-blocked-apps" className={css.textarea} rows={3} value={draft ?? (view?.blockedApps ?? []).join('\n')}
          disabled={view === null} placeholder={t('settings.placeholder')} onChange={(event) => { setDraft(event.target.value) }} />
        {(draft !== null || failed) && (
          <div className={css.saveRow}>
            <Button variant="outline" size="sm" disabled={busy || draft === null} onClick={() => { if (draft !== null) save(draft) }}>
              {t(busy ? 'settings.saving' : 'settings.save')}
            </Button>
            {failed && <span role="alert">{t('settings.failed')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
