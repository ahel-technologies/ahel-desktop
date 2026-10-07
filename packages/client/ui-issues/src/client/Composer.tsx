/** New issue: title, Markdown description, status, assignee, project and priority; Create opens the new issue. */
import { useEffect, useRef, useState } from 'react'
import type { IssuePriority, IssueProject, IssueStatus } from '@ahel/dsh-ahel-account/types'
import type { IssuesInjected } from './contract.ts'
import { ALL_STATUSES, isPriority, isStatus, PRIORITIES, priorityKey, statusKey, type Translate } from './model.ts'
import type { AssigneeOption } from './Parts.tsx'
import css from './Issues.module.css'

/** Props of the New issue sheet. */
export interface ComposerProps {
  readonly status: IssueStatus
  readonly projects: readonly IssueProject[]
  readonly assignees: readonly AssigneeOption[]
  readonly t: Translate
  readonly create: IssuesInjected['create']
  readonly close: () => void
}

/**
 * Render the sheet.
 * @param props - the preset column, the choices, Create and Close.
 * @returns the scrim and the sheet.
 */
export function Composer({ status: preset, projects, assignees, t, create, close }: ComposerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<IssueStatus>(preset)
  const [priority, setPriority] = useState<IssuePriority>('none')
  const [assignee, setAssignee] = useState('')
  const [project, setProject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  const submit = (): void => {
    if (busy || title.trim() === '') return
    const option = assignees.find(row => row.value === assignee)
    setBusy(true)
    setError(null)
    void create({
      title: title.trim(), description, status, priority,
      assigneeType: option?.type ?? null, assigneeId: option?.id ?? null, project: project === '' ? null : project,
    }).then((answer) => {
      if (!answer.ok) setError(answer.message ?? t('writeFailed'))
    }).catch(() => { setError(t('writeFailed')) }).finally(() => { setBusy(false) })
  }

  return (
    <>
      <div className={css.scrim} onClick={close} />
      <div className={css.sheet} role="dialog" aria-modal="true" aria-label={t('newIssue')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); close() }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
        }}>
        <input ref={titleRef} className={css.sheetTitle} aria-label={t('title')} placeholder={t('titlePlaceholder')}
          value={title} onChange={(event) => { setTitle(event.target.value) }} />
        <textarea className={css.textarea} aria-label={t('description')} placeholder={t('descriptionPlaceholder')}
          value={description} onChange={(event) => { setDescription(event.target.value) }} />
        <div className={css.sheetGrid}>
          <label className={css.field}>{t('status')}
            <select className={css.select} value={status}
              onChange={(event) => { if (isStatus(event.target.value)) setStatus(event.target.value) }}>
              {ALL_STATUSES.map(value => <option key={value} value={value}>{t(statusKey(value))}</option>)}
            </select>
          </label>
          <label className={css.field}>{t('assignee')}
            <select className={css.select} value={assignee} onChange={(event) => { setAssignee(event.target.value) }}>
              {assignees.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className={css.field}>{t('project')}
            <select className={css.select} value={project} onChange={(event) => { setProject(event.target.value) }}>
              <option value="">{t('noProject')}</option>
              {projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className={css.field}>{t('priority')}
            <select className={css.select} value={priority}
              onChange={(event) => { if (isPriority(event.target.value)) setPriority(event.target.value) }}>
              {PRIORITIES.map(value => <option key={value} value={value}>{t(priorityKey(value))}</option>)}
            </select>
          </label>
        </div>
        {error !== null && <p className={css.error} role="alert">{error}</p>}
        <span className={css.actions} style={{ justifyContent: 'flex-end' }}>
          <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={close}>{t('cancel')}</button>
          <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy || title.trim() === ''} onClick={submit}>
            {busy ? t('creating') : t('create')}
          </button>
        </span>
      </div>
    </>
  )
}
