/**
 * One happy path per unit over fake sinks: the watchers decide, the fakes record
 * what would reach the operating system.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@ahel/dsh-session/types'
import { InboxNotifications, INBOX_POLL_MS, INBOX_TARGET, type InboxRow } from '../src/client/inbox.ts'
import { desktopNotifier, type DesktopNotificationsBridge } from '../src/client/notifier.ts'
import { inboxReader, lastResponse, waitOf } from '../src/client/reading.ts'
import { SessionNotifications, SETTLE_MS, type PendingWait, type SystemNotification } from '../src/client/watcher.ts'

const A = 'session-a' as SessionId

describe('SessionNotifications', () => {
  it('a reply is ready, then an approval card waits', () => {
    const shown: SystemNotification[] = []
    const timers: (() => void)[] = []
    const watcher = new SessionNotifications({
      post: (note) => { shown.push(note) },
      copy: {
        replyReady: () => 'Reply ready',
        failed: reason => `Stopped: ${reason}`,
        approval: summary => `Needs your approval: ${summary}`,
        question: question => `Needs your answer: ${question}`,
      },
      notifiable: () => true,
      title: () => 'Quarterly report',
      finalResponse: () => 'The report is in your Drive.',
      schedule: (run, ms) => { expect(ms).toBe(SETTLE_MS); timers.push(run); return () => undefined },
    })
    watcher.status(A, true)
    watcher.status(A, false)
    for (const run of timers.splice(0)) run()
    const wait = new Map<SessionId, PendingWait>([[A, { key: 'approval:1', kind: 'approval', text: 'Send 3 emails' }]])
    watcher.pending(wait)
    watcher.pending(wait)
    expect(shown).toEqual([
      { title: 'Quarterly report', body: 'The report is in your Drive.', target: A },
      { title: 'Quarterly report', body: 'Needs your approval: Send 3 emails', target: A },
    ])
  })
})

describe('InboxNotifications', () => {
  it('seeds on blur, then notifies each new unread handoff', async () => {
    const shown: SystemNotification[] = []
    let rows: InboxRow[] = [{ id: 'h1', title: 'Old one', from: 'Pets', unread: true }]
    let tick: (() => void) | undefined
    const inbox = new InboxNotifications({
      read: async () => rows,
      handoff: from => `${from} handed you a chat`,
      post: (note) => { shown.push(note) },
      every: (run, ms) => { expect(ms).toBe(INBOX_POLL_MS); tick = run; return () => { tick = undefined } },
    })
    inbox.background()
    await Promise.resolve()
    rows = [...rows, { id: 'h2', title: 'Vendor contract', from: 'Kaarna', unread: true }]
    tick?.()
    await vi.waitFor(() => { expect(shown).toHaveLength(1) })
    expect(shown[0]).toEqual({ title: 'Kaarna handed you a chat', body: 'Vendor contract', target: INBOX_TARGET })
    inbox.foreground()
    expect(tick).toBeUndefined()
  })
})

describe('Client reads', () => {
  it('summarizes waits, the newest turn preview, the Inbox and the Desktop bridge', async () => {
    const approval = { kind: 'approval', key: 'approval:7', sessionId: A, toolName: 'gmail_send', displayReason: { en: 'Send 3 emails' } }
    expect(waitOf(approval as never, text => text.en)).toEqual({ key: 'approval:7', kind: 'approval', text: 'Send 3 emails' })
    expect(lastResponse({ turnOutline: [{ response: 'old' }, { response: 'new' }] })).toBe('new')

    const read = inboxReader({ ahelTeam: { inbox: async () => ({ ok: true, value: { received: [{ id: 'h1', title: 'T', from: 'Pets', unread: true }] } }) } })
    expect(await read?.()).toEqual([{ id: 'h1', title: 'T', from: 'Pets', unread: true }])
    expect(inboxReader({})).toBeUndefined()

    const show = vi.fn(async () => true)
    const bridge: DesktopNotificationsBridge = { show, onClick: (listener) => { listener(A); return () => undefined } }
    const clicked: string[] = []
    const notifier = desktopNotifier(bridge)
    notifier.onClick((target) => { clicked.push(target) })
    notifier.show({ title: 'Quarterly report', body: 'Reply ready', target: A })
    expect(show).toHaveBeenCalledWith({ title: 'Quarterly report', body: 'Reply ready', target: A })
    expect(clicked).toEqual([A])
  })
})
