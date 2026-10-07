/** The board: one column per status with its count and "+", cards that drag between columns, and the grouped list view. */
import { useState } from 'react'
import type { DragEvent } from 'react'
import type { Issue, IssueRun, IssueStatus } from '@ahel/dsh-ahel-account/types'
import { ago, ALL_STATUSES, BOARD_STATUSES, currentRun, groupByStatus, priorityKey, statusKey, type Translate } from './model.ts'
import { Assignee, RunProgress, StatusIcon } from './Parts.tsx'
import css from './Issues.module.css'

/** What the board and the list share. */
export interface IssueViewProps {
  readonly issues: readonly Issue[]
  /** Server counts per status; a column shows the larger of these and its loaded cards. */
  readonly counts: Readonly<Record<string, number>>
  readonly runs: Readonly<Record<string, IssueRun>>
  readonly now: number
  readonly t: Translate
  readonly onOpen: (key: string) => void
  readonly onMove: (key: string, status: IssueStatus) => void
  readonly onAdd: (status: IssueStatus) => void
}

/** Drag payload type carrying an issue key. */
const DRAG_TYPE = 'application/x-ahel-issue'

/**
 * One card: key, two-line title, project and labels, assignee, run progress and the last change.
 * The agent's model shows in the detail only.
 * @param props - the issue, its run, the time and the open/drag handlers.
 * @returns the card button.
 */
function IssueCard({ issue, run, now, t, onOpen }: {
  issue: Issue
  run: IssueRun | null
  now: number
  t: Translate
  onOpen: (key: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <button
      type="button"
      className={css.card}
      draggable
      data-dragging={dragging || undefined}
      title={t('dragHint')}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, issue.key)
        event.dataTransfer.setData('text/plain', issue.key)
        event.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      }}
      onDragEnd={() => { setDragging(false) }}
      onClick={() => { onOpen(issue.key) }}
    >
      <span className={css.cardTop}>
        <span className={css.key}>{issue.key}</span>
        {issue.priority !== 'none' && <span className={css.priority} data-priority={issue.priority}>{t(priorityKey(issue.priority))}</span>}
      </span>
      <p className={css.cardTitle}>{issue.title}</p>
      {(issue.project !== null || issue.labels.length > 0) && (
        <span className={css.chipRow}>
          {issue.project !== null && <span className={css.project}>{issue.project.name}</span>}
          {issue.labels.slice(0, 3).map(label => <span key={label} className={css.label}>{label}</span>)}
        </span>
      )}
      <span className={css.cardFoot}>
        <Assignee type={issue.assigneeType} name={issue.assigneeName} avatar={issue.assigneeAvatar} t={t} />
        <RunProgress run={run} t={t} />
      </span>
      <span className={css.cardFoot}>
        <span className={css.updated}>{t('updated', { age: ago(issue.updatedAt, now, t) })}</span>
      </span>
    </button>
  )
}

/**
 * Read the dragged issue key, if the drag carries one.
 * @param event - the drop or dragover event.
 * @returns the key, or null.
 */
function draggedKey(event: DragEvent): string | null {
  const key = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData('text/plain')
  return key === '' ? null : key
}

/**
 * One column: header with glyph, name, count and "+", then its cards; a drop moves the card here.
 * @param props - the status, its cards and the shared handlers.
 * @returns the column.
 */
function Column({ status, issues, count, runs, now, t, onOpen, onMove, onAdd }: Omit<IssueViewProps, 'issues' | 'counts'> & {
  status: IssueStatus
  issues: readonly Issue[]
  count: number
}) {
  const [over, setOver] = useState(false)
  const name = t(statusKey(status))
  return (
    <section
      className={css.column}
      data-over={over || undefined}
      aria-label={name}
      data-status={status}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE) && !event.dataTransfer.types.includes('text/plain')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => { setOver(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const key = draggedKey(event)
        if (key !== null && !issues.some(issue => issue.key === key)) onMove(key, status)
      }}
    >
      <header className={css.columnHead}>
        <StatusIcon status={status} />
        <span>{name}</span>
        <span className={css.count}>{count}</span>
        <button type="button" className={css.plus} aria-label={t('addTo', { status: name })} onClick={() => { onAdd(status) }}>+</button>
      </header>
      {issues.length === 0 && <p className={css.columnEmpty}>{t('emptyColumn')}</p>}
      {issues.map(issue => (
        <IssueCard key={issue.key} issue={issue} run={currentRun(issue, runs[issue.key])} now={now} t={t}
          onOpen={onOpen} />
      ))}
    </section>
  )
}

/**
 * The board: Backlog, Todo, In Progress, In Review, Blocked and Done.
 * @param props - the issues and handlers.
 * @returns the columns.
 */
export function Board(props: IssueViewProps) {
  const groups = groupByStatus(props.issues)
  // Cancelled issues fold into Done; the list view keeps them apart.
  const cards = (status: IssueStatus): Issue[] => status === 'done' ? [...groups.done, ...groups.cancelled] : groups[status]
  const counted = (status: IssueStatus): number => props.counts[status] ?? 0
  return (
    <div className={css.board} role="region" aria-label={props.t('boardLabel')}>
      {BOARD_STATUSES.map(status => (
        <Column key={status} {...props} status={status} issues={cards(status)}
          count={Math.max(status === 'done' ? counted('done') + counted('cancelled') : counted(status), cards(status).length)} />
      ))}
    </div>
  )
}

/**
 * The list: rows grouped by status, empty groups left out.
 * @param props - the issues and handlers.
 * @returns the groups.
 */
export function IssueList({ issues, counts, runs, now, t, onOpen }: IssueViewProps) {
  const groups = groupByStatus(issues)
  return (
    <div className={css.listView} role="region" aria-label={t('listLabel')}>
      {ALL_STATUSES.filter(status => groups[status].length > 0).map(status => (
        <section key={status} className={css.group} aria-label={t(statusKey(status))}>
          <header className={css.groupHead}>
            <StatusIcon status={status} />
            <span>{t(statusKey(status))}</span>
            <span className={css.count}>{Math.max(counts[status] ?? 0, groups[status].length)}</span>
          </header>
          {groups[status].map(issue => (
            <button key={issue.key} type="button" className={css.rowItem} onClick={() => { onOpen(issue.key) }}>
              <span className={css.key}>{issue.key}</span>
              <span className={css.rowTitle}>{issue.title}</span>
              <RunProgress run={currentRun(issue, runs[issue.key])} t={t} />
              <Assignee type={issue.assigneeType} name={issue.assigneeName} avatar={issue.assigneeAvatar} t={t} />
              <span className={css.updated}>{ago(issue.updatedAt, now, t)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
