// @vitest-environment jsdom
/** The `?prompt=` text from ahel.ai's starters: address bar, tab stash, and the blank chat it goes into. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@ahel/dsh-api-session-controller/client'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import {
  capturePromptDraft, type FollowState, MAX_PROMPT_DRAFT, PROMPT_DRAFT_KEY, readPromptParam, takePromptDraft, watchChatScope,
} from '../src/client/index.ts'
import { cell } from '../src/client/observable.ts'

const TASK = 'Use Ahel to brief me on an Estonian company. Ask me for the company name first.'

function signedIn(): AhelAccountView {
  return {
    status: 'signed-in', attempt: null, reachable: true, workspace: 'w1',
    profile: { email: 'k@example.com', name: null, workspaces: [{ id: 'w1', name: 'A', slug: 'a', role: 'OWNER' }, { id: 'w2', name: 'B', slug: 'b', role: 'MEMBER' }] },
  }
}

const SIGNED_OUT: AhelAccountView = { status: 'signed-out', attempt: null, reachable: true, workspace: null, profile: null }

function row(id: string, stamp: string | null, options: { blank?: boolean; main?: boolean } = {}): SessionSummary {
  return {
    id, blank: options.blank ?? false, projectionValues: { ahelWorkspace: stamp },
    retainedBy: options.main === true ? { mainView: 1 } : {},
  } as SessionSummary
}

function listOf(rows: readonly SessionSummary[]): SessionListState {
  return { phase: 'ready', ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) } as SessionListState
}

/** One page load of the hosted chat's scope watcher, reading this tab's stash. */
function load(view: AhelAccountView | null, rows: readonly SessionSummary[], follow: FollowState = { kind: 'settled' }) {
  const account = cell<AhelAccountView | null>(view)
  const summary = cell<TeamSummaryState>({ summary: null, outdated: false, error: null })
  const followCell = cell<FollowState>(follow)
  const sessions = cell(listOf(rows))
  const startChat = vi.fn()
  const dispose = watchChatScope({
    account, summary, follow: followCell, sessions, startChat,
    scopeSessions: () => () => {},
    takeDraft: () => takePromptDraft(window),
  })
  return { account, follow: followCell, sessions, startChat, dispose }
}

function visit(path: string): void {
  window.history.replaceState(null, '', path)
}

afterEach(() => {
  sessionStorage.clear()
  visit('/')
})

describe('readPromptParam', () => {
  it('takes the trimmed text and keeps the other parameters and the hash', () => {
    expect(readPromptParam(`https://ahel.ai/chat/?a=1&prompt=${encodeURIComponent(`  ${TASK}\n`)}&b=2#top`))
      .toEqual({ prompt: TASK, stripped: '/chat/?a=1&b=2#top' })
    expect(readPromptParam('https://ahel.ai/chat/?prompt=hi')).toEqual({ prompt: 'hi', stripped: '/chat/' })
  })

  it('strips a blank parameter without text and leaves an address without one alone', () => {
    expect(readPromptParam('https://ahel.ai/chat/?prompt=%20%20&x=1')).toEqual({ prompt: null, stripped: '/chat/?x=1' })
    expect(readPromptParam('https://ahel.ai/chat/?x=1')).toEqual({ prompt: null, stripped: null })
  })

  it('cuts text past the cap, never inside a surrogate pair', () => {
    const at = (text: string) => readPromptParam(`https://ahel.ai/chat/?prompt=${encodeURIComponent(text)}`).prompt
    expect(at('a'.repeat(MAX_PROMPT_DRAFT + 5))).toBe('a'.repeat(MAX_PROMPT_DRAFT))
    expect(at(`${'a'.repeat(MAX_PROMPT_DRAFT - 1)}🧭`)).toBe('a'.repeat(MAX_PROMPT_DRAFT - 1))
    expect(at(`${'a'.repeat(MAX_PROMPT_DRAFT - 2)}🧭b`)).toBe(`${'a'.repeat(MAX_PROMPT_DRAFT - 2)}🧭`)
  })
})

describe('capturePromptDraft', () => {
  it('removes the parameter from the address bar and stashes the text for this tab', () => {
    window.history.replaceState({ keep: true }, '', `/chat/?workspace=w1&prompt=${encodeURIComponent(TASK)}#x`)
    capturePromptDraft(window)
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/chat/?workspace=w1#x')
    expect(window.history.state).toEqual({ keep: true })
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBe(TASK)
  })

  it('keeps the stash on a load without the parameter, and a blank parameter clears it', () => {
    sessionStorage.setItem(PROMPT_DRAFT_KEY, TASK)
    visit('/chat/')
    const replace = vi.spyOn(window.history, 'replaceState')
    capturePromptDraft(window)
    expect(replace).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBe(TASK)
    replace.mockRestore()
    visit('/chat/?prompt=')
    capturePromptDraft(window)
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBeNull()
  })

  it('is taken once', () => {
    sessionStorage.setItem(PROMPT_DRAFT_KEY, TASK)
    expect(takePromptDraft(window)).toBe(TASK)
    expect(takePromptDraft(window)).toBeNull()
  })

  it('drops the text when storage is blocked and still strips the address', () => {
    const blocked = (): never => { throw new DOMException('blocked', 'SecurityError') }
    const replaceState = vi.fn()
    const page = {
      location: { href: `https://ahel.ai/chat/?prompt=${encodeURIComponent(TASK)}` },
      history: { state: null, replaceState },
      sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
    }
    capturePromptDraft(page)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/chat/')
    expect(takePromptDraft(page)).toBeNull()
    // Removal blocked after a read: the text is still used once.
    expect(takePromptDraft({ sessionStorage: { getItem: () => TASK, setItem: blocked, removeItem: blocked } })).toBe(TASK)
  })
})

describe('the prompt text in the hosted chat', () => {
  it('goes into the open blank chat as its draft, once, and is never sent', () => {
    visit(`/chat/?prompt=${encodeURIComponent(TASK)}`)
    capturePromptDraft(window)
    const page = load(signedIn(), [row('draft', null, { blank: true, main: true }), row('a', 'w1')])
    // startSession with no target and no clearPreviousDraft: the blank chat's draft, kept when it holds text.
    expect(page.startChat).toHaveBeenCalledExactlyOnceWith({ prompt: TASK })
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBeNull()
    page.sessions.set(listOf([row('draft', null, { blank: true, main: true }), row('a', 'w1'), row('b', 'w2')]))
    expect(page.startChat).toHaveBeenCalledOnce()
    page.dispose()
  })

  it('opens a new chat for it instead of touching the restored chat', () => {
    sessionStorage.setItem(PROMPT_DRAFT_KEY, TASK)
    const page = load(signedIn(), [row('draft', null, { blank: true }), row('a', 'w1', { main: true })])
    expect(page.startChat).toHaveBeenCalledExactlyOnceWith({ prompt: TASK })
    page.dispose()
  })

  it('rides the one new chat a restored chat outside the workspace gets', () => {
    sessionStorage.setItem(PROMPT_DRAFT_KEY, TASK)
    const page = load(signedIn(), [row('draft', null, { blank: true }), row('b', 'w2', { main: true })])
    expect(page.startChat).toHaveBeenCalledExactlyOnceWith({ prompt: TASK })
    page.dispose()
  })

  it('waits for the follow to settle', () => {
    sessionStorage.setItem(PROMPT_DRAFT_KEY, TASK)
    const page = load(signedIn(), [row('draft', null, { blank: true }), row('legacy', null, { main: true })], { kind: 'moving', to: 'w2' })
    // The chat the follow leaves is replaced without the text.
    expect(page.startChat).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBe(TASK)
    page.follow.set({ kind: 'settled' })
    expect(page.startChat).toHaveBeenLastCalledWith({ prompt: TASK })
    expect(page.startChat).toHaveBeenCalledTimes(2)
    page.dispose()
  })

  it('survives Sign in: kept while signed out, put in the chat on the signed-in load after it', () => {
    visit(`/chat/?prompt=${encodeURIComponent(TASK)}`)
    capturePromptDraft(window)
    const before = load(SIGNED_OUT, [row('draft', null, { blank: true, main: true })])
    expect(before.startChat).not.toHaveBeenCalled()
    before.dispose()
    // Sign in opens /chat/?signin=1, the gateway restarts the Host and the page loads /chat/ again.
    visit('/chat/')
    capturePromptDraft(window)
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBe(TASK)
    const after = load(null, [row('draft', null, { blank: true, main: true })])
    expect(after.startChat).not.toHaveBeenCalled()
    after.account.set(signedIn())
    expect(after.startChat).toHaveBeenCalledExactlyOnceWith({ prompt: TASK })
    expect(sessionStorage.getItem(PROMPT_DRAFT_KEY)).toBeNull()
    after.dispose()
  })

  it('starts nothing without a waiting text', () => {
    const page = load(signedIn(), [row('draft', null, { blank: true, main: true })])
    expect(page.startChat).not.toHaveBeenCalled()
    page.dispose()
  })
})
