/** Pure helpers over issues: column order, labels, grouping, relative times and the run seed. */
import type { Issue, IssueActivity, IssuePriority, IssueRun, IssueRunState, IssueStatus } from '@ahel/dsh-ahel-account/types'
import type { IssuesKey } from './locales.ts'

/** ahel.ai's Issues page; one issue's detail is `<this>/<key>`. */
export const WEB_ISSUES = 'https://ahel.ai/app/issues'

/**
 * One issue's page on ahel.ai.
 * @param key - the issue key.
 * @param workspace - the selected workspace, carried as `?workspace=` like the Inbox's links.
 * @returns the URL.
 */
export function issueUrl(key: string, workspace?: string | null): string {
  const url = new URL(`${WEB_ISSUES}/${encodeURIComponent(key)}`)
  if (workspace !== undefined && workspace !== null) url.searchParams.set('workspace', workspace)
  return url.href
}

/** Board columns, left to right. */
export const BOARD_STATUSES: readonly IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done']

/** Every status, in the order the list view groups them. */
export const ALL_STATUSES: readonly IssueStatus[] = [...BOARD_STATUSES, 'cancelled']

/** Priorities, most pressing first. */
export const PRIORITIES: readonly IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none']

/** Statuses that no longer count as open work. */
export const CLOSED: ReadonlySet<IssueStatus> = new Set(['done', 'cancelled'])

const STATUS_KEY: Record<IssueStatus, IssuesKey> = {
  backlog: 'statusBacklog',
  todo: 'statusTodo',
  in_progress: 'statusInProgress',
  in_review: 'statusInReview',
  blocked: 'statusBlocked',
  done: 'statusDone',
  cancelled: 'statusCancelled',
}

const PRIORITY_KEY: Record<IssuePriority, IssuesKey> = {
  none: 'priorityNone',
  low: 'priorityLow',
  medium: 'priorityMedium',
  high: 'priorityHigh',
  urgent: 'priorityUrgent',
}

/** @returns the dictionary key naming a status. */
export function statusKey(status: IssueStatus): IssuesKey {
  return STATUS_KEY[status]
}

/** @returns the dictionary key naming a priority. */
export function priorityKey(priority: IssuePriority): IssuesKey {
  return PRIORITY_KEY[priority]
}

/** Whether a value read from a control is a status. */
export function isStatus(value: string): value is IssueStatus {
  return Object.hasOwn(STATUS_KEY, value)
}

/** Whether a value read from a control is a priority. */
export function isPriority(value: string): value is IssuePriority {
  return Object.hasOwn(PRIORITY_KEY, value)
}

/** Priority rank for sorting; urgent first. */
function rank(priority: IssuePriority): number {
  return PRIORITIES.indexOf(priority)
}

/**
 * Group issues by status, each group by priority then most recent change.
 * @param issues - the loaded issues.
 * @returns one array per status, every status present.
 */
export function groupByStatus(issues: readonly Issue[]): Record<IssueStatus, Issue[]> {
  const groups = Object.fromEntries(ALL_STATUSES.map(status => [status, [] as Issue[]])) as Record<IssueStatus, Issue[]>
  for (const issue of issues) groups[issue.status].push(issue)
  for (const group of Object.values(groups)) {
    group.sort((a, b) => rank(a.priority) - rank(b.priority) || b.updatedAt.localeCompare(a.updatedAt))
  }
  return groups
}

/**
 * The newer of the server's run and the one this window reported. A run
 * queued on ahel.ai after this window's run (no session yet) is compared by time.
 * @param issue - the issue as read.
 * @param local - the run this window started, if any.
 * @returns the run to show.
 */
export function currentRun(issue: Issue, local: IssueRun | undefined): IssueRun | null {
  if (local === undefined) return issue.run
  if (issue.run === null) return local
  if (issue.run.sessionId !== null && issue.run.sessionId !== local.sessionId) return local
  return local.updatedAt >= issue.run.updatedAt ? local : issue.run
}

/** The first wait before repeating a detail read ahel.ai gave no Retry-After for. */
const RETRY_FIRST_MS = 2_000

/** The longest wait between repeated detail reads. */
const RETRY_MAX_MS = 30_000

/**
 * How long the detail drawer waits before repeating a read that may work again.
 * @param afterMs - ahel.ai's Retry-After, or null.
 * @param attempt - repeats made so far, from 0.
 * @returns a wait that doubles from 2 s per repeat and is never shorter than the Retry-After; at most 30 s.
 */
export function retryWait(afterMs: number | null, attempt: number): number {
  return Math.min(Math.max(afterMs ?? 0, RETRY_FIRST_MS * 2 ** attempt), RETRY_MAX_MS)
}

/** Translate function shape this package's helpers take. */
export type Translate = (key: IssuesKey, params?: Record<string, string>) => string

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * How long ago, in the largest whole unit.
 * @param iso - the timestamp.
 * @param now - the current time.
 * @param t - dictionary.
 * @returns `just now`, `5 min ago`, `3 h ago` or `2d ago`.
 */
export function ago(iso: string, now: number, t: Translate): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return t('justNow')
  if (ms < HOUR_MS) return t('ago', { age: t('minutes', { n: String(Math.floor(ms / MINUTE_MS)) }) })
  if (ms < DAY_MS) return t('ago', { age: t('hours', { n: String(Math.floor(ms / HOUR_MS)) }) })
  return t('ago', { age: t('days', { n: String(Math.floor(ms / DAY_MS)) }) })
}

/**
 * The first message of a Run with Ahel chat.
 * @param issue - the issue.
 * @param t - dictionary.
 * @returns key, title, description and the instruction to finish with a summary and a review request.
 */
export function runSeed(issue: Issue, t: Translate): string {
  const description = issue.description.trim() === '' ? t('runSeedNoDescription') : issue.description.trim()
  return t('runSeed', { key: issue.key, title: issue.title, description, link: issueUrl(issue.key) })
}

/** Split a comma-separated labels field. */
export function parseLabels(value: string): string[] {
  return [...new Set(value.split(',').map(label => label.trim()).filter(Boolean))]
}

/**
 * An example parent key in the workspace's own prefix.
 * @param key - the current issue's key, for example `DEMO-7`.
 * @returns the prefix's first issue, for example `DEMO-1`.
 */
export function parentExample(key: string): string {
  return `${key.replace(/-\d+$/, '')}-1`
}

/** Initials for an avatar without a picture. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''
  return (first + last).toUpperCase()
}

const RUN_KEY: Record<IssueRunState, IssuesKey> = {
  queued: 'runQueued', running: 'runRunning', waiting_approval: 'runWaiting', waiting_input: 'runNeedsAnswer', finished: 'runFinished', failed: 'runFailed',
}

/**
 * Name a value an activity line carries: statuses, priorities and run states in the dictionary's words.
 * @param kind - the activity kind.
 * @param value - the raw value.
 * @param t - dictionary.
 * @returns the display value.
 */
function activityValue(kind: IssueActivity['kind'], value: string, t: Translate): string {
  if (kind === 'status' && isStatus(value)) return t(statusKey(value))
  if (kind === 'priority' && isPriority(value)) return t(priorityKey(value))
  if (kind === 'run' && Object.hasOwn(RUN_KEY, value)) return t(RUN_KEY[value as IssueRunState])
  return value
}

/**
 * The sentence for one activity line, after the actor's name.
 * @param row - the activity line.
 * @param t - dictionary.
 * @returns the sentence.
 */
export function activityText(row: IssueActivity, t: Translate): string {
  const from = row.from === null ? '' : activityValue(row.kind, row.from, t)
  const to = row.to === null ? '' : activityValue(row.kind, row.to, t)
  switch (row.kind) {
    case 'created': return t('activityCreated')
    case 'title': return t('activityTitle', { to })
    case 'description': return t('activityDescription')
    case 'status': return t('activityStatus', { from, to })
    case 'priority': return t('activityPriority', { to })
    case 'assignee': return row.to === null ? t('activityUnassigned') : t('activityAssignee', { to })
    case 'project': return row.to === null ? t('activityNoProject') : t('activityProject', { to })
    case 'labels': return t('activityLabels', { to })
    case 'parent': return row.to === null ? t('activityNoParent') : t('activityParent', { to })
    case 'commented': return t('activityCommented')
    case 'run': return t('activityRun', { to })
    default: return to
  }
}
