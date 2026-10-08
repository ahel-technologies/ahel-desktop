import { expect, it, vi } from 'vitest'
import type { IssueRunReport } from '@ahel/dsh-ahel-account/types'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { runSeed, type Translate } from '../src/client/model.ts'
import { startRun, type RunEntry, type RunHost, type RunSession, type RunWait } from '../src/client/run.ts'
import { RemoteError } from '@ahel/dsh-typert-protocol'
import { createIssuesFeed } from '../src/client/feed.ts'
import { backendOf, ISSUES } from './fixture.client.ts'

const t = makeTranslate(en) as Translate

/** A chat whose running flag, events and pending interaction the test moves. */
function fakeChat() {
  let running = false
  let lastAgentError: string | null = null
  let entries: readonly RunEntry[] = []
  let change: { kind: string; entries?: readonly RunEntry[] } = { kind: 'replace' }
  let waiting: RunWait | null = null
  const sessionListeners = new Set<() => void>()
  const eventListeners = new Set<() => void>()
  const waitListeners = new Set<() => void>()
  const cardListeners = new Set<(sessionId: string, structuredContent: unknown) => void>()
  let pinRefusal: string | null = null
  const send = vi.fn((_text: string) => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const binding: RunSession = {
    session: {
      getSnapshot: () => ({ running, lastAgentError, promptError: null }),
      subscribe: (listener) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
    },
    eventSource: {
      getSnapshot: () => ({ entries, change }),
      subscribe: (listener) => { eventListeners.add(listener); return () => { eventListeners.delete(listener) } },
    },
    send,
  }
  const release = vi.fn()
  const discard = vi.fn()
  const openChat = vi.fn((_reveal: boolean) => Promise.resolve({ sessionId: 'chat-1', binding, release }))
  const pinChat = vi.fn((_sessionId: string, _workspace: string) => Promise.resolve(pinRefusal))
  const host: RunHost = {
    openChat,
    pinChat,
    waiting: () => waiting,
    subscribeWaiting: (listener) => { waitListeners.add(listener); return () => { waitListeners.delete(listener) } },
    subscribeCardCalls: (listener) => { cardListeners.add(listener); return () => { cardListeners.delete(listener) } },
    discard,
  }
  const append = (added: readonly RunEntry[]): void => {
    entries = [...entries, ...added]
    change = { kind: 'append', entries: added }
    for (const l of eventListeners) l()
  }
  return {
    host, send, release, discard, openChat, pinChat,
    refusePin(reason: string) { pinRefusal = reason },
    card(structuredContent: unknown) {
      append([{ event: { type: 'tool/result', data: { meta: { mcpApp: { v: 1, structuredContent } } } } }])
    },
    press(structuredContent: unknown) { for (const l of cardListeners) l('chat-1', structuredContent) },
    setRunning(next: boolean, error: string | null = null) {
      running = next
      lastAgentError = error
      for (const l of sessionListeners) l()
    },
    reply(text: string) { append([{ event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } } }]) },
    toolCall() { append([{ event: { type: 'tool/call' } }]) },
    setWaiting(next: RunWait | null) { waiting = next; for (const l of waitListeners) l() },
  }
}

it('seeds a new chat with the issue and reports running, waiting_approval, running again and finished', async () => {
  const chat = fakeChat()
  const reports: IssueRunReport[] = []
  const issue = ISSUES.find(row => row.key === 'AHEL-137')!
  const summarise = vi.fn()
  const started = await startRun(chat.host, runSeed(issue, t), (report) => { reports.push(report) }, summarise)
  expect(started).toEqual({ ok: true, sessionId: 'chat-1' })

  const seed = chat.send.mock.calls[0]![0]
  expect(seed).toContain('AHEL-137')
  expect(seed).toContain(issue.title)
  expect(seed).toContain('https://ahel.ai/app/issues/AHEL-137')
  expect(seed).toContain('When you are done, summarise what you did and ask for review.')

  chat.setRunning(true)
  chat.toolCall()
  chat.setWaiting('waiting_approval')
  chat.setWaiting(null)
  chat.toolCall()
  chat.reply('Drafted the checklist. Please review.')
  chat.setRunning(false)

  expect(reports.map(report => report.state)).toEqual(['running', 'waiting_approval', 'running', 'finished'])
  expect(reports.at(-1)).toMatchObject({ sessionId: 'chat-1', steps: 2, totalSteps: null })
  expect(summarise).toHaveBeenCalledWith('Drafted the checklist. Please review.', 'chat-1')
  expect(chat.release).toHaveBeenCalledTimes(1)
})

it('a claim ahel.ai answers 409 run_claimed drops the new chat unused: no seed, no local run, the chat archived', async () => {
  const chat = fakeChat()
  const refused = new RemoteError('ahel-issues/refused', 'Session desk-b already has this run.', { status: 409, error: 'run_claimed' })
  const run = vi.fn((_key: string, _report: IssueRunReport, _workspace?: string) => Promise.resolve({ ok: false as const, error: refused }))
  const feed = createIssuesFeed(backendOf({ run }), () => Promise.resolve({ signedIn: true, role: 'OWNER' }))
  const report = vi.fn()
  const started = await startRun(chat.host, runSeed(ISSUES[2]!, t), report, undefined, next => feed.claim('AHEL-137', next, null))
  expect(started).toEqual({ ok: false, reason: 'claimed', message: null })
  expect(run).toHaveBeenCalledWith('AHEL-137', { sessionId: 'chat-1', state: 'running', steps: 0, totalSteps: null }, undefined)
  expect(chat.send).not.toHaveBeenCalled()
  expect(report).not.toHaveBeenCalled()
  expect(chat.release).toHaveBeenCalledTimes(1)
  expect(chat.discard).toHaveBeenCalledWith('chat-1')
  expect(feed.state.getSnapshot().runs).toEqual({})
})

it('a question reports waiting_input, a live run reports again every 5 minutes, and a claimed run opens its chat unshown', async () => {
  vi.useFakeTimers()
  try {
    const chat = fakeChat()
    const reports: IssueRunReport[] = []
    const claim = vi.fn((_report: IssueRunReport) => Promise.resolve(true))
    await startRun(chat.host, runSeed(ISSUES[2]!, t), (report) => { reports.push(report) }, undefined, claim)
    expect(chat.openChat).toHaveBeenCalledWith(false)
    chat.setRunning(true)
    chat.toolCall()
    chat.setWaiting('waiting_input')
    vi.advanceTimersByTime(5 * 60_000)
    expect(reports.map(report => report.state)).toEqual(['waiting_input', 'waiting_input'])
    expect(reports.at(-1)).toMatchObject({ sessionId: 'chat-1', steps: 1 })
    chat.setWaiting(null)
    chat.setRunning(false)
    vi.advanceTimersByTime(5 * 60_000)
    expect(reports.map(report => report.state)).toEqual(['waiting_input', 'waiting_input', 'running', 'finished'])
  } finally {
    vi.useRealTimers()
  }
})

it('pins the chat to the issue\'s workspace before the first message, and fails the run there when it cannot', async () => {
  const chat = fakeChat()
  const claim = vi.fn((_report: IssueRunReport) => Promise.resolve(true))
  await startRun(chat.host, runSeed(ISSUES[2]!, t), vi.fn(), undefined, claim, 'ws-tom')
  expect(chat.pinChat).toHaveBeenCalledWith('chat-1', 'ws-tom')
  expect(chat.pinChat.mock.invocationCallOrder[0]).toBeLessThan(claim.mock.invocationCallOrder[0]!)
  expect(chat.send).toHaveBeenCalledTimes(1)

  const gone = fakeChat()
  gone.refusePin('You no longer have a seat in this workspace, or it was removed.')
  const failedClaim = vi.fn((_report: IssueRunReport) => Promise.resolve(true))
  const started = await startRun(gone.host, runSeed(ISSUES[2]!, t), vi.fn(), undefined, failedClaim, 'ws-gone')
  expect(started).toEqual({ ok: false, reason: 'failed', message: 'You no longer have a seat in this workspace, or it was removed.' })
  expect(failedClaim).toHaveBeenCalledWith({
    sessionId: 'chat-1', state: 'failed', steps: 0, totalSteps: null, reason: 'You no longer have a seat in this workspace, or it was removed.',
  })
  expect(gone.send).not.toHaveBeenCalled()
  expect(gone.discard).toHaveBeenCalledWith('chat-1')
})

it('a turn that ends on a pending confirm card reports waiting_approval until the person presses it', async () => {
  const chat = fakeChat()
  const reports: IssueRunReport[] = []
  const summarise = vi.fn()
  await startRun(chat.host, runSeed(ISSUES[2]!, t), (report) => { reports.push(report) }, summarise)
  chat.setRunning(true)
  chat.toolCall()
  chat.card({ view: 'question', mode: 'confirm', interaction: { id: 'i1', status: 'pending' } })
  chat.reply('Press Comment on issue to post it.')
  chat.setRunning(false)
  expect(reports.map(report => report.state)).toEqual(['running', 'waiting_approval'])
  expect(chat.release).not.toHaveBeenCalled()

  chat.press({ view: 'question', mode: 'confirm', interaction: { id: 'i1', status: 'pending' } })
  expect(reports.map(report => report.state)).toEqual(['running', 'waiting_approval'])
  chat.press({ view: 'execution', result: { ok: true } })
  expect(reports.map(report => report.state)).toEqual(['running', 'waiting_approval', 'finished'])
  expect(summarise).not.toHaveBeenCalled()
  expect(chat.release).toHaveBeenCalledTimes(1)
})

it('a turn that ends on a connector question reports waiting_input; a card already answered lets the run finish', async () => {
  const asked = fakeChat()
  const reports: IssueRunReport[] = []
  await startRun(asked.host, runSeed(ISSUES[2]!, t), (report) => { reports.push(report) })
  asked.setRunning(true)
  asked.card({ view: 'question', interaction: { id: 'q1', status: 'pending' } })
  asked.setRunning(false)
  expect(reports.at(-1)?.state).toBe('waiting_input')
  asked.setRunning(true)
  expect(reports.at(-1)?.state).toBe('running')
  asked.card({ view: 'question', interaction: { id: 'q1', status: 'completed' } })
  asked.setRunning(false)
  expect(reports.at(-1)?.state).toBe('finished')
})
