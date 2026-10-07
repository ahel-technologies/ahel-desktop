import { expect, it, vi } from 'vitest'
import type { Issue, IssueQuery } from '@ahel/dsh-ahel-account/types'
import { createPickup, queuedRunId, shouldClaim } from '../src/client/pickup.ts'
import { ISSUES, PAGE } from './fixture.client.ts'

const queued = (key: string, requestedBy: string): Issue => ({
  ...ISSUES[2]!, key, status: 'todo',
  run: { sessionId: null, state: 'queued', requestedBy, steps: 0, totalSteps: 0, updatedAt: '2026-10-07T09:00:00.000Z' },
})

it('claims a queued agent run only when the signed-in person asked for it and this desktop has not claimed it yet', () => {
  const mine = queued('AHEL-140', 'u1')
  expect(shouldClaim(mine, 'u1', new Set())).toBe(true)
  expect(shouldClaim(queued('AHEL-141', 'u2'), 'u1', new Set())).toBe(false)
  expect(shouldClaim(mine, 'u1', new Set([queuedRunId(mine)]))).toBe(false)
  expect(shouldClaim(ISSUES[2]!, 'u1', new Set())).toBe(false)
})

it('a poll reads the agent\'s issues, re-reads the queued run of mine, starts it once and reports the queued count', async () => {
  const mine = queued('AHEL-140', 'u1')
  const theirs = queued('AHEL-141', 'u2')
  const list = vi.fn((_query: IssueQuery) => Promise.resolve({ ok: true as const, value: { ...PAGE, issues: [...ISSUES, mine, theirs] } }))
  const get = vi.fn((key: string) => Promise.resolve({ ok: true as const, value: { issue: key === mine.key ? mine : theirs } }))
  const claim = vi.fn((_issue: Issue) => Promise.resolve(true))
  const queuedCount = vi.fn()
  const pickup = createPickup({ list, get, me: () => Promise.resolve('u1'), claim, queued: queuedCount })
  await pickup.poll()
  await pickup.poll()
  expect(list).toHaveBeenCalledWith({ assigneeType: 'agent', limit: 100 })
  expect(get).toHaveBeenCalledTimes(1)
  expect(claim).toHaveBeenCalledTimes(1)
  expect(claim).toHaveBeenCalledWith(mine)
  expect(queuedCount).toHaveBeenLastCalledWith(2)
})
