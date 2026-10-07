// @vitest-environment jsdom
/**
 * The plugin body over a minimal fake Client context: Remote Events reach the Desktop
 * bridge (logged by a test double), a click opens the Session, and the Settings row registers.
 */
import type { Context } from '@ahel/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { SETTLE_MS } from '../src/client/watcher.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function fakeContext() {
  const events = new Map<string, (...args: never[]) => void>()
  const clientEvents = new Map<string, (...args: never[]) => void>()
  const disposers: (() => void)[] = []
  const registered: { name: string; id: string }[] = []
  const openSession = vi.fn()
  const statusListeners = new Set<() => void>()
  let pending = new Map<string, { running: boolean; pendingInteraction: unknown; completionUnread: boolean }>()
  const ctx = {
    effect: (body: () => (() => void) | undefined) => { const dispose = body(); if (dispose) disposers.push(dispose) },
    on: (name: string, listener: (...args: never[]) => void) => {
      clientEvents.set(name, listener)
      return () => { clientEvents.delete(name) }
    },
    inject: (_deps: readonly string[], body: (inner: unknown) => void) => { body(ctx) },
    locale: {
      register: () => () => undefined,
      bind: () => (key: keyof typeof en, params: Record<string, string> = {}) =>
        en[key].replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? ''),
      resolveText: (text: { en: string }) => text.en,
    },
    slots: {
      inject: (_name: string, body: () => unknown) => { body() },
      register: (spec: { name: string; id: string }) => { registered.push({ name: spec.name, id: spec.id }); return () => undefined },
    },
    sessions: {
      list: {
        getSnapshot: () => ({
          byId: { s1: { id: 's1', displayTitle: 'Quarterly report', retainedBy: {} } },
          projectionsBySession: { s1: { values: { turnOutline: [{ response: 'Sent to the team.' }] } } },
        }),
      },
    },
    remote: {
      $on: (name: string, listener: (...args: never[]) => void) => { events.set(name, listener); return () => { events.delete(name) } },
    },
    uiSession: {
      sessionStatus: {
        getSnapshot: () => pending,
        subscribe: (listener: () => void) => { statusListeners.add(listener); return () => { statusListeners.delete(listener) } },
      },
    },
    uiWorkspace: { openSession },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
  }
  const emit = (name: string, ...args: unknown[]) => { (events.get(name) as ((...values: unknown[]) => void) | undefined)?.(...args) }
  const fire = (name: string, ...args: unknown[]) => { (clientEvents.get(name) as ((...values: unknown[]) => void) | undefined)?.(...args) }
  const setPending = (next: typeof pending) => { pending = next; for (const listener of statusListeners) listener() }
  const dispose = () => { for (const disposer of disposers) disposer() }
  return { ctx: ctx as unknown as Context, emit, fire, setPending, registered, openSession, dispose }
}

it('posts through the Desktop bridge and opens the Session on click', async () => {
  vi.useFakeTimers()
  const posted: unknown[] = []
  let click: ((target: string) => void) | undefined
  vi.stubGlobal('dshDesktopNotifications', {
    show: async (note: unknown) => { posted.push(note); return true },
    onClick: (listener: (target: string) => void) => { click = listener; return () => undefined },
  })
  // The window is in the background.
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const fake = fakeContext()
  apply(fake.ctx)
  expect(fake.registered).toEqual([{ name: 'settings.general.item', id: 'notifications' }])

  fake.emit('api-session/status', 's1', true)
  fake.emit('api-session/status', 's1', false)
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  expect(posted).toEqual([{ title: 'Quarterly report', body: 'Sent to the team.', target: 's1' }])

  fake.setPending(new Map([['s1', {
    running: true, completionUnread: false,
    pendingInteraction: { kind: 'approval', key: 'approval:1', sessionId: 's1', toolName: 'gmail_send', displayReason: { en: 'Send 3 emails' } },
  }]]))
  expect(posted.at(-1)).toEqual({ title: 'Quarterly report', body: 'Needs your approval: Send 3 emails', target: 's1' })

  click?.('s1')
  expect(fake.openSession).toHaveBeenCalledWith('s1')
  fake.dispose()
})

it('announces a run this desktop picked up from ahel.ai, opening its chat on click', () => {
  const posted: unknown[] = []
  vi.stubGlobal('dshDesktopNotifications', {
    show: async (note: unknown) => { posted.push(note); return true },
    onClick: () => () => undefined,
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const fake = fakeContext()
  apply(fake.ctx)
  fake.fire('ahel-issues/run-started', 'AHEL-140', 'Draft the release notes', 's9')
  expect(posted).toEqual([{ title: 'Run started: AHEL-140 Draft the release notes', body: '', target: 's9' }])
  fake.dispose()
})
