/**
 * The issue detail drawer: editable title and Markdown description,
 * comments with a composer, the activity log, and beside them the
 * properties (status, priority, assignee, project, labels, parent) with
 * Run with Ahel (agent-assigned issues), Hand off and, for owners, Delete. A write ahel.ai refuses
 * shows its reason in place. A read ahel.ai was too busy for or did not answer repeats by itself
 * while the drawer is open, and says so in place.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Issue, IssueActivity, IssueComment, IssuePatch, IssueProject, IssueRun } from '@ahel/dsh-ahel-account/types'
import type { IssuesAnswer, IssuesInjected } from './contract.ts'
import {
  activityText, ago, ALL_STATUSES, isPriority, isStatus, parentExample, parseLabels, PRIORITIES, priorityKey, retryWait, statusKey,
  type Translate,
} from './model.ts'
import { Markdown } from './Markdown.tsx'
import { assigneeValue, Assignee, RunProgress, StatusIcon, type AssigneeOption } from './Parts.tsx'
import css from './Issues.module.css'

/** Props of the detail drawer. */
export interface IssueDetailProps {
  readonly issueKey: string
  /** The issue as the board holds it; newer than the detail read after a board write. */
  readonly live: Issue | undefined
  readonly run: IssueRun | null
  readonly projects: readonly IssueProject[]
  readonly assignees: readonly AssigneeOption[]
  /** Role in the workspace; Delete shows for owners, and while the role is unknown. */
  readonly role: string | null
  /** The model the run's chat uses, shown under the assignee of an agent-assigned issue; null hides the hint. */
  readonly runModel: string | null
  readonly now: number
  readonly t: Translate
  readonly actions: Pick<
    IssuesInjected, 'detail' | 'update' | 'remove' | 'comment' | 'run' | 'openSession' | 'createProject' | 'openLink' | 'viewOnWeb'
  >
  readonly close: () => void
}

/** The value that picks "New project…" in the project select. */
const NEW_PROJECT = '__new__'

/**
 * Render the drawer.
 * @param props - the issue key, the board's copy and the actions.
 * @returns the click-through scrim and the drawer.
 */
export function IssueDetail({ issueKey, live, run, projects, assignees, role, runModel, now, t, actions, close }: IssueDetailProps) {
  const [loaded, setLoaded] = useState<Issue | null>(null)
  const [comments, setComments] = useState<readonly IssueComment[]>([])
  const [activity, setActivity] = useState<readonly IssueActivity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [handOff, setHandOff] = useState<{ to: string; note: string } | null>(null)
  const [newProject, setNewProject] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const generation = useRef(0)
  const repeats = useRef(0)
  const repeat = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drawer = useRef<HTMLElement>(null)
  const issue = live ?? loaded

  const { detail } = actions
  const load = useCallback((): void => {
    clearTimeout(repeat.current)
    const mine = ++generation.current
    void detail(issueKey).then((answer) => {
      if (mine !== generation.current) return
      const retry = answer.retry
      setRetrying(retry !== null)
      if (retry === null) repeats.current = 0
      else repeat.current = setTimeout(load, retryWait(retry.afterMs, repeats.current++))
      if (!answer.ok) {
        if (retry === null) setError(answer.message ?? t('failed'))
        return
      }
      setLoaded(answer.issue)
      if (answer.comments !== null) setComments(answer.comments)
      if (answer.activity !== null) setActivity(answer.activity)
    }).catch(() => { if (mine === generation.current) setError(t('failed')) })
  }, [detail, issueKey, t])

  useEffect(() => {
    setError(null)
    setLoaded(null)
    setRetrying(false)
    repeats.current = 0
    load()
    return () => {
      generation.current++
      clearTimeout(repeat.current)
    }
  }, [load])
  useEffect(() => { if (issue !== null) setTitle(issue.title) }, [issue?.title])
  // The scrim lets clicks through, so cards, chats and the sidebar stay usable; a press outside the drawer closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    const onPress = (event: PointerEvent): void => {
      if (event.target instanceof Node && drawer.current?.contains(event.target) !== true) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPress, true)
    }
  }, [close])

  /** Run one write, show ahel.ai's reason on a refusal, and re-read the comments and activity. */
  const write = (action: () => Promise<IssuesAnswer>, after?: () => void): void => {
    const closing = after === close
    setBusy(true)
    setError(null)
    void action().then((answer) => {
      if (answer.ok) { after?.(); if (!closing) load(); return }
      setError(answer.message ?? t('writeFailed'))
    }).catch(() => { setError(t('writeFailed')) }).finally(() => { setBusy(false) })
  }
  const patch = (fields: IssuePatch, after?: () => void): void => { write(() => actions.update(issueKey, fields), after) }

  if (issue === null) {
    return (
      <>
        <div className={`${css.scrim} ${css.scrimPassive}`} aria-hidden="true" />
        <aside ref={drawer} className={css.drawer} aria-label={issueKey}>
          <header className={css.drawerHead}>
            <span className={css.key}>{issueKey}</span>
            <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={close}>{t('close')}</button>
          </header>
          <div className={css.mainCol}>
            {error !== null
              ? <p className={css.error} role="alert">{error}</p>
              : <p className={css.muted} role="status">{t(retrying ? 'retrying' : 'loading')}</p>}
          </div>
        </aside>
      </>
    )
  }

  const owner = role === null || role === 'OWNER'
  const members = assignees.filter(option => option.type === 'member' && option.id !== 'me')
  const activeRun = run !== null && (run.state === 'running' || run.state === 'waiting_approval' || run.state === 'waiting_input' || run.state === 'queued')
    ? run
    : null
  const runningHere = activeRun !== null
  // A run queued on ahel.ai has no chat until a desktop picks it up.
  const liveSession = activeRun?.sessionId ?? null

  return (
    <>
      <div className={`${css.scrim} ${css.scrimPassive}`} aria-hidden="true" />
      <aside ref={drawer} className={css.drawer} aria-label={`${issue.key} ${issue.title}`}>
        <header className={css.drawerHead}>
          <span className={css.cardTop} style={{ gap: 10 }}>
            <StatusIcon status={issue.status} />
            <span className={css.key}>{issue.key}</span>
            <RunProgress run={run} t={t} />
          </span>
          <span className={css.actions}>
            {liveSession !== null && (
              <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { actions.openSession(liveSession) }}>
                {t('openSession')}
              </button>
            )}
            {issue.assigneeType === 'agent' && (
              <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy || runningHere}
                onClick={() => { write(() => actions.run(issue)) }}>{t('runWithAhel')}</button>
            )}
            <button type="button" className={`${css.btn} ${css.btnGhost}`}
              onClick={() => { actions.viewOnWeb(issue.key) }}>{t('viewOnWeb')}</button>
            <button type="button" className={`${css.btn} ${css.btnSecondary}`} disabled={busy}
              onClick={() => { setHandOff(handOff === null ? { to: members[0]?.value ?? 'member:me', note: '' } : null) }}>{t('handOff')}</button>
            <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={close}>{t('close')}</button>
          </span>
        </header>
        <div className={css.drawerBody}>
          <div className={css.mainCol}>
            <input
              className={css.detailTitle}
              aria-label={t('title')}
              value={title}
              onChange={(event) => { setTitle(event.target.value) }}
              onBlur={() => { if (title.trim() !== '' && title.trim() !== issue.title) patch({ title: title.trim() }) }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            />
            {error !== null && <p className={css.error} role="alert">{error}</p>}
            {error === null && retrying && <p className={css.muted} role="status">{t('retrying')}</p>}
            {handOff !== null && (
              <section className={css.section} aria-label={t('handOff')}>
                <label className={css.field}>{t('handOffTo')}
                  <select className={css.select} value={handOff.to}
                    onChange={(event) => { setHandOff({ ...handOff, to: event.target.value }) }}>
                    {assignees.filter(option => option.type !== null)
                      .map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className={css.field}>{t('handOffNote')}
                  <input className={css.input} value={handOff.note}
                    onChange={(event) => { setHandOff({ ...handOff, note: event.target.value }) }} />
                </label>
                <span className={css.actions}>
                  <button type="button" className={`${css.btn} ${css.btnDark}`} disabled={busy} onClick={() => {
                    const target = assignees.find(option => option.value === handOff.to)
                    if (target === undefined || target.type === null) return
                    const line = t('handOffComment', { name: target.label })
                    const body = handOff.note.trim() === '' ? line : `${line}\n\n${handOff.note.trim()}`
                    write(async () => {
                      const moved = await actions.update(issueKey, { assigneeType: target.type, assigneeId: target.id })
                      return moved.ok ? await actions.comment(issueKey, body) : moved
                    }, () => { setHandOff(null) })
                  }}>{t('handOffSend')}</button>
                  <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setHandOff(null) }}>{t('cancel')}</button>
                </span>
              </section>
            )}
            <section className={css.section}>
              <h3 className={css.sectionHead}>
                {t('description')}
                {!editing && <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setDraft(issue.description); setEditing(true) }}>{t('edit')}</button>}
              </h3>
              {editing
                ? (
                  <>
                    <textarea className={css.textarea} aria-label={t('description')} value={draft} placeholder={t('descriptionPlaceholder')}
                      onChange={(event) => { setDraft(event.target.value) }} />
                    <span className={css.actions}>
                      <button type="button" className={`${css.btn} ${css.btnDark}`} disabled={busy}
                        onClick={() => { patch({ description: draft }, () => { setEditing(false) }) }}>{t('save')}</button>
                      <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setEditing(false) }}>{t('cancel')}</button>
                    </span>
                  </>
                )
                : issue.description.trim() === '' ? <p className={css.muted}>{t('noDescription')}</p> : <Markdown text={issue.description} openLink={actions.openLink} />}
            </section>
            <section className={css.section}>
              <h3 className={css.sectionHead}>{t('comments')}</h3>
              {comments.length === 0 && <p className={css.muted}>{t('noComments')}</p>}
              {comments.map(row => (
                <div key={row.id} className={css.comment}>
                  <Assignee type={row.authorType} name={row.authorName} avatar={row.authorAvatar} compact t={t} />
                  <div className={css.commentBody}>
                    <div className={css.commentMeta}><b>{row.authorName}</b><span>{ago(row.createdAt, now, t)}</span></div>
                    <Markdown text={row.body} openLink={actions.openLink} />
                  </div>
                </div>
              ))}
              <textarea className={css.textarea} style={{ minHeight: 80 }} aria-label={t('commentPlaceholder')} placeholder={t('commentPlaceholder')}
                value={comment} onChange={(event) => { setComment(event.target.value) }} />
              <span className={css.actions}>
                <button type="button" className={`${css.btn} ${css.btnDark}`} disabled={busy || comment.trim() === ''}
                  onClick={() => { write(() => actions.comment(issueKey, comment.trim()), () => { setComment('') }) }}>{t('commentSend')}</button>
              </span>
            </section>
            <section className={css.section}>
              <h3 className={css.sectionHead}>{t('activity')}</h3>
              {activity.length === 0 && <p className={css.muted}>{t('noActivity')}</p>}
              <ul className={css.activity}>
                {activity.map(row => (
                  <li key={row.id}>
                    <b>{row.actorName}</b><span>{activityText(row, t)}</span>
                    <time dateTime={row.createdAt}>{ago(row.createdAt, now, t)}</time>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className={css.sideCol}>
            <h3 className={css.sectionHead}>{t('properties')}</h3>
            <label className={css.field}>{t('status')}
              <select className={css.select} value={issue.status} disabled={busy}
                onChange={(event) => { if (isStatus(event.target.value)) patch({ status: event.target.value }) }}>
                {ALL_STATUSES.map(status => <option key={status} value={status}>{t(statusKey(status))}</option>)}
              </select>
            </label>
            <label className={css.field}>{t('priority')}
              <select className={css.select} value={issue.priority} disabled={busy}
                onChange={(event) => { if (isPriority(event.target.value)) patch({ priority: event.target.value }) }}>
                {PRIORITIES.map(priority => <option key={priority} value={priority}>{t(priorityKey(priority))}</option>)}
              </select>
            </label>
            <label className={css.field}>{t('assignee')}
              <select className={css.select} value={assigneeValue(issue.assigneeType, issue.assigneeId)} disabled={busy}
                onChange={(event) => {
                  const option = assignees.find(row => row.value === event.target.value)
                  patch({ assigneeType: option?.type ?? null, assigneeId: option?.id ?? null })
                }}>
                {!assignees.some(row => row.value === assigneeValue(issue.assigneeType, issue.assigneeId)) && (
                  <option value={assigneeValue(issue.assigneeType, issue.assigneeId)}>{issue.assigneeName ?? t('unassigned')}</option>
                )}
                {assignees.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {issue.assigneeType === 'agent' && runModel !== null && <span className={css.whoModel}>{t('agentModel', { model: runModel })}</span>}
            </label>
            <label className={css.field}>{t('project')}
              <select className={css.select} value={issue.project?.id ?? ''} disabled={busy}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === NEW_PROJECT) setNewProject('')
                  else patch({ project: value === '' ? null : value })
                }}>
                <option value="">{t('noProject')}</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                <option value={NEW_PROJECT}>{t('newProject')}</option>
              </select>
            </label>
            {newProject !== null && (
              <span className={css.actions}>
                <input className={css.input} aria-label={t('newProjectName')} placeholder={t('newProjectName')} value={newProject}
                  onChange={(event) => { setNewProject(event.target.value) }} />
                <button type="button" className={`${css.btn} ${css.btnDark}`} disabled={busy || newProject.trim() === ''}
                  onClick={() => { write(() => actions.createProject(newProject.trim()), () => { setNewProject(null) }) }}>{t('save')}</button>
                <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setNewProject(null) }}>{t('cancel')}</button>
              </span>
            )}
            <label className={css.field}>{t('labels')}
              <input className={css.input} defaultValue={issue.labels.join(', ')} placeholder={t('labelsPlaceholder')} key={issue.labels.join(',')}
                onBlur={(event) => {
                  const labels = parseLabels(event.target.value)
                  if (labels.join(',') !== issue.labels.join(',')) patch({ labels })
                }} />
            </label>
            <label className={css.field}>{t('parent')}
              <input className={css.input} defaultValue={issue.parentKey ?? ''} placeholder={parentExample(issue.key)} key={issue.parentKey ?? ''}
                onBlur={(event) => {
                  const parentKey = event.target.value.trim().toUpperCase()
                  if (parentKey !== (issue.parentKey ?? '')) patch({ parentKey: parentKey === '' ? null : parentKey })
                }} />
            </label>
            <p className={css.muted} style={{ fontSize: 12 }}>{t('createdBy', { name: issue.creatorName })} · {ago(issue.createdAt, now, t)}</p>
            {owner && !confirmDelete && (
              <button type="button" className={`${css.btn} ${css.btnGhost}`} disabled={busy} style={{ alignSelf: 'flex-start' }}
                onClick={() => { setConfirmDelete(true) }}>{t('delete')}</button>
            )}
            {owner && confirmDelete && (
              <div className={css.section} role="alertdialog" aria-label={t('delete')}>
                <p className={css.muted}>{t('deleteConfirm', { key: issue.key })}</p>
                <span className={css.actions}>
                  <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy}
                    onClick={() => { write(() => actions.remove(issue.key), close) }}>{t('delete')}</button>
                  <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => { setConfirmDelete(false) }}>{t('cancel')}</button>
                </span>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
