/** The Web search row in Settings > General: Ahel Web Search and, when it is off, its on switch. */
import { Button } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from './locales.ts'
import css from './WebSearchRow.module.css'

/** Where Ahel Web Search stands for the signed-in workspace. */
export type WebSearchStatus = 'checking' | 'signed-out' | 'on' | 'off' | 'unreachable'

/** Row state published by the plugin. */
export interface WebSearchRowState {
  readonly status: WebSearchStatus
  readonly busy: boolean
  readonly failed: boolean
}

/** Injected face: the live state and the person's own on switch. */
export interface WebSearchRowInjected {
  hooks: { row: HostObservable<WebSearchRowState> }
  /** Add or switch on Web Search in the selected workspace. */
  turnOn(): Promise<void>
}

/** Props of the Web search row. */
export type WebSearchRowProps = PropsRuntime<'settings.general.item'> & InjectFace<WebSearchRowInjected> & PropsLocale<'settings.webSearch'>

const VALUE = { 'checking': 'checking', 'signed-out': 'signedOut', 'on': 'on', 'off': 'off', 'unreachable': 'signedOut' } as const
const DESCRIPTION = {
  'checking': 'descriptionChecking', 'signed-out': 'descriptionSignedOut', 'on': 'descriptionOn', 'off': 'descriptionOff', 'unreachable': 'descriptionUnreachable',
} as const

/**
 * Render the provider line; there is no provider picker.
 * @param props - row state, the on switch and localized copy.
 * @returns the row.
 */
export function WebSearchRow({ useRow, turnOn, t }: WebSearchRowProps) {
  const row = useRow(value => value)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('title')}</div>
      <div className={css.value}>{t(VALUE[row.status])}</div>
      <div className={css.description}>{t(row.failed ? 'failed' : DESCRIPTION[row.status])}</div>
    </div>
    {row.status === 'off' && (
      <Button variant="outline" size="sm" disabled={row.busy} onClick={() => { void turnOn() }}>
        {t(row.busy ? 'turningOn' : 'turnOn')}
      </Button>
    )}
  </div>
}
