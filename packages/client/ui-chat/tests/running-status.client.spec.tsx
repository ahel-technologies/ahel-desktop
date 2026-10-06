// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import { en as commonEn } from '@ahel/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@ahel/dsh-client-locale/src/locales/zh.ts'
import { RunningStatus, runningStepLabel } from '../src/client/chat/RunningStatus.tsx'
import type { ProcessGroupData } from '../src/client/contract/process-groups.ts'
import { en, zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonEn)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(5_000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function statusHarness(startTime?: number) {
  const view = render(<RunningStatus startTime={startTime} step="思考中" t={t} />)
  return {
    ...view,
    content: () => view.container.querySelector('[data-chat-running] > :last-child'),
    set: (nextStartTime?: number) => { view.rerender(<RunningStatus startTime={nextStartTime} step="思考中" t={t} />) },
  }
}

function group(summary: Partial<ProcessGroupData['summary']>, closed = false): ProcessGroupData {
  return { turn: 1, closed, summary: { counts: [], running: undefined, runningDetail: '', ...summary } }
}

describe('RunningStatus', () => {
  it('waits for an open Turn start before allocating its clock', () => {
    const view = statusHarness()
    expect(view.content()?.textContent).toBe('思考中')
    expect(vi.getTimerCount()).toBe(0)
    view.set(1_000)
    expect(view.content()?.textContent).toMatch(/^\d+秒 · 思考中$/)
    expect(view.content()?.querySelector('[data-brand-pulse="active"]')).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    view.set()
    expect(view.content()?.textContent).toBe('思考中')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the indicator mounted while a continuous run moves to the next Turn', () => {
    const view = statusHarness(1_000)
    const content = view.content()
    const status = view.getByRole('status')
    expect(content?.textContent).toBe('4秒 · 思考中')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toBe('6秒 · 思考中')
    view.set(7_000)
    expect(view.content()).toBe(content)
    expect(content?.textContent).toBe('0秒 · 思考中')
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(content?.textContent).toBe('2秒 · 思考中')
    expect(view.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('思考中')
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the duration nonnegative when the start is ahead of the local clock', () => {
    const view = statusHarness(6_000)
    expect(view.content()?.textContent).toBe('0秒 · 思考中')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(view.content()?.textContent).toMatch(/^\d+秒 · 思考中$/)
    expect(view.content()?.textContent).not.toContain('-')
  })

  it('joins elapsed time, settled tokens and the step with middle dots and shows the slotted mark', () => {
    const view = render(<RunningStatus startTime={-7_000} step="Searching the web" tokens={1_234}
      mark={<svg data-testid="mark" />} t={tEn} />)
    expect(view.container.querySelector('[data-chat-running] > :last-child')?.textContent)
      .toBe('12s · 1.2K tokens · Searching the web')
    expect(view.getByTestId('mark').closest('[data-brand-pulse]')).not.toBeNull()
    view.rerender(<RunningStatus startTime={-7_000} step="Thinking" tokens={0} t={tEn} />)
    expect(view.container.querySelector('[data-chat-running] > :last-child')?.textContent).toBe('12s · Thinking')
    expect(view.container.querySelector('[data-brand-pulse-dot]')).not.toBeNull()
  })

  it('names the approval wait over any live step', () => {
    expect(runningStepLabel(group({ running: 'webSearch' }), tEn, true)).toBe('Waiting for your approval')
    expect(runningStepLabel(undefined, t, true)).toBe('等待你的批准')
  })

  it('names the live step from the open process group', () => {
    expect(runningStepLabel(undefined, tEn, false)).toBe('Thinking')
    expect(runningStepLabel(group({ running: 'webSearch', runningDetail: 'ahel pricing' }), tEn, false)).toBe('Searching the web')
    expect(runningStepLabel(group({ running: 'read', runningDetail: '/tmp/uploads/ahel-test.pdf' }), tEn, false))
      .toBe('Reading ahel-test.pdf')
    expect(runningStepLabel(group({ running: 'webFetch', preparing: true }), tEn, false)).toBe('Preparing to visit web pages')
    expect(runningStepLabel(group({ running: 'webSearch' }, true), tEn, false)).toBe('Thinking')
    expect(runningStepLabel(group({ running: 'read', runningDetail: 'C:\\docs\\plan.md' }), t, false)).toBe('正在读取 plan.md')
  })
})
