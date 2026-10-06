import { expect, it, vi } from 'vitest'
import type { IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import { openIssueItem } from '../src/client/team/issue-items.ts'

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
