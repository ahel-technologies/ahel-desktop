/**
 * Remote namespace `ahelTeam`: the team side of the signed-in ahel.ai
 * workspace over ahel.ai's `/api/desktop/*` routes, with the account's own
 * bearer and the selected `?workspace=`: held calls to approve, the vault's
 * key Connect form and sign-ins, teammate handoffs, and the balance line.
 * An ahel.ai without those routes answers every method with
 * `ahel-team/outdated`.
 */

import type { Context } from '@ahel/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@ahel/dsh-typert-protocol'
import type {
  ApprovalDecision, DesktopSummary, HandoffDraft, HandoffList, HandoffRead, HandoffReview, HandoffSent, HandoffShare, KeyConnectAnswer,
  KeyConnectSaved, VaultDisconnected, VaultSignInList,
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

  /** Call one `/api/desktop` route with the account's bearer; refresh once after a 401 from the route itself. */
  private async api(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown): Promise<unknown> {
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
