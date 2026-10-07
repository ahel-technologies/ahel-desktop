/**
 * Remote namespace `ahelIssues`: the signed-in workspace's issues over
 * ahel.ai's `/api/desktop/issues` and `/api/desktop/projects` routes, with
 * the account's bearer and the selected `?workspace=`. An ahel.ai without
 * those routes answers every method with `ahel-issues/outdated`; a write the
 * person's role does not allow answers `ahel-issues/forbidden` carrying
 * ahel.ai's reason. Runs this Host reported live (running or waiting) and
 * never ended are reported `failed` with the reason `desktop closed` when the
 * Host stops, within {@link CLOSE_DEADLINE_MS}.
 */

import type { Context } from '@ahel/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import type {
  Issue, IssueActivity, IssueActorType, IssueAssignees, IssueComment, IssueDraft, IssuePage, IssuePatch, IssueProject, IssueQuery,
  IssueRunReport, IssueRunState, IssueWriteAnswer,
} from './issues-types.ts'

declare module '@ahel/cordis' {
  interface Context {
    ahelIssues: AhelIssues
  }
}

/** Origin passed by the parent `AhelAccount`. */
export interface IssuesConfig {
  /** ahel.ai origin serving `/api/desktop/issues`. */
  appOrigin: string
}

const DEADLINE_MS = 15_000

/** The closing `failed` reports of a stopping Host get this long in all. */
const CLOSE_DEADLINE_MS = 3_000

/** The reason a run left live by a stopping Host is reported with. */
const CLOSED_REASON = 'desktop closed'

/** Run states that keep a run live on ahel.ai. */
const LIVE_STATES: ReadonlySet<IssueRunState> = new Set(['running', 'waiting_approval', 'waiting_input'])

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function sentence(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * The wire body of a create or patch: ahel.ai names the project `projectId`.
 * @param fields - a draft or a patch.
 * @returns the body with `project` renamed.
 */
function wireFields(fields: IssueDraft | IssuePatch): Record<string, unknown> {
  const { project, ...rest } = fields
  return project === undefined ? rest : { ...rest, projectId: project }
}

/**
 * Whether a caught value is ahel.ai's 4xx refusal raised by `settle`.
 * @param error - the caught value.
 * @returns true for `ahel-issues/refused`.
 */
function isRefusal(error: unknown): error is RemoteError<'ahel-issues/refused'> {
  return error instanceof RemoteError && error.code === 'ahel-issues/refused'
}

/** One path segment for an issue key. */
function issuePath(key: string, tail = ''): string {
  return `/api/desktop/issues/${encodeURIComponent(key)}${tail}`
}

/**
 * Read an issue out of a write answer: the issue itself or `{ issue }`.
 * @param answer - the parsed body.
 * @returns the issue, or null when the body carries none.
 */
function writtenIssue(answer: unknown): Issue | null {
  if (isIssue(answer)) return answer
  const nested = fields(answer).issue
  return isIssue(nested) ? nested : null
}

/** ahel.ai's issue shape is trusted once the body carries a key. */
function isIssue(value: unknown): value is Issue {
  return typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string'
}

/** Child service of `AhelAccount`; the Remote namespace `ahelIssues`. */
export class AhelIssues extends TypertRemoteService {
  static inject = ['ahelAccount']
  private readonly origin: string
  /** The last report of each run this Host reported live and has not ended, by issue key. */
  private readonly live = new Map<string, IssueRunReport>()
  /** Set once ahel.ai refused `waiting_input`; later reports send `waiting_approval` at once. */
  private waitingInputRefused = false

  /**
   * @param ctx - Host context carrying `ahelAccount`.
   * @param config - origin from the parent account plugin.
   */
  constructor(ctx: Context, config: IssuesConfig) {
    super(ctx, 'ahelIssues')
    this.origin = config.appOrigin
    ctx.effect(() => async () => { await this.closeLiveRuns() }, 'ahel-issues: fail live runs on stop')
  }

  /**
   * One page of issues with per-status counts and the number of agents at work.
   * @param query - filters; `assigneeId: 'me'` is the signed-in person.
   * @returns the page.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async list(query: IssueQuery): Promise<IssuePage> {
    const params = new URLSearchParams()
    for (const name of ['status', 'assigneeType', 'assigneeId', 'project', 'runState', 'requestedBy', 'q', 'cursor', 'limit'] as const) {
      const value = query[name]
      if (value !== undefined && value !== '') params.set(name, String(value))
    }
    const search = params.size === 0 ? '' : `?${params.toString()}`
    const page = fields(await this.call('GET', `/api/desktop/issues${search}`))
    return {
      issues: Array.isArray(page.issues) ? page.issues as Issue[] : [],
      nextCursor: sentence(page.nextCursor),
      counts: fields(page.counts) as Record<string, number>,
      agentsWorking: typeof page.agentsWorking === 'number' ? page.agentsWorking : 0,
      agentsQueued: typeof page.agentsQueued === 'number' ? page.agentsQueued : null,
    }
  }

  /**
   * Create an issue.
   * @param draft - its fields.
   * @returns the stored issue.
   * @throws RemoteError `ahel-issues/refused` for invalid fields.
   */
  @Remote
  async create(draft: IssueDraft): Promise<IssueWriteAnswer> {
    return { issue: writtenIssue(await this.call('POST', '/api/desktop/issues', wireFields(draft))) }
  }

  /**
   * Read one issue.
   * @param key - for example `AHEL-137`.
   * @returns the issue.
   * @throws RemoteError `ahel-issues/refused` for an unknown key.
   */
  @Remote
  async get(key: string): Promise<IssueWriteAnswer> {
    return { issue: writtenIssue(await this.call('GET', issuePath(key))) }
  }

  /**
   * Change some fields of one issue.
   * @param key - the issue.
   * @param patch - only the fields to change.
   * @returns the issue after the change.
   * @throws RemoteError `ahel-issues/forbidden` with ahel.ai's reason when the role may not edit it.
   */
  @Remote
  async update(key: string, patch: IssuePatch): Promise<IssueWriteAnswer> {
    return { issue: writtenIssue(await this.call('PATCH', issuePath(key), wireFields(patch))) }
  }

  /**
   * Delete one issue; ahel.ai allows it for owners only. (`remove` is reserved by the Remote namespace service.)
   * @param key - the issue.
   * @returns nothing.
   * @throws RemoteError `ahel-issues/forbidden` with ahel.ai's reason.
   */
  @Remote
  async deleteIssue(key: string): Promise<IssueWriteAnswer> {
    await this.call('DELETE', issuePath(key))
    return { issue: null }
  }

  /**
   * The comments on one issue, oldest first.
   * @param key - the issue.
   * @returns the comments.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async comments(key: string): Promise<readonly IssueComment[]> {
    const answer = await this.call('GET', issuePath(key, '/comments'))
    const list = Array.isArray(answer) ? answer : fields(answer).comments
    return Array.isArray(list) ? list as IssueComment[] : []
  }

  /**
   * Post a comment as the signed-in person, or for the Ahel agent (a run's summary).
   * @param key - the issue.
   * @param body - markdown.
   * @param authorType - `agent` shows the comment as Ahel's; the person still owns it.
   * @returns the comments after the post.
   * @throws RemoteError `ahel-issues/forbidden` or `ahel-issues/refused`.
   */
  @Remote
  async comment(key: string, body: string, authorType: IssueActorType): Promise<readonly IssueComment[]> {
    await this.call('POST', issuePath(key, '/comments'), { body, authorType })
    return await this.comments(key)
  }

  /**
   * The activity log of one issue, oldest first.
   * @param key - the issue.
   * @returns the activity lines.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async activity(key: string): Promise<readonly IssueActivity[]> {
    const answer = await this.call('GET', issuePath(key, '/activity'))
    const list = Array.isArray(answer) ? answer : fields(answer).activity
    return Array.isArray(list) ? list as IssueActivity[] : []
  }

  /**
   * Report the state of the desktop chat that works on one issue; ahel.ai moves the issue's status with it.
   * The first report on a queued run claims it; when another session holds the run, ahel.ai answers 409 `run_claimed`.
   * An ahel.ai that refuses `waiting_input` (400) gets the same report as `waiting_approval`.
   * @param key - the issue.
   * @param report - the session, its state and the steps so far.
   * @returns the issue after the report.
   * @throws RemoteError `ahel-issues/refused` with `details.error === 'run_claimed'` when another session holds the run,
   *   or another `ahel-issues/*`.
   */
  @Remote
  async run(key: string, report: IssueRunReport): Promise<IssueWriteAnswer> {
    let sent = report.state === 'waiting_input' && this.waitingInputRefused ? { ...report, state: 'waiting_approval' as const } : report
    let answer: unknown
    try {
      answer = await this.call('POST', issuePath(key, '/run'), sent)
    } catch (error) {
      if (!isRefusal(error)) throw error
      if (sent.state === 'waiting_input' && error.details.status === 400) {
        this.waitingInputRefused = true
        sent = { ...sent, state: 'waiting_approval' }
        answer = await this.call('POST', issuePath(key, '/run'), sent)
      } else {
        if (error.details.error === 'run_claimed') this.live.delete(key)
        throw error
      }
    }
    if (LIVE_STATES.has(sent.state)) this.live.set(key, sent)
    else if (this.live.get(key)?.sessionId === sent.sessionId) this.live.delete(key)
    return { issue: writtenIssue(answer) }
  }

  /** Report every live run `failed` with {@link CLOSED_REASON}; gives up after {@link CLOSE_DEADLINE_MS}. */
  private async closeLiveRuns(): Promise<void> {
    const runs = [...this.live]
    this.live.clear()
    if (runs.length === 0) return
    const signal = AbortSignal.timeout(CLOSE_DEADLINE_MS)
    const reports = Promise.allSettled(runs.map(([key, last]) => this.call('POST', issuePath(key, '/run'), {
      sessionId: last.sessionId, state: 'failed', steps: last.steps, totalSteps: last.totalSteps, reason: CLOSED_REASON,
    } satisfies IssueRunReport, signal)))
    await Promise.race([reports, new Promise((resolve) => { signal.addEventListener('abort', resolve, { once: true }) })])
  }

  /**
   * Who issues can be assigned to: the workspace's seats and the Ahel agent with its model.
   * @returns the members and agents.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async assignees(): Promise<IssueAssignees> {
    const answer = fields(await this.call('GET', '/api/desktop/issues/assignees'))
    return {
      members: Array.isArray(answer.members) ? answer.members as IssueAssignees['members'] : [],
      agents: Array.isArray(answer.agents) ? answer.agents as IssueAssignees['agents'] : [],
    }
  }

  /**
   * The workspace's projects.
   * @returns the projects.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async projects(): Promise<readonly IssueProject[]> {
    const answer = await this.call('GET', '/api/desktop/projects')
    const list = Array.isArray(answer) ? answer : fields(answer).projects
    return Array.isArray(list) ? list as IssueProject[] : []
  }

  /**
   * Create a project.
   * @param name - its name.
   * @returns the projects after the create.
   * @throws RemoteError `ahel-issues/forbidden` or `ahel-issues/refused`.
   */
  @Remote
  async createProject(name: string): Promise<readonly IssueProject[]> {
    await this.call('POST', '/api/desktop/projects', { name })
    return await this.projects()
  }

  /**
   * Mark one issue row of the Inbox read.
   * @param id - `IssueInboxItem.id`.
   * @returns how many rows changed.
   * @throws RemoteError `ahel-issues/*`.
   */
  @Remote
  async readItem(id: string): Promise<number> {
    const answer = fields(await this.call('POST', '/api/desktop/handoffs', { operation: 'item_read', id }))
    return typeof answer.updated === 'number' ? answer.updated : 0
  }

  /** Call one route with the account's bearer; one refresh after the route's own 401; `deadline` replaces the 15 s timeout. */
  private async call(method: Method, path: string, payload?: unknown, deadline?: AbortSignal): Promise<unknown> {
    const url = new URL(path, this.origin)
    const workspace = await this.ctx.ahelAccount.workspace()
    if (workspace !== undefined) url.searchParams.set('workspace', workspace)
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ctx.ahelAccount.accessToken()
      if (token === undefined) throw new RemoteError('ahel-issues/signed-out', 'sign in to Ahel first', {})
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      if (payload !== undefined) headers['Content-Type'] = 'application/json'
      try {
        response = await fetch(url, {
          method, headers, redirect: 'error', signal: deadline ?? AbortSignal.timeout(DEADLINE_MS),
          ...payload === undefined ? {} : { body: JSON.stringify(payload) },
        })
      } catch (error) {
        throw new RemoteError('ahel-issues/unreachable', `ahel.ai did not answer: ${error instanceof Error ? error.name : 'network error'}`, { status: null })
      }
      // Only the route's own 401 names WWW-Authenticate; a bare 401 means the route is missing.
      if (response.status !== 401 || response.headers.get('www-authenticate') === null) break
      await response.body?.cancel()
      if (attempt === 0) await this.ctx.ahelAccount.revalidate()
    }
    if (response === undefined) throw new RemoteError('ahel-issues/unreachable', 'ahel.ai did not answer', { status: null })
    return await this.settle(response)
  }

  /** Turn one answer into its body or the matching `ahel-issues/*` error. */
  private async settle(response: Response): Promise<unknown> {
    const { status } = response
    if (status === 204) return {}
    if (status === 401) {
      await response.body?.cancel()
      if (response.headers.get('www-authenticate') === null) throw this.outdated(status)
      throw new RemoteError('ahel-issues/signed-out', 'ahel.ai no longer accepts this sign-in; sign in to Ahel again', {})
    }
    if (status === 429) {
      await response.body?.cancel()
      const retry = Number(response.headers.get('retry-after'))
      throw new RemoteError('ahel-issues/busy', 'ahel.ai is busy; try again shortly', { retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null })
    }
    let answer: unknown
    try {
      answer = await response.json()
    } catch (_notJson) {
      answer = undefined
    }
    if (response.ok) {
      if (answer === undefined) throw new RemoteError('ahel-issues/unreachable', 'ahel.ai sent an unreadable answer', { status })
      return answer
    }
    const refusal = fields(answer)
    const error = sentence(refusal.error)
    const reason = sentence(refusal.reason) ?? sentence(refusal.detail)
    if (status === 404 && error === null) throw this.outdated(status)
    if (status === 403) throw new RemoteError('ahel-issues/forbidden', reason ?? error ?? 'Your role cannot change this issue.', { error })
    if (status >= 400 && status < 500) {
      throw new RemoteError('ahel-issues/refused', reason ?? error ?? `ahel.ai refused the request (HTTP ${status})`, { status, error })
    }
    throw new RemoteError('ahel-issues/unreachable', reason ?? `ahel.ai answered HTTP ${status}`, { status })
  }

  private outdated(status: number): RemoteError {
    return new RemoteError('ahel-issues/outdated', 'ahel.ai does not offer issues yet; update ahel.ai', { status })
  }
}

export default AhelIssues
