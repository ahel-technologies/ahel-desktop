/** Small pieces shared by the board, the list and the detail: status glyph, assignee, run progress and the assignee options. */
import { AhelTile } from '@ahel/dsh-client-ui-primitives'
import type { Issue, IssueActorType, IssueAssignees, IssueRun, IssueStatus } from '@ahel/dsh-ahel-account/types'
import { initials, type Translate } from './model.ts'
import css from './Issues.module.css'

/** The built-in agent of every workspace. */
export const AGENT = { id: 'ahel', name: 'Ahel' } as const

/**
 * The status glyph: an empty dashed ring for backlog, a ring for todo, a half
 * disc for work in progress, a three-quarter disc in review, a bar for blocked,
 * a check for done and a cross for cancelled.
 * @param props - the status and the edge.
 * @returns the decorative glyph.
 */
export function StatusIcon({ status, size = 14 }: { status: IssueStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true, className: css.statusIcon, 'data-status': status } as const
  switch (status) {
    case 'backlog':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2 2"><circle cx="7" cy="7" r="5.5" /></svg>
    case 'todo':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4}><circle cx="7" cy="7" r="5.5" /></svg>
    case 'in_progress':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4}><circle cx="7" cy="7" r="5.5" /><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" stroke="none" /></svg>
    case 'in_review':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4}><circle cx="7" cy="7" r="5.5" /><path d="M7 3.5a3.5 3.5 0 1 1-3.5 3.5H7z" fill="currentColor" stroke="none" /></svg>
    case 'blocked':
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4}><circle cx="7" cy="7" r="5.5" /><path d="M4.5 7h5" strokeWidth={1.8} strokeLinecap="round" /></svg>
    case 'done':
      return <svg {...common} fill="currentColor"><circle cx="7" cy="7" r="6.2" /><path d="m4.4 7.1 1.8 1.8 3.5-3.6" fill="none" stroke="var(--ahel-card)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
    default:
      return <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.4}><circle cx="7" cy="7" r="5.5" /><path d="m5 5 4 4M9 5l-4 4" strokeLinecap="round" /></svg>
  }
}

/**
 * The agent's display name: the "ahel" wordmark for the built-in agent, else the name ahel.ai sent.
 * @param name - ahel.ai's agent name, or null.
 * @param t - dictionary.
 * @returns the name to show.
 */
export function agentLabel(name: string | null, t: Translate): string {
  return name === null || name.trim().toLowerCase() === AGENT.id ? t('agentName') : name
}

/**
 * Who an issue is assigned to: the Ahel tile and name for the agent, a picture or initials for a teammate.
 * @param props - the issue's assignee fields and the dictionary.
 * @returns avatar and name.
 */
export function Assignee({ type, name, avatar, compact, t }: {
  type: IssueActorType | null
  /** Picture only, for comment authors whose name shows beside it. */
  compact?: boolean
  name: string | null
  /** A picture URL or initials. */
  avatar: string | null | undefined
  t: Translate
}) {
  if (type === null) {
    return <span className={css.who}><span className={`${css.avatar} ${css.avatarNone}`} aria-hidden="true" /><span className={css.whoName}>{t('unassigned')}</span></span>
  }
  if (type === 'agent') {
    return (
      <span className={`${css.who} ${css.whoAgent}`}>
        <AhelTile size={20} />
        {compact !== true && <span className={css.whoName}>{agentLabel(name, t)}</span>}
      </span>
    )
  }
  const display = name ?? t('unassigned')
  return (
    <span className={css.who}>
      <span className={css.avatar} aria-hidden="true">
        {typeof avatar === 'string' && /^https:\/\//.test(avatar) ? <img src={avatar} alt="" /> : avatar !== null && avatar !== undefined && avatar.length <= 3 ? avatar : initials(display)}
      </span>
      {compact !== true && <span className={css.whoName}>{display}</span>}
    </span>
  )
}

/**
 * A run's progress: a ring filled steps/total while it works (a spinning
 * quarter while the total is unknown), "Waiting for approval" while a
 * confirmation waits, and the end state once it settled.
 * @param props - the run and the dictionary.
 * @returns the progress, or nothing without a run.
 */
export function RunProgress({ run, t }: { run: IssueRun | null; t: Translate }) {
  if (run === null || run.state === null) return null
  if (run.state === 'waiting_approval') return <span className={css.waiting}>{t('runWaiting')}</span>
  if (run.state === 'finished' || run.state === 'failed') {
    return <span className={css.run} data-state={run.state}>{t(run.state === 'finished' ? 'runFinished' : 'runFailed')}</span>
  }
  // ahel.ai stores an unknown total as 0.
  const total = run.totalSteps !== null && run.totalSteps > 0 ? run.totalSteps : null
  const fraction = total !== null ? Math.min(1, run.steps / total) : 0.25
  const circumference = 2 * Math.PI * 6
  const label = total !== null ? t('runSteps', { steps: String(run.steps), total: String(total) }) : t('runStepsOnly', { steps: String(run.steps) })
  return (
    <span className={css.run} data-state={run.state} title={run.state === 'queued' ? t('runQueued') : t('runRunning')}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className={css.ringTrack} />
        <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" strokeLinecap="round" className={css.ringFill}
          strokeDasharray={`${fraction * circumference} ${circumference}`} />
      </svg>
      {label}
    </span>
  )
}

/** One assignee choice: the select value encodes `type:id`; empty is unassigned. */
export interface AssigneeOption {
  readonly value: string
  readonly type: IssueActorType | null
  readonly id: string | null
  readonly label: string
}

/**
 * The assignee choices: unassigned, the workspace's agents and seats from
 * ahel.ai, or before that read, me, the Ahel agent and the teammates seen on loaded issues.
 * @param assignees - ahel.ai's list, or null.
 * @param issues - the loaded issues.
 * @param t - dictionary.
 * @returns the options.
 */
export function assigneeOptions(assignees: IssueAssignees | null, issues: readonly Issue[], t: Translate): AssigneeOption[] {
  const options: AssigneeOption[] = [{ value: '', type: null, id: null, label: t('unassigned') }]
  if (assignees !== null) {
    for (const agent of assignees.agents) {
      options.push({ value: `agent:${agent.id}`, type: 'agent', id: agent.id, label: `${agent.name} · ${t('agentTag')}` })
    }
    for (const member of assignees.members) options.push({ value: `member:${member.id}`, type: 'member', id: member.id, label: member.name })
    return options
  }
  options.push(
    { value: 'member:me', type: 'member', id: 'me', label: t('me') },
    { value: `agent:${AGENT.id}`, type: 'agent', id: AGENT.id, label: `${AGENT.name} · ${t('agentTag')}` },
  )
  const seen = new Set(options.map(option => option.value))
  for (const issue of issues) {
    if (issue.assigneeType !== 'member' || issue.assigneeId === null) continue
    const value = `member:${issue.assigneeId}`
    if (seen.has(value)) continue
    seen.add(value)
    options.push({ value, type: 'member', id: issue.assigneeId, label: issue.assigneeName ?? issue.assigneeId })
  }
  return options
}

/** The select value of an issue's assignee. */
export function assigneeValue(type: IssueActorType | null, id: string | null): string {
  return type === null || id === null ? '' : `${type}:${id}`
}
