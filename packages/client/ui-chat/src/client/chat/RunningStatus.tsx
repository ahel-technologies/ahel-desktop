/** Running Turn status line, its clock isolated from the transcript's render cycle. */
import { memo, useEffect, useState, type ReactNode } from 'react'
import { BrandPulse } from '@ahel/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ProcessGroupData } from '../contract/process-groups.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { formatTokens } from './token-format.ts'
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

type Translate = ChatViewSlotProps['t']

interface RunningStatusProps {
  readonly startTime: number | undefined
  /** Current step copy, e.g. "Searching the web"; see {@link runningStepLabel}. */
  readonly step: string
  /** Output tokens settled so far in the running Turn; zero or absent hides the figure. */
  readonly tokens?: number | undefined
  /** The brand mark from the pulse slot; absent renders the neutral dot. */
  readonly mark?: ReactNode
  readonly t: Translate
}

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path
}

/**
 * Name what the running Turn is doing from its latest open process group.
 * @param data - the last process group's data, or absence before any group exists.
 * @param t - Chat locale seat.
 * @returns "Thinking" without a live tool, "Reading {file}" for a file read, otherwise the live category copy.
 */
export function runningStepLabel(data: ProcessGroupData | undefined, t: Translate): string {
  const running = data?.closed === false ? data.summary.running : undefined
  if (running === undefined) return t('chat.running.thinking')
  if (data?.summary.preparing === true) return t(`message.stepProcess.prepare.${running}`)
  const detail = data?.summary.runningDetail ?? ''
  if ((running === 'read' || running === 'readImage') && detail !== '') {
    return t('chat.running.reading', { name: basename(detail) })
  }
  return t(`message.stepProcess.${running}`)
}

/**
 * One quiet line after the current Turn's content: a breathing brand mark, then
 * elapsed time, settled output tokens and the current step, joined by middle dots.
 * Clock ticks are not announced; the live region carries only "Thinking".
 * @param props - Turn start, step copy, token figure, slotted mark and locale.
 * @returns the running indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, step, tokens, mark, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime])
  const parts: string[] = []
  if (startTime !== undefined) {
    parts.push(formatRunDuration(now - startTime, t).map(part => part.text).join('').trimEnd())
  }
  if (tokens !== undefined && tokens > 0) parts.push(t('chat.running.tokens', { count: formatTokens(tokens, t) }))
  parts.push(step)
  return (
    <div className={css.running} data-chat-running>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {t('chat.running.thinking')}
      </span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        <BrandPulse size={14}>{mark}</BrandPulse>
        <span className={css.runningText}>{parts.join(t('message.turnProcess.separator'))}</span>
      </span>
    </div>
  )
})
