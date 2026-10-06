/**
 * Below the composer: whether computer use is on in this chat, the red
 * "Stop computer use" control while a turn is using it, the pause toggle and
 * the activity log.
 */
import type { DockProps } from './contract.ts'
import { clock, sessionOf, statusTone } from './view.ts'
import css from './ComputerUse.module.css'

/**
 * Render the dock entry; nothing while computer use is off and unused here.
 * @param props - the session, the computer-use face and copy.
 * @returns the entry, or null.
 */
export function ComputerUseDock({ sessionId, useView, stop, setPaused, stopKeys, t }: DockProps) {
  const view = useView(value => value)
  const session = sessionOf(view, sessionId)
  if (view === null || (!view.enabled && session === undefined)) return null
  const running = session?.running === true
  const paused = session?.paused === true
  const rows = session?.activity ?? []
  const state = running ? 'running' : paused ? 'paused' : 'idle'
  const title = running ? 'dock.running' : paused ? 'dock.paused' : view.enabled ? 'dock.on' : 'dock.off'
  return (
    <div className={`${css.tokens} ${css.dock}`} data-computer-use-dock={state}>
      <div className={css.dockBar}>
        <span className={css.dockTitle}><span className={css.dot} data-state={state} />{t(title)}</span>
        {view.enabled && (
          <button type="button" className={css.toggle} aria-pressed={paused}
            onClick={() => { void setPaused(sessionId, !paused) }}>{t(paused ? 'dock.resume' : 'dock.pause')}</button>
        )}
        {running && (
          <button type="button" className={css.stop} title={t('dock.stopHint', { keys: stopKeys })}
            onClick={() => { void stop() }}>{t('stop')}</button>
        )}
      </div>
      {rows.length > 0 && (
        <details className={css.log}>
          <summary>{t('dock.activity', { n: String(rows.length) })}</summary>
          <ol className={css.rows}>
            {rows.toReversed().map(row => (
              <li key={`${row.callId}:${String(row.time)}`} className={css.row}>
                <span className={css.time}>{clock(row.time)}</span>
                <span className={css.chip} data-tone={statusTone(row.status)}>{t(`status.${row.status}`)}</span>
                <span className={css.summary}>
                  {row.summary}
                  {row.reason !== null && <span className={css.reason}>{row.reason}</span>}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
