/**
 * Remote namespace `ahelTeam`: the team side of the signed-in ahel.ai
 * workspace over ahel.ai's `/api/desktop/*` routes, with the account's own
 * bearer and the selected `?workspace=`: held calls to approve, the vault's
 * key Connect form and sign-ins, teammate handoffs, the balance line, the
 * metered model facts of `/api/llm/v1/models` and the workspace's default
 * model. An ahel.ai without those routes answers every route method with
 * `ahel-team/outdated`. `sessionDraft` reads a local chat only.
 */

import type { Context } from '@ahel/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import type {
  AhelMeteredModel, AhelModelFacts, AhelWorkspaceModel, ApprovalDecision, DesktopSummary,
  HandoffDraft, HandoffList, HandoffRead, HandoffReview, HandoffSent, HandoffSessionDraft, HandoffShare,
  KeyConnectAnswer, KeyConnectSaved, VaultDisconnected, VaultSignInList,
} from './types.ts'

declare module '@ahel/cordis' {
  interface Context {
    ahelTeam: AhelTeam
  }
}

declare module '@ahel/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Ahel account is signed in, or ahel.ai refused its grant after one refresh. */
    'ahel-team/signed-out': Record<string, never>
    /** ahel.ai does not serve this `/api/desktop` route yet; the UI says "Update ahel.ai". */
    'ahel-team/outdated': { readonly status: number }
    /** This seat may not do it; the message is ahel.ai's own sentence. */
    'ahel-team/forbidden': { readonly error: string | null }
    /** ahel.ai refused the request (bad input, already decided, more than one account); the message is its own sentence. */
    'ahel-team/refused': { readonly status: number; readonly error: string | null; readonly webUrl: string | null }
    /** ahel.ai rate-limited the request; retry shortly. */
    'ahel-team/busy': { readonly retryAfterSec: number | null }
    /** ahel.ai did not answer, timed out, or answered a server error. */
    'ahel-team/unreachable': { readonly status: number | null }
  }
}

/** Origin passed by the parent `AhelAccount`. */
export interface TeamConfig {
  /** ahel.ai origin serving `/api/desktop/*`. */
  appOrigin: string
}

const TIMEOUT_MS = 15_000

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Read the `ahel` facts of one model row; a missing or malformed field is null.
 * @param value - the row's `ahel` member.
 * @returns the facts, or null when the row carries none.
 */
function modelFacts(value: unknown): AhelModelFacts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const facts = record(value)
  return {
    shortName: text(facts.shortName),
    maker: text(facts.maker),
    bestFor: text(facts.bestFor),
    typicalMessageCents: cents(facts.typicalMessageCents),
    lastChargeCents: cents(facts.lastChargeCents),
  }
}

/**
 * Read `GET /api/llm/v1/models`: `{ data: [{ id, name, ahel }] }`.
 * @param value - the response JSON.
 * @returns the rows with an id, in the server's order.
 */
export function parseMeteredModels(value: unknown): AhelMeteredModel[] {
  const data = record(value).data
  if (!Array.isArray(data)) return []
  return data.flatMap((row): AhelMeteredModel[] => {
    const fields = record(row)
    const id = text(fields.id)
    return id === null ? [] : [{ id, name: text(fields.name) ?? id, ahel: modelFacts(fields.ahel) }]
  })
}

function workspaceModel(value: unknown): AhelWorkspaceModel {
  return { defaultModel: text(record(value).defaultModel) }
}

/** The part of `ctx.sessionQuery` a handoff draft reads; the service is optional in a composition. */
interface SessionReader {
  readTitleSnapshots(sessionIds: readonly string[]): Promise<readonly ({ status: 'fulfilled'; value: { title?: { title: string } } } | { status: 'rejected' })[]>
  readSession(sessionId: string): Promise<{ events: readonly { type: string; data: unknown }[] }>
}

const DRAFT_TITLE_MAX = 120
const DRAFT_GOAL_MAX = 4000
const DRAFT_CHANGES_MAX = 6000

/** The text blocks of a message's content; reasoning and tool calls stay out. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map(block => record(block))
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => (block.text as string).trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Cut text to `max` characters at a character boundary, marking the cut. */
function clip(value: string, max: number): string {
  const chars = Array.from(value.trim())
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

/** Read a JSON body; undefined when it is not JSON. */
async function body(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (_notJson) {
    return undefined
  }
}

/** Child service of `AhelAccount`; the Remote namespace `ahelTeam`. */
export class AhelTeam extends TypertRemoteService {
  static inject = ['ahelAccount']
  private readonly appOrigin: string

  /**
   * @param ctx - Host context carrying `ahelAccount`.
   * @param config - origin from the parent account plugin.
   */
  constructor(ctx: Context, config: TeamConfig) {
    super(ctx, 'ahelTeam')
    this.appOrigin = config.appOrigin
  }

  /**
   * The sidebar and account-menu poll: pending approvals, unread handoffs and the balance.
   * @returns the summary; a part ahel.ai could not read is null.
   * @throws RemoteError `ahel-team/*`.
   */
  @Remote
  async summary(): Promise<DesktopSummary> {
    return await this.api('GET', '/api/desktop/summary') as DesktopSummary
  }

  /**
   * The workspace's metered models with ahel.ai's facts: short name, maker,
   * "best for" line, typical message price and the workspace's last charge.
   * @returns the rows in ahel.ai's order; `ahel` is null from an ahel.ai that sends no facts.
   * @throws RemoteError `ahel-team/*`.
   */
  @Remote
  async models(): Promise<AhelMeteredModel[]> {
    return parseMeteredModels(await this.api('GET', '/api/llm/v1/models'))
  }

  /**
   * The workspace's default metered model, where new chats start.
   * @returns the default; `defaultModel` is null when the owner chose none.
   * @throws RemoteError `ahel-team/outdated` from an ahel.ai without the route.
   */
  @Remote
  async workspaceModel(): Promise<AhelWorkspaceModel> {
    return workspaceModel(await this.api('GET', '/api/desktop/workspace/model'))
  }

  /**
   * Set the workspace's default metered model. Only the owner or an admin may.
   * @param model - a model id from `models()`, or null to clear the default.
   * @returns the stored default.
   * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` for an unknown model.
   */
  @Remote
  async setWorkspaceModel(model: string | null): Promise<AhelWorkspaceModel> {
    return workspaceModel(await this.api('PUT', '/api/desktop/workspace/model', { defaultModel: model }))
  }

  /**
   * Approve or decline one held call. Nothing runs here: approve opens a one-hour
   * window in which the requester's AI repeats the exact call.
   * @param id - `ApprovalRow.id`.
   * @param decision - the answer.
   * @param note - an optional note for the requester, up to 500 characters.
   * @returns the stored decision.
   * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` when it expired or was answered.
   */
  @Remote
  async decideApproval(id: string, decision: 'approved' | 'declined', note: string | null): Promise<ApprovalDecision> {
    const trimmed = note?.trim() ?? ''
    const payload = { decision, ...trimmed === '' ? {} : { note: trimmed.slice(0, 500) } }
    return await this.api('PATCH', `/api/desktop/approvals/${encodeURIComponent(id)}`, payload) as ApprovalDecision
  }

  /**
   * The workspace's managed sign-ins and whether this seat may change them.
   * @returns status only, never a token.
   * @throws RemoteError `ahel-team/*`.
   */
  @Remote
  async signIns(): Promise<VaultSignInList> {
    return await this.api('GET', '/api/desktop/connect') as VaultSignInList
  }

  /**
   * One app's Connect state: the key form for a key app, its sign-in for a sign-in app.
   * @param app - a catalog item id, stack key, vendor slug or `app:<service>`.
   * @returns the panel, the sign-in and the app's ahel.ai vault page.
   * @throws RemoteError `ahel-team/*`.
   */
  @Remote
  async connectPanel(app: string): Promise<KeyConnectAnswer> {
    return await this.api('GET', `/api/desktop/connect?app=${encodeURIComponent(app)}`) as KeyConnectAnswer
  }

  /**
   * Seal a key app's values in the workspace vault, install it and switch it on.
   * The values go to `POST /api/desktop/connect` only and are never logged or put in an error.
   * @param app - `KeyConnectView.app`.
   * @param values - `KeyConnectField.id` to the typed value.
   * @returns the panel after the save.
   * @throws RemoteError `ahel-team/forbidden` for a Member, `ahel-team/refused` for invalid fields.
   */
  @Remote
  async connect(app: string, values: Record<string, string>): Promise<KeyConnectSaved> {
    return await this.api('POST', '/api/desktop/connect', { app, values }) as KeyConnectSaved
  }

  /**
   * Forget an app's sign-in or stored key; the installed row stays.
   * @param app - the name `connectPanel` took.
   * @returns whether anything was removed.
   * @throws RemoteError `ahel-team/refused` with `webUrl` when the app has several accounts.
   */
  @Remote
  async disconnect(app: string): Promise<VaultDisconnected> {
    return await this.api('DELETE', `/api/desktop/connect?app=${encodeURIComponent(app)}`) as VaultDisconnected
  }

  /**
   * Handoffs received and sent.
   * @returns the Inbox.
   * @throws RemoteError `ahel-team/*`.
   */
  @Remote
  async inbox(): Promise<HandoffList> {
    return await this.api('GET', '/api/desktop/handoffs') as HandoffList
  }

  /**
   * Read one handoff and mark it read.
   * @param id - a handoff id from the Inbox.
   * @returns the handoff with its reader-safe text.
   * @throws RemoteError `ahel-team/refused` when it is not available to this person.
   */
  @Remote
  async openHandoff(id: string): Promise<HandoffRead> {
    return await this.api('GET', `/api/desktop/handoffs?id=${encodeURIComponent(id)}`) as HandoffRead
  }

  /**
   * The editable preview of a handoff with the teammate list; stores nothing.
   * @param draft - title and sections.
   * @returns the preview with the `requestKey` Share needs.
   * @throws RemoteError `ahel-team/refused` for invalid text or a plan without handoffs.
   */
  @Remote
  async prepareHandoff(draft: HandoffDraft): Promise<HandoffReview> {
    return await this.api('POST', '/api/desktop/handoffs', { operation: 'prepare', title: draft.title, sections: draft.sections }) as HandoffReview
  }

  /**
   * Deliver a reviewed handoff. Only the dialog's Share button calls this; that press is the person's confirmation.
   * @param share - the reviewed draft, the chosen teammates and the preview's `requestKey`.
   * @returns the delivery; a retry with the same `requestKey` answers `repeated: true`.
   * @throws RemoteError `ahel-team/refused` for an unknown teammate or invalid text.
   */
  @Remote
  async shareHandoff(share: HandoffShare): Promise<HandoffSent> {
    return await this.api('POST', '/api/desktop/handoffs', {
      operation: 'share', title: share.title, sections: share.sections, recipients: share.recipients, requestKey: share.requestKey,
    }) as HandoffSent
  }

  /**
   * Mark a handoff done; it stays readable.
   * @param id - a handoff id.
   * @returns the handoff with `status: 'done'`.
   * @throws RemoteError `ahel-team/refused` when it is not available to this person.
   */
  @Remote
  async markHandoffDone(id: string): Promise<HandoffSent> {
    return await this.api('POST', '/api/desktop/handoffs', { operation: 'done', id }) as HandoffSent
  }

  /**
   * Prefill for "Share with teammate" from one local chat; no network.
   * @param sessionId - the chat's session id.
   * @returns its title, the first message the person typed and the last assistant reply;
   * empty strings for what the session store could not give.
   */
  @Remote
  async sessionDraft(sessionId: string): Promise<HandoffSessionDraft> {
    const query = this.ctx.get('sessionQuery') as SessionReader | undefined
    if (query === undefined) return { title: '', goal: '', changes: '' }
    let title = ''
    try {
      const [result] = await query.readTitleSnapshots([sessionId])
      if (result?.status === 'fulfilled') title = clip(result.value.title?.title ?? '', DRAFT_TITLE_MAX)
    } catch (_unreadable) {
      // No title; the dialog asks for one.
    }
    try {
      const { events } = await query.readSession(sessionId)
      let goal = ''
      let changes = ''
      for (const event of events) {
        const data = record(event.data)
        // Only what the person typed; injected context and goal rounds carry other sources.
        if (goal === '' && event.type === 'user/message' && record(data.source).kind === 'user') goal = contentText(data.content)
        if (event.type === 'assistant/message') {
          const reply = contentText(record(data.message).content)
          if (reply !== '') changes = reply
        }
      }
      return { title, goal: clip(goal, DRAFT_GOAL_MAX), changes: clip(changes, DRAFT_CHANGES_MAX) }
    } catch (_unreadable) {
      return { title, goal: '', changes: '' }
    }
  }

  /** Call one `/api/desktop` route with the account's bearer; refresh once after a 401 from the route itself. */
  private async api(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown): Promise<unknown> {
    const url = new URL(path, this.appOrigin)
    const workspace = await this.ctx.ahelAccount.workspace()
    if (workspace !== undefined) url.searchParams.set('workspace', workspace)
    const init = payload === undefined ? {} : { body: JSON.stringify(payload) }
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ctx.ahelAccount.accessToken()
      if (token === undefined) throw new RemoteError('ahel-team/signed-out', 'sign in to Ahel first', {})
      try {
        response = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            ...payload === undefined ? {} : { 'Content-Type': 'application/json' },
          },
          ...init,
          // A redirect could carry a vault value to another origin; ahel.ai never redirects these routes.
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (error) {
        throw new RemoteError('ahel-team/unreachable', `ahel.ai did not answer: ${error instanceof Error ? error.name : 'network error'}`, { status: null })
      }
      // Only the route's own 401 carries WWW-Authenticate; an ahel.ai without
      // the route answers a bare 401 from its middleware.
      if (response.status !== 401 || response.headers.get('www-authenticate') === null) break
      await response.body?.cancel()
      if (attempt === 0) await this.ctx.ahelAccount.revalidate()
    }
    if (response === undefined) throw new RemoteError('ahel-team/unreachable', 'ahel.ai did not answer', { status: null })
    const status = response.status
    if (status === 401) {
      await response.body?.cancel()
      if (response.headers.get('www-authenticate') === null) throw this.outdated(status)
      throw new RemoteError('ahel-team/signed-out', 'ahel.ai no longer accepts this sign-in; sign in to Ahel again', {})
    }
    if (status === 429) {
      await response.body?.cancel()
      const retry = Number(response.headers.get('retry-after'))
      throw new RemoteError('ahel-team/busy', 'ahel.ai is busy; try again shortly', { retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null })
    }
    const answer = await body(response)
    if (response.ok) {
      if (answer === undefined) throw new RemoteError('ahel-team/unreachable', 'ahel.ai sent an unreadable answer', { status })
      return answer
    }
    const refusal = record(answer)
    const error = text(refusal.error)
    const detail = text(refusal.detail)
    // A route's own 404 names its error; a bare 404 means the route does not exist.
    if (status === 404 && error === null) throw this.outdated(status)
    if (status === 403) throw new RemoteError('ahel-team/forbidden', detail ?? 'Only the owner or a team lead can do this.', { error })
    if (status >= 400 && status < 500) {
      throw new RemoteError('ahel-team/refused', detail ?? error ?? `ahel.ai refused the request (HTTP ${status})`, { status, error, webUrl: text(refusal.webUrl) })
    }
    throw new RemoteError('ahel-team/unreachable', detail ?? `ahel.ai answered HTTP ${status}`, { status })
  }

  private outdated(status: number): RemoteError {
    return new RemoteError('ahel-team/outdated', 'ahel.ai does not offer this yet; update ahel.ai', { status })
  }
}

export default AhelTeam
