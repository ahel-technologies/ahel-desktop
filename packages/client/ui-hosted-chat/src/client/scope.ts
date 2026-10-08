/**
 * The Chats list's workspace scope. From the moment `uiWorkspace` exists the
 * hosted chat registers a Session filter: until the account is signed in and
 * the load's follow of the gateway cookie has picked the workspace, only the
 * blank New chat draft passes; then a chat passes in the workspace it was
 * started in, and a subagent with its top-level chat. A switch away from the open chat's workspace starts a new chat.
 */
import type { SessionListState, SessionSummary } from '@ahel/dsh-api-session-controller/client'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { SessionFilter } from '@ahel/dsh-client-ui-workspace/client'

/** The workspace whose chats the Chats list shows, and the workspace unstamped chats count as. */
export interface ChatScope {
  readonly current: string
  readonly home: string
}

/**
 * Where this load's follow of the gateway's workspace cookie stands: before the first signed-in
 * view, switching to the cookie's workspace, or done (switched, failed, or nothing to switch).
 */
export type FollowState =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'moving'; readonly to: string }
  | { readonly kind: 'settled' }

/**
 * The Chats list's workspace scope. Unstamped chats count as the account default's: the workspace
 * ahel.ai picks while none is selected, else the oldest membership, ahel.ai's default for a person
 * without a single invited seat. While the follow moves, its target stands in for the selection.
 * @param view - the account view.
 * @param picked - the workspace the team summary names, or null.
 * @param follow - the load's follow of the gateway cookie.
 * @returns the scope, or null while it is not known yet (signed out, or the follow has not
 * started), when only the New chat draft lists.
 */
export function chatScope(view: AhelAccountView | null, picked: string | null, follow: FollowState): ChatScope | null {
  if (view?.status !== 'signed-in' || view.profile === null || follow.kind === 'waiting') return null
  const selected = follow.kind === 'moving' ? follow.to : view.workspace
  const oldest = view.profile.workspaces[0]?.id ?? null
  const current = selected ?? picked ?? oldest
  if (current === null) return null
  return { current, home: selected === null ? current : oldest ?? current }
}

/** The parts of a Session row the scope reads; `retainedBy` is optional so rows from other sources fit. */
export type ChatRow = Pick<SessionSummary, 'blank' | 'origin' | 'parentId' | 'projectionValues'> & {
  readonly retainedBy?: SessionSummary['retainedBy']
}

/** Longest subagent chain walked to its top-level chat; a longer one is treated as broken. */
const MAX_DEPTH = 64

/**
 * Whether the Chats list shows a chat: the New chat draft always, a stamped chat in its workspace,
 * an unstamped one in the scope's `home`, and the open chat while its first step has not stamped
 * it yet (no prompt logged). A subagent row follows its top-level chat; one whose chain leaves
 * the list is hidden.
 * @param session - the Session row.
 * @param scope - the list's scope.
 * @param byId - the Session list's rows, for a subagent's chain.
 * @returns true to list the row.
 */
export function inChatScope(session: ChatRow, scope: ChatScope, byId: Readonly<Record<string, ChatRow | undefined>> = {}): boolean {
  let row = session
  for (let depth = 0; row.origin === 'subagent'; depth++) {
    const parent = row.parentId === undefined ? undefined : byId[row.parentId]
    if (parent === undefined || depth >= MAX_DEPTH) return false
    row = parent
  }
  if (row.blank) return true
  const stamp = row.projectionValues?.ahelWorkspace
  if (typeof stamp === 'string') return stamp === scope.current
  if ((row.retainedBy?.mainView ?? 0) > 0 && row.projectionValues?.sessionListMetadata?.lastPromptAt === null) return true
  return scope.home === scope.current
}

/**
 * The filter while the scope is not known: the New chat draft only.
 * @param session - the Session row.
 * @returns true for the blank draft.
 */
export function onlyDraft(session: Pick<SessionSummary, 'blank'>): boolean {
  return session.blank
}

/** What {@link watchChatScope} reads and drives. */
export interface ChatScopeDeps {
  readonly account: HostObservable<AhelAccountView | null>
  readonly summary: HostObservable<TeamSummaryState>
  readonly follow: HostObservable<FollowState>
  readonly sessions: HostObservable<SessionListState>
  /** `uiWorkspace.scopeSessions`. */
  readonly scopeSessions: (filter: SessionFilter) => () => void
  /** `uiWorkspace.startSession` with no target: a new chat in the current folder Workspace. */
  readonly startChat: () => void
}

/**
 * Keep one Session filter registered for the hosted Chats list, re-registered whenever the scope
 * moves, and start a new chat when the main view shows a chat outside the scope.
 * @param deps - the observables and the workspace actions.
 * @returns the disposer, which releases the filter.
 */
export function watchChatScope(deps: ChatScopeDeps): () => void {
  let key: string | undefined
  let release: (() => void) | undefined
  let checked: string | undefined
  const sync = (): void => {
    const scope = chatScope(deps.account.getSnapshot(), deps.summary.getSnapshot().summary?.workspace.id ?? null, deps.follow.getSnapshot())
    const next = scope === null ? '' : `${scope.current} ${scope.home}`
    if (next !== key) {
      key = next
      // The new filter goes in before the old one leaves, so the list is never unfiltered.
      const previous = release
      release = deps.scopeSessions(scope === null ? onlyDraft : session => inChatScope(session, scope, deps.sessions.getSnapshot().byId))
      previous?.()
    }
    if (scope === null) return
    const list = deps.sessions.getSnapshot()
    if (list.phase !== 'ready') return
    const main = Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
    if (main === undefined) return
    // Once per scope and open chat: a chat that only lost its stamp for a moment is never left twice.
    const at = `${next} ${main.id}`
    if (at === checked) return
    checked = at
    if (!inChatScope(main, scope, list.byId)) deps.startChat()
  }
  sync()
  const offs = [deps.account, deps.summary, deps.follow, deps.sessions].map(source => source.subscribe(sync))
  return () => {
    for (const off of offs) off()
    release?.()
  }
}
