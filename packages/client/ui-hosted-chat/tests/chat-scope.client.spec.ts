import { describe, expect, it } from 'vitest'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import { chatScope, inChatScope } from '../src/client/index.ts'

function signedIn(workspace: string | null): AhelAccountView {
  return {
    status: 'signed-in', attempt: null, reachable: true, workspace,
    profile: { email: 'k@example.com', name: null, workspaces: [{ id: 'w1', name: 'A', slug: 'a', role: 'OWNER' }, { id: 'w2', name: 'B', slug: 'b', role: 'MEMBER' }] },
  }
}

const chat = (ahelWorkspace?: string | null, blank = false) => ({
  blank, ...ahelWorkspace === undefined ? {} : { projectionValues: { ahelWorkspace } },
})

describe('hosted Chats list scope', () => {
  it('lists every chat while signed out', () => {
    expect(chatScope(null, null)).toBeNull()
    expect(chatScope({ ...signedIn(null), status: 'signed-out', profile: null }, null)).toBeNull()
  })

  it('shows chats stamped with the selected workspace and the New chat draft', () => {
    const scope = chatScope(signedIn('w2'), 'w2')!
    expect(scope).toEqual({ current: 'w2', home: 'w1' })
    expect(inChatScope(chat('w2'), scope)).toBe(true)
    expect(inChatScope(chat('w1'), scope)).toBe(false)
    expect(inChatScope(chat('w1', true), scope)).toBe(true)
    expect(inChatScope({ ...chat(), origin: 'subagent' }, scope)).toBe(true)
  })

  it('lists unstamped chats under the default workspace only', () => {
    const second = chatScope(signedIn('w2'), null)!
    expect(inChatScope(chat(), second)).toBe(false)
    expect(inChatScope(chat(null), second)).toBe(false)
    const first = chatScope(signedIn('w1'), null)!
    expect(inChatScope(chat(), first)).toBe(true)
    // With no workspace selected, the one ahel.ai picked is the default.
    const picked = chatScope(signedIn(null), 'w2')!
    expect(picked).toEqual({ current: 'w2', home: 'w2' })
    expect(inChatScope(chat(), picked)).toBe(true)
    expect(inChatScope(chat('w1'), picked)).toBe(false)
  })
})
