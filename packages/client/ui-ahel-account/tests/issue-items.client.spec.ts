import { expect, it, vi } from 'vitest'
import type { HandoffList, HandoffReceivedRow, IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import { inboxEntries, inboxUnread, ISSUE_KIND_COPY, openIssueItem } from '../src/client/team/issue-items.ts'
import { en } from '../src/client/locales.ts'

it('an unread issue row shows the issue in the desktop, marks itself read and refreshes the badge', async () => {
  const item: IssueInboxItem = {
    id: 'n1', type: 'assigned', issueKey: 'AHEL-137', issueTitle: 'Write the onboarding checklist', actorType: 'member',
    actorName: 'Karl', body: null, unread: true, createdAt: '2026-10-06T08:00:00.000Z',
  }
  const show = vi.fn()
  const markRead = vi.fn((_id: string) => Promise.resolve({ ok: true as const, value: 1 }))
  const refresh = vi.fn()
  expect(await openIssueItem({ show, markRead, refresh }, item)).toEqual({ ok: true })
  expect(show).toHaveBeenCalledWith('AHEL-137')
  expect(markRead).toHaveBeenCalledWith('n1')
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('merges handoffs and issue updates into one list: newest day first, unread first within a day, then newest', () => {
  const issue = (id: string, createdAt: string, unread: boolean): IssueInboxItem => ({
    id, type: 'mentioned', issueKey: 'DEMO-3', issueTitle: 'Connect HubSpot', actorType: 'member', actorName: 'Priya', body: null, unread, createdAt,
  })
  const handoff = (id: string, updatedAt: string, unread: boolean) =>
    ({ id, title: 'Q4 pricing', version: 1, status: 'open', unread, updatedAt }) as HandoffReceivedRow
  const entries = inboxEntries(
    [handoff('h-old', '2026-10-05T09:00:00', true), handoff('h-today-read', '2026-10-07T11:00:00', false)],
    [issue('i-today-unread', '2026-10-07T08:00:00', true), issue('i-yesterday', '2026-10-06T20:00:00', false)],
  )
  expect(entries.map(entry => entry.id)).toEqual(['issue:i-today-unread', 'handoff:h-today-read', 'issue:i-yesterday', 'handoff:h-old'])
  expect(entries.map(entry => entry.kind)).toEqual(['issue', 'handoff', 'issue', 'handoff'])
})

it('a run_queued row reads "Run queued" and names who asked for the run', () => {
  const copy = ISSUE_KIND_COPY.run_queued
  expect(en[copy.label]).toBe('Run queued')
  expect(en[copy.sentence].replace('{actor}', 'Kaarna')).toBe('Kaarna asked Ahel to run it')
})

it('a run_waiting_input row reads "Needs your answer"', () => {
  const copy = ISSUE_KIND_COPY.run_waiting_input
  expect(en[copy.label]).toBe('Needs your answer')
  expect(en[copy.sentence].replace('{actor}', 'Ahel')).toBe('Ahel needs your answer to go on')
})

it('the Inbox badge counts the unread rows the list shows: unread handoffs not done and unread issue rows', () => {
  const handoff = (id: string, unread: boolean, status: string) =>
    ({ id, title: 'Q4 pricing', version: 1, status, unread, updatedAt: '2026-10-07T09:00:00' }) as HandoffReceivedRow
  const issue = (id: string, unread: boolean): IssueInboxItem => ({
    id, type: 'run_finished', issueKey: 'DEMO-9', issueTitle: 'Draft the launch post', actorType: 'agent', actorName: 'Ahel', body: null, unread,
    createdAt: '2026-10-07T10:00:00',
  })
  const list = {
    view: 'handoff_list', scope: 'all', sent: [], detail: '',
    received: [handoff('h-unread', true, 'open'), handoff('h-done', true, 'done'), handoff('h-read', false, 'open')],
    items: [issue('i-unread', true), issue('i-unread-2', true), issue('i-read', false)],
  } satisfies HandoffList
  expect(inboxUnread(list)).toBe(3)
  const shown = inboxEntries(list.received, list.items).filter(entry => entry.unread).map(entry => entry.id)
  expect(shown).toEqual(['issue:i-unread', 'issue:i-unread-2', 'handoff:h-unread'])
  expect(inboxUnread({ ...list, items: null })).toBe(1)
  expect(inboxUnread({ ...list, unreadItems: 60 })).toBe(61)
})
