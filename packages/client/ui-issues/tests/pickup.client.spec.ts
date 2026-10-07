import { expect, it, vi } from 'vitest'
import type { Issue, IssuePage, IssueQuery } from '@ahel/dsh-ahel-account/types'
import { createPickup, queuedRunId, shouldClaim, type ClaimOutcome } from '../src/client/pickup.ts'
import { ISSUES, PAGE } from './fixture.client.ts'

const queued = (key: string, requestedBy: string): Issue => ({
  ...ISSUES[2]!, key, status: 'todo',
  run: { sessionId: null, state: 'queued', requestedBy, steps: 0, totalSteps: 0, updatedAt: '2026-10-07T09:00:00.000Z' },
})

function hostOf(page: IssuePage, byKey: Readonly<Record<string, Issue>>) {
  const list = vi.fn((_query: IssueQuery) => Promise.resolve({ ok: true as const, value: page }))
  const get = vi.fn((key: string) => Promise.resolve({ ok: true as const, value: { issue: byKey[key] ?? null } }))
  const me = vi.fn(() => Promise.resolve('u1'))
  const claim = vi.fn((_issue: Issue) => Promise.resolve<ClaimOutcome>('started'))
  return { list, get, me, claim }
}

it('claims a queued agent run only when the signed-in person asked for it and this desktop has not claimed it yet', () => {
  const mine = queued('AHEL-140', 'u1')
  expect(shouldClaim(mine, 'u1', new Set())).toBe(true)
  expect(shouldClaim(mine, null, new Set())).toBe(true)
  expect(shouldClaim(queued('AHEL-141', 'u2'), 'u1', new Set())).toBe(false)
  expect(shouldClaim(mine, 'u1', new Set([queuedRunId(mine)]))).toBe(false)
  expect(shouldClaim(ISSUES[2]!, 'u1', new Set())).toBe(false)
})

it('asks ahel.ai for this person\'s queued runs, re-reads the run and starts it once', async () => {
  const mine = queued('AHEL-140', 'u1')
  const host = hostOf({ ...PAGE, issues: [mine], agentsQueued: 2 }, { [mine.key]: mine })
  const pickup = createPickup(host)
  await pickup.poll()
  await pickup.poll()
  expect(host.list).toHaveBeenCalledWith({ assigneeType: 'agent', runState: 'queued', requestedBy: 'me', limit: 100 })
  expect(host.me).not.toHaveBeenCalled()
  expect(host.get).toHaveBeenCalledTimes(1)
  expect(host.claim).toHaveBeenCalledTimes(1)
  expect(host.claim).toHaveBeenCalledWith(mine)
})

it('an ahel.ai that ignores the run filters answers other states; the pickup then matches the person\'s user id itself', async () => {
  const mine = queued('AHEL-140', 'u1')
  const theirs = queued('AHEL-141', 'u2')
  const host = hostOf({ ...PAGE, issues: [...ISSUES, mine, theirs], agentsQueued: null }, { [mine.key]: mine, [theirs.key]: theirs })
  await createPickup(host).poll()
  expect(host.me).toHaveBeenCalledTimes(1)
  expect(host.claim).toHaveBeenCalledTimes(1)
  expect(host.claim).toHaveBeenCalledWith(mine)
})
