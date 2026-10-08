import { memo } from 'react'
import { Button, IconChevronDownOutlineRegular } from '@ahel/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

/** Settled Turn duration and process disclosure above its content; an interrupted Turn offers Retry instead. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, retryTurn, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = !turnProcess.foldable || turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn?.status !== 'closed') return null
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const reason = turn.end?.data.reason.kind
  // An `interrupted` end is appended after the Host stopped mid-Turn, so its elapsed time is not a run time.
  const cutOff = reason === 'aborted' || reason === 'error' || reason === 'interrupted'
  const elapsedMs = turn.start === undefined || turn.end === undefined ? undefined
    : Math.max(1000, turn.end.time - turn.start.time)
  const duration = elapsedMs === undefined || cutOff ? undefined : formatRunDuration(elapsedMs, t)
  const label = reason === 'aborted' ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : reason === 'interrupted' ? t('message.turnProcess.interrupted')
        : duration === undefined ? t('message.turnProcess.worked')
          : t('message.turnProcess.took')
  const announcement = reason === 'aborted' ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : reason === 'interrupted' ? t('message.turnProcess.interrupted')
        : t('message.turnProcess.worked')
  const disclosure = (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      data-turn-process={node.data.turn}
      data-turn-process-messages={node.data.messageCount}
      data-turn-process-tool-calls={node.data.toolCallCount}
      data-turn-process-subagents={node.data.subagentCount}
      disabled={!canCollapse}
      aria-expanded={turnProcess.hasContent ? open : undefined}
      onClick={(event) => {
        event.currentTarget.focus()
        turnProcess.setOpen(!open)
      }}
    >
      <span className={css.label}>
        {label}
        {duration?.map((part, index) => (
          <span key={index} className={part.numeric ? css.durationNumber : undefined}>{part.text}</span>
        ))}
      </span>
      {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
    </button>
  )
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      {reason === 'interrupted'
        ? (
          <div className={css.interrupted} data-turn-interrupted={turn.turn}>
            {disclosure}
            <Button size="sm" variant="outline" onClick={() => { retryTurn(turn.turn) }}>
              {t('message.turnProcess.retry')}
            </Button>
          </div>
        )
        : disclosure}
    </>
  )
})
