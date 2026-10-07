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
  const host: RunHost = {
    openChat,
    waiting: () => waiting,
    subscribeWaiting: (listener) => { waitListeners.add(listener); return () => { waitListeners.delete(listener) } },
    discard,
  }
  const append = (added: readonly RunEntry[]): void => {
    entries = [...entries, ...added]
    change = { kind: 'append', entries: added }
    for (const l of eventListeners) l()
  }
  return {
    host, send, release, discard, openChat,
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
  expect(summarise).toHaveBeenCalledWith('Drafted the checklist. Please review.')
  expect(chat.release).toHaveBeenCalledTimes(1)
})

it('a claim ahel.ai answers 409 run_claimed drops the new chat unused: no seed, no local run, the chat archived', async () => {
  const chat = fakeChat()
  const refused = new RemoteError('ahel-issues/refused', 'Session desk-b already has this run.', { status: 409, error: 'run_claimed' })
  const run = vi.fn((_key: string, _report: IssueRunReport) => Promise.resolve({ ok: false as const, error: refused }))
  const feed = createIssuesFeed(backendOf({ run }), () => Promise.resolve({ signedIn: true, role: 'OWNER' }))
  const report = vi.fn()
  const started = await startRun(chat.host, runSeed(ISSUES[2]!, t), report, undefined, next => feed.claim('AHEL-137', next))
  expect(started).toEqual({ ok: false, reason: 'claimed', message: null })
  expect(run).toHaveBeenCalledWith('AHEL-137', { sessionId: 'chat-1', state: 'running', steps: 0, totalSteps: null })
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
