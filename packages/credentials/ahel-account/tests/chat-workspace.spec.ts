/** The chat workspace stamp: when a step stamps its chat, and the stamp's envelope. */
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@ahel/dsh-session'
import { chatWorkspaceProjection, needsStamp, stampChat } from '../src/chat-workspace.ts'

describe('needsStamp', () => {
  it('stamps a top-level chat with no stamp and no logged prompt, whichever turn takes the step', () => {
    // A first turn rejected or cancelled before its step logged no prompt, so the next turn stamps.
    expect(needsStamp(undefined, null, null)).toBe(true)
  })

  it('leaves stamped chats, chats with prompts from before the stamp existed, and subagents alone', () => {
    expect(needsStamp(undefined, 'w1', null)).toBe(false)
    expect(needsStamp(undefined, null, 1_700_000_000_000)).toBe(false)
    expect(needsStamp('subagent', null, null)).toBe(false)
  })

  it('never stamps while either projection is unregistered', () => {
    expect(needsStamp(undefined, undefined, null)).toBe(false)
    expect(needsStamp(undefined, null, undefined)).toBe(false)
  })
})

describe('stampChat', () => {
  it('appends the stamp marked ignorable, which the projection folds', () => {
    // A build without this event type skips it (storage-contract.spec in session-persistence covers the reader).
    const session = Session.create(SessionId('chat'))
    stampChat(session, 'w2')
    const [event] = session.snapshotEvents()
    expect(event).toMatchObject({ type: 'ahel-account/chat-workspace', data: { workspace: 'w2' }, ignorable: true })
    const fold = chatWorkspaceProjection.apply
    expect(fold(null, event!)).toBe('w2')
  })
})
