/**
 * The Issues main panel: header with New issue, the All / Members / Agents
 * chips, the agents at work, Filter and Display (board or list), then the
 * board (default) or the grouped list, the detail drawer and New Issue.
 * "C" opens New Issue while focus is not in a text field.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Issue, IssueStatus } from '@ahel/dsh-ahel-account/types'
import type { AssigneeFilter, IssuesInjected, IssuesPageProps, IssuesState } from './contract.ts'
import { Board, IssueList } from './Board.tsx'
import { Composer } from './Composer.tsx'
import { IssueDetail } from './IssueDetail.tsx'
import { currentRun } from './model.ts'
import { assigneeOptions } from './Parts.tsx'
import css from './Issues.module.css'

/** What the page reads of its slot props: the face, the feed hook and the dictionary. */
export type IssuesPageView = Omit<IssuesInjected, 'hooks'> & Pick<IssuesPageProps, 'useIssues' | 't'>

/** Relative times re-render this often. */
const TICK_MS = 30_000

const CHIPS: readonly { readonly value: AssigneeFilter; readonly key: 'filterAll' | 'filterMembers' | 'filterAgents' }[] = [
  { value: 'all', key: 'filterAll' }, { value: 'members', key: 'filterMembers' }, { value: 'agents', key: 'filterAgents' },
]

/** Whether a key press happened in a text field. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

/** Selects the whole state once; the page re-renders on any feed change. */
const all = (state: IssuesState): IssuesState => state

/**
 * Render the Issues panel.
 * @param props - composed slot props: the face, `useIssues` and `t`.
 * @returns the page.
 */
export function IssuesPage(props: IssuesPageView & { composeOnOpen?: boolean }) {
  const { useIssues, t, refresh, setFilter, openIssue, compose, dismissOffer, update, run, showBoard, composeOnOpen } = props
  const state = useIssues(all)
  const [display, setDisplay] = useState<'board' | 'list'>('board')
  const [filterOpen, setFilterOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [offerError, setOfferError] = useState<string | null>(null)

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])
  useEffect(() => {
    // The New issue sidebar row opens this panel with the sheet up, then hands the row back to Issues.
    if (composeOnOpen === true) { compose('backlog'); showBoard() }
  }, [composeOnOpen, compose, showBoard])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'c' || event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.target)) return
      if (state.composer !== null || state.open !== null) return
      event.preventDefault()
      compose('backlog')
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [compose, state.composer, state.open])

  const assignees = useMemo(() => assigneeOptions(state.assignees, state.issues, t), [state.assignees, state.issues, t])
  const openIssueRow: Issue | undefined = state.open === null ? undefined : state.issues.find(row => row.key === state.open)
  const offered = state.offerRun === null ? undefined : state.issues.find(row => row.key === state.offerRun)
  const filtered = state.filter.project !== null || state.filter.q.trim() !== ''

  const onMove = (key: string, status: IssueStatus): void => { void update(key, { status }) }

  let body
  if (state.phase === 'signed-out') body = <div className={`${css.empty} ${css.notice}`}><b>{t('signedOut')}</b></div>
  else if (state.phase === 'outdated') {
    body = (
      <div className={`${css.empty} ${css.notice}`}>
        <b>{t('outdated')}</b>
        <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={() => { props.openLink('https://ahel.ai/app') }}>ahel.ai</button>
      </div>
    )
  } else if (state.phase === 'failed') {
    body = (
      <div className={`${css.empty} ${css.notice}`}>
        <b>{state.message ?? t('failed')}</b>
        <button type="button" className={`${css.btn} ${css.btnSecondary}`} onClick={refresh}>{t('retry')}</button>
      </div>
    )
  } else if (state.phase === 'loading') body = <p className={`${css.muted} ${css.notice}`} aria-busy="true">{t('loading')}</p>
  else {
    const view = {
      issues: state.issues, counts: state.counts, runs: state.runs, now, t, agentModel: state.assignees?.agents[0]?.model ?? null,
      onOpen: (key: string) => { openIssue(key) }, onMove, onAdd: (status: IssueStatus) => { compose(status) },
    }
    body = (
      <>
        {state.message !== null && <p className={css.error} role="alert" style={{ marginTop: 12 }}>{state.message}</p>}
        {state.issues.length === 0 && (
          <div className={`${css.empty} ${css.notice}`}><b>{t(filtered ? 'emptyFiltered' : 'empty')}</b></div>
        )}
        {(state.issues.length > 0 || display === 'board') && (display === 'board' ? <Board {...view} /> : <IssueList {...view} />)}
      </>
    )
  }

  return (
    <div className={`${css.tokens} ${css.page}`}>
      <div className={css.top} />
      <div className={css.wrap}>
        <header className={css.head}>
          <div>
            <h1 className={css.h1}>{t('issues')}<span className={css.stop}>.</span></h1>
            <p className={css.lead}>{t('lead')}</p>
          </div>
          <div className={css.headActions}>
            <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={state.phase === 'signed-out'}
              onClick={() => { compose('backlog') }} title={t('newIssueShortcut')}>{t('newIssue')}</button>
          </div>
        </header>
        <div className={css.bar}>
          <div className={css.chips} role="group" aria-label={t('filter')}>
            {CHIPS.map(chip => (
              <button key={chip.value} type="button" className={css.chip} aria-pressed={state.filter.assignee === chip.value}
                onClick={() => { setFilter({ assignee: chip.value }) }}>{t(chip.key)}</button>
            ))}
          </div>
          <div className={css.barRight}>
            {state.agentsWorking > 0 && (
              <span className={css.working}>
                <span className={css.pulse} aria-hidden="true" />
                {state.agentsWorking === 1 ? t('agentWorking') : t('agentsWorking', { n: String(state.agentsWorking) })}
              </span>
            )}
            <div className={css.filterWrap}>
              <button type="button" className={`${css.btn} ${css.btnSecondary}`} aria-expanded={filterOpen}
                data-active={filtered || undefined} onClick={() => { setFilterOpen(!filterOpen) }}>
                {t('filter')}{filtered ? ' •' : ''}
              </button>
              {filterOpen && (
                <div className={css.filterPanel} role="dialog" aria-label={t('filter')}
                  onKeyDown={(event) => { if (event.key === 'Escape') setFilterOpen(false) }}>
                  <label className={css.field}>{t('search')}
                    <input className={css.input} type="search" defaultValue={state.filter.q}
                      onKeyDown={(event) => { if (event.key === 'Enter') setFilter({ q: event.currentTarget.value }) }}
                      onBlur={(event) => { if (event.target.value !== state.filter.q) setFilter({ q: event.target.value }) }} />
                  </label>
                  <label className={css.field}>{t('project')}
                    <select className={css.select} value={state.filter.project ?? ''}
                      onChange={(event) => { setFilter({ project: event.target.value === '' ? null : event.target.value }) }}>
                      <option value="">{t('allProjects')}</option>
                      {state.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                  {filtered && (
                    <button type="button" className={`${css.btn} ${css.btnGhost}`}
                      onClick={() => { setFilter({ project: null, q: '' }); setFilterOpen(false) }}>{t('clearFilters')}</button>
                  )}
                </div>
              )}
            </div>
            <div className={css.seg} role="group" aria-label={t('display')}>
              <button type="button" aria-pressed={display === 'board'} onClick={() => { setDisplay('board') }}>{t('displayBoard')}</button>
              <button type="button" aria-pressed={display === 'list'} onClick={() => { setDisplay('list') }}>{t('displayList')}</button>
            </div>
          </div>
        </div>
        {body}
      </div>
      {offered !== undefined && (
        <div className={css.toast} role="status">
          <span>{offered.key} · {t('runNowAsk')}</span>
          {offerError !== null && <span className={css.error}>{offerError}</span>}
          <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={() => {
            setOfferError(null)
            void run(offered).then((answer) => {
              if (answer.ok) dismissOffer()
              else setOfferError(answer.message ?? t('writeFailed'))
            })
          }}>{t('runNow')}</button>
          <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={dismissOffer}>{t('later')}</button>
        </div>
      )}
      {state.open !== null && (
        <IssueDetail
          issueKey={state.open}
          live={openIssueRow}
          run={openIssueRow === undefined ? state.runs[state.open] ?? null : currentRun(openIssueRow, state.runs[state.open])}
          projects={state.projects}
          assignees={assignees}
          role={state.role}
          now={now}
          t={t}
          actions={props}
          close={() => { openIssue(null) }}
        />
      )}
      {state.composer !== null && (
        <Composer status={state.composer.status} projects={state.projects} assignees={assignees} t={t}
          create={props.create} close={() => { compose(null) }} />
      )}
    </div>
  )
}

/**
 * The New issue row's panel: the Issues panel with New Issue open.
 * @param props - the Issues panel props.
 * @returns the page.
 */
export function NewIssuePage(props: IssuesPageProps) {
  return <IssuesPage {...props} composeOnOpen />
}
