/** The Computer use (beta) row in Settings > General: the switch, driver state and one line for a missing macOS permission. */
import { Button, Switch } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type { ComputerUseSettingsPane, ComputerUseDriverStatus } from '../types.ts'
import type {} from './locales.ts'
import css from './ComputerUseRow.module.css'

/** Row state published by the plugin. */
export interface ComputerUseRowState {
  readonly status: ComputerUseDriverStatus | undefined
  readonly busy: boolean
  readonly failed: boolean
}

/** Injected face: live state and the person's actions. */
export interface ComputerUseRowInjected {
  hooks: { row: HostObservable<ComputerUseRowState> }
  setEnabled(enabled: boolean): Promise<void>
  openSettings(pane: ComputerUseSettingsPane): Promise<void>
  recheck(): Promise<void>
}

/** Props of the row. */
export type ComputerUseRowProps = PropsRuntime<'settings.general.item'> & InjectFace<ComputerUseRowInjected> & PropsLocale<'settings.computerUse'>

const PHASE = {
  off: 'phaseOff', starting: 'phaseStarting', ready: 'phaseReady', unavailable: 'phaseUnavailable', unsupported: 'phaseUnsupported', error: 'phaseError',
} as const

/**
 * The sentence and pane for missing macOS grants.
 * @param status - the current status.
 * @returns the copy key and the first pane to open, or undefined when nothing is missing.
 */
function missing(status: ComputerUseDriverStatus): { key: 'needAccessibility' | 'needScreenRecording' | 'needBoth'; pane: ComputerUseSettingsPane } | undefined {
  const accessibility = status.accessibility === 'missing'
  const screen = status.screenRecording === 'missing'
  if (accessibility && screen) return { key: 'needBoth', pane: 'accessibility' }
  if (accessibility) return { key: 'needAccessibility', pane: 'accessibility' }
  if (screen) return { key: 'needScreenRecording', pane: 'screen-recording' }
  return undefined
}

/**
 * Render the switch and, while computer use is on, the driver state and any missing permission.
 * @param props - row state, actions and localized copy.
 * @returns the row.
 */
export function ComputerUseRow({ useRow, setEnabled, openSettings, recheck, t }: ComputerUseRowProps) {
  const row = useRow(value => value)
  const status = row.status
  const enabled = status?.enabled === true
  const need = status?.enabled === true ? missing(status) : undefined
  const phase = status === undefined ? undefined : status.detail === undefined ? t(PHASE[status.phase]) : `${t(PHASE[status.phase])} ${status.detail}`
  return <div className={css.row}>
    <div className={css.head}>
      <div>
        <div className={css.title}>{t('title')}</div>
        <div className={css.description}>{t(row.failed ? 'failed' : 'description')}</div>
      </div>
      <Switch checked={enabled} label={t('switchLabel')} disabled={row.busy || status === undefined}
        onChange={(next) => { void setEnabled(next) }} />
    </div>
    {enabled && phase !== undefined && <div className={css.status}>{phase}</div>}
    {need !== undefined && (
      <>
        <div className={css.status}>{t(need.key)}</div>
        <div className={css.actions}>
          <Button variant="outline" size="sm" disabled={row.busy} onClick={() => { void openSettings(need.pane) }}>{t('openSettings')}</Button>
          <Button variant="outline" size="sm" disabled={row.busy} onClick={() => { void recheck() }}>{t('recheck')}</Button>
        </div>
      </>
    )}
  </div>
}
