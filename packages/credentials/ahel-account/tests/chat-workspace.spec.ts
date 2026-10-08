/** The chat workspace stamp: when a step stamps its chat, and the stamp's envelope. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@ahel/cordis'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@ahel/dsh-session'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import { z } from 'zod'
import * as plugin from '../src/chat-workspace.ts'
import { chatWorkspace, chatWorkspaceProjection, needsStamp, pinStamp, stampChat } from '../src/chat-workspace.ts'

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

describe('chatWorkspace', () => {
  it('stamps the selected workspace, else the one the team summary names', async () => {
    const picked = vi.fn(() => Promise.resolve('w-default'))
    await expect(chatWorkspace(() => Promise.resolve('w1'), picked)).resolves.toBe('w1')
    expect(picked).not.toHaveBeenCalled()
    await expect(chatWorkspace(() => Promise.resolve(undefined), picked)).resolves.toBe('w-default')
  })

  it('leaves the chat unstamped when no workspace can be read', async () => {
    await expect(chatWorkspace(() => Promise.resolve(undefined), undefined)).resolves.toBeUndefined()
    await expect(chatWorkspace(() => Promise.resolve(undefined), () => Promise.reject(new Error('signed out')))).resolves.toBeUndefined()
  })

  it('stops waiting for a slow team summary after the limit or when the step aborts', async () => {
    const never = () => new Promise<string>(() => undefined)
    await expect(chatWorkspace(() => Promise.resolve(undefined), never, undefined, 10)).resolves.toBeUndefined()
    const abort = new AbortController()
    const waiting = chatWorkspace(() => Promise.resolve(undefined), never, abort.signal, 60_000)
    abort.abort()
    await expect(waiting).resolves.toBeUndefined()
  })
})

describe('chat binding', () => {
  /** The plugin over a real projection registry and an account whose selection the test moves. */
  async function host() {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    const listMetadata = z.object({ blank: z.boolean(), lastPromptAt: z.union([z.number(), z.null()]) })
    ctx.sessionProjections.register({
      key: 'sessionListMetadata', stateSchema: listMetadata, init: () => ({ blank: true, lastPromptAt: null }), apply: state => state,
      wire: { viewSchema: listMetadata, view: state => state }, stateVersion: 1,
    })
    let selected: string | undefined = 'ws-a'
    const chats = new Map<string, string>()
    const account = {
      workspace: () => Promise.resolve(selected),
      chatWorkspace: (id: string) => chats.get(id),
      bindChat: (id: string, workspace: string) => { chats.set(id, workspace) },
    }
    ctx.provide('ahelAccount', account as never)
    await ctx.plugin(plugin)
    const step = (session: Session) => ctx.waterfall('agent/pre-step', {
      agent: { session } as never, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'continue' } as never))
    const toolWorkspace = (session: Session) => ctx.bail('mcp-client/workspace', 'ahel', { session } as never)
    return { ctx, account, step, toolWorkspace, select: (id: string | undefined) => { selected = id } }
  }

  it('keeps a chat stamped with workspace A on A after the selection moves to B; a new chat then acts in B', async () => {
    const { account, step, toolWorkspace, select } = await host()
    const first = Session.create(SessionId('chat-a'))
    await step(first)
    expect(toolWorkspace(first)).toBe('ws-a')

    select('ws-b')
    await step(first)
    expect(toolWorkspace(first)).toBe('ws-a')
    expect(account.chatWorkspace('chat-a')).toBe('ws-a')

    const second = Session.create(SessionId('chat-b'))
    await step(second)
    expect(toolWorkspace(second)).toBe('ws-b')
    expect(account.chatWorkspace('chat-b')).toBe('ws-b')
    // A card press on the first chat after a Host restart, before any step: read from the stamp.
    expect(toolWorkspace(Session.create(SessionId('chat-a'), first.snapshotEvents()))).toBe('ws-a')
  })

  it('binds a subagent to its parent chat and leaves an unstamped chat to the selection', async () => {
    const { step, toolWorkspace, select } = await host()
    const parent = Session.create(SessionId('chat-p'))
    await step(parent)
    select('ws-b')
    const child = Session.create(SessionId('child'), [], {
      version: SESSION_FORMAT_VERSION, id: SessionId('child'), createdAt: 0, isSeeded: false, origin: 'subagent', parentSession: SessionId('chat-p'),
    })
    await step(child)
    expect(toolWorkspace(child)).toBe('ws-a')
    expect(toolWorkspace(Session.create(SessionId('unstamped')))).toBeUndefined()
  })

  it('pins a chat that took no step yet, and refuses a chat stamped with another workspace', async () => {
    const { ctx } = await host()
    const fresh = Session.create(SessionId('run'))
    expect(pinStamp(ctx.sessionProjections, fresh, 'ws-issue')).toBe(true)
    expect(pinStamp(ctx.sessionProjections, fresh, 'ws-issue')).toBe(true)
    expect(pinStamp(ctx.sessionProjections, fresh, 'ws-other')).toBe(false)
  })
})
