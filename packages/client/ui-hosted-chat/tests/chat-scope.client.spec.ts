import { describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@ahel/dsh-api-session-controller/client'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import type { SessionFilter } from '@ahel/dsh-client-ui-workspace/client'
import type { FollowState } from '../src/client/index.ts'
import { chatScope, inChatScope, watchChatScope } from '../src/client/index.ts'
import { cell } from '../src/client/observable.ts'

function signedIn(workspace: string | null): AhelAccountView {
  return {
    status: 'signed-in', attempt: null, reachable: true, workspace,
    profile: { email: 'k@example.com', name: null, workspaces: [{ id: 'w1', name: 'A', slug: 'a', role: 'OWNER' }, { id: 'w2', name: 'B', slug: 'b', role: 'MEMBER' }] },
  }
}

const SETTLED: FollowState = { kind: 'settled' }
const WAITING: FollowState = { kind: 'waiting' }

const chat = (ahelWorkspace?: string | null, blank = false) => ({
  blank, ...ahelWorkspace === undefined ? {} : { projectionValues: { ahelWorkspace } },
})

describe('hosted Chats list scope', () => {
  it('has no scope while signed out or before the follow starts', () => {
    expect(chatScope(null, null, SETTLED)).toBeNull()
    expect(chatScope({ ...signedIn(null), status: 'signed-out', profile: null }, null, SETTLED)).toBeNull()
    expect(chatScope(signedIn('w1'), null, WAITING)).toBeNull()
  })

  it('shows chats stamped with the selected workspace and the New chat draft', () => {
    const scope = chatScope(signedIn('w2'), 'w2', SETTLED)!
    expect(scope).toEqual({ current: 'w2', home: 'w1' })
    expect(inChatScope(chat('w2'), scope)).toBe(true)
    expect(inChatScope(chat('w1'), scope)).toBe(false)
    expect(inChatScope(chat('w1', true), scope)).toBe(true)
    expect(inChatScope({ ...chat(), origin: 'subagent' }, scope)).toBe(true)
  })

  it('lists unstamped chats under the default workspace only', () => {
    const second = chatScope(signedIn('w2'), null, SETTLED)!
    expect(inChatScope(chat(), second)).toBe(false)
    expect(inChatScope(chat(null), second)).toBe(false)
    const first = chatScope(signedIn('w1'), null, SETTLED)!
    expect(inChatScope(chat(), first)).toBe(true)
    // With no workspace selected, the one ahel.ai picked is the default.
    const picked = chatScope(signedIn(null), 'w2', SETTLED)!
    expect(picked).toEqual({ current: 'w2', home: 'w2' })
    expect(inChatScope(chat(), picked)).toBe(true)
    expect(inChatScope(chat('w1'), picked)).toBe(false)
  })

  it('takes the follow target over the saved selection while the follow moves', () => {
    expect(chatScope(signedIn('w1'), 'w1', { kind: 'moving', to: 'w2' })).toEqual({ current: 'w2', home: 'w1' })
  })
})

function row(id: string, stamp: string | null, options: { blank?: boolean; main?: boolean } = {}): SessionSummary {
  return {
    id, blank: options.blank ?? false, projectionValues: { ahelWorkspace: stamp },
    retainedBy: options.main === true ? { mainView: 1 } : {},
  } as SessionSummary
}

function listOf(rows: readonly SessionSummary[]): SessionListState {
  return { phase: 'ready', ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) } as SessionListState
}

function bench(view: AhelAccountView | null, rows: readonly SessionSummary[]) {
  const account = cell<AhelAccountView | null>(view)
  const summary = cell<TeamSummaryState>({ summary: null, outdated: false, error: null })
  const follow = cell<FollowState>(WAITING)
  const sessions = cell(listOf(rows))
  const filters = new Set<SessionFilter>()
  const startChat = vi.fn()
  const dispose = watchChatScope({
    account, summary, follow, sessions, startChat,
    scopeSessions: (filter) => { filters.add(filter); return () => { filters.delete(filter) } },
  })
  const listed = (): string[] => {
    expect(filters.size).toBe(1)
    const [filter] = filters
    return sessions.getSnapshot().ids.filter(id => filter!(sessions.getSnapshot().byId[id]!))
  }
  return { account, follow, sessions, filters, startChat, dispose, listed }
}

describe('watchChatScope', () => {
  const rows = [row('draft', null, { blank: true }), row('a', 'w1'), row('b', 'w2'), row('legacy', null)]

  it('lists only the draft until the account is signed in and the follow has settled, then the followed workspace', () => {
    const b = bench(null, rows)
    expect(b.listed()).toEqual(['draft'])
    // The saved selection is w1, but the cookie names w2: w1's chats never show.
    b.account.set(signedIn('w1'))
    expect(b.listed()).toEqual(['draft'])
    b.follow.set({ kind: 'moving', to: 'w2' })
    expect(b.listed()).toEqual(['draft', 'b'])
    b.account.set(signedIn('w2'))
    b.follow.set(SETTLED)
    expect(b.listed()).toEqual(['draft', 'b'])
    b.account.set(null)
    expect(b.listed()).toEqual(['draft'])
    b.dispose()
    expect(b.filters.size).toBe(0)
  })

  it('starts a new chat when the open chat leaves the scope, once per scope and chat', () => {
    const b = bench(signedIn('w1'), [row('draft', null, { blank: true }), row('a', 'w1', { main: true }), row('b', 'w2')])
    b.follow.set(SETTLED)
    expect(b.startChat).not.toHaveBeenCalled()
    b.account.set(signedIn('w2'))
    expect(b.startChat).toHaveBeenCalledOnce()
    // Further list updates for the same open chat do not start another.
    b.sessions.set(listOf([row('draft', null, { blank: true }), row('a', 'w1', { main: true }), row('b', 'w2')]))
    expect(b.startChat).toHaveBeenCalledOnce()
    // The new blank draft is in scope.
    b.sessions.set(listOf([row('draft', null, { blank: true, main: true }), row('a', 'w1'), row('b', 'w2')]))
    expect(b.startChat).toHaveBeenCalledOnce()
    b.dispose()
  })

  it('leaves an unstamped chat open in the default workspace and replaces it on a cold load into another', () => {
    const home = bench(signedIn('w1'), [row('legacy', null, { main: true })])
    home.follow.set(SETTLED)
    expect(home.startChat).not.toHaveBeenCalled()
    const other = bench(signedIn('w1'), [row('legacy', null, { main: true })])
    other.follow.set({ kind: 'moving', to: 'w2' })
    expect(other.startChat).toHaveBeenCalledOnce()
  })
})
