// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { Issue } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import { HostedAside } from '../src/client/Aside.tsx'
import type { HostedAsideProps } from '../src/client/contract.ts'
import { CHAT_WORKSPACE_COOKIE, mergeWaiting, readCookie, workspaceToFollow } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en) as HostedAsideProps['t']
const hook = <T,>(value: T) => <R,>(selector: (value: T) => R): R => selector(value)

const summary: TeamSummaryState = {
  summary: {
    workspace: { id: 'w1', name: 'Ahel', role: 'OWNER' }, inbox: null, credits: null, at: '2026-10-07T20:00:00Z',
    approvals: { rows: [{ id: 'a1', what: 'stripe.refund', requester: { email: 'jonas@example.com', name: 'Jonas' } } as never] },
  },
  outdated: false, error: null,
}

function issue(key: string, state: 'waiting_input' | 'waiting_approval', updatedAt: string): Issue {
  return { key, title: `Title ${key}`, updatedAt, run: { state, updatedAt } } as Issue
}

function aside(activePanelId: string | null, issues: readonly Issue[] = []) {
  const props = {
    usePanelInfo: hook({ activePanelId }), useSummary: hook(summary), useWaitingIssues: hook(issues),
    setChatSeat: vi.fn(), selectPanel: vi.fn(), openIssue: vi.fn(), t,
  } as HostedAsideProps
  const view = render(<HostedAside {...props} />)
  return { props, column: view.container.querySelector('aside') as HTMLElement }
}

describe('hosted chat column', () => {
  it('shows only while the main panel is the chat', () => {
    expect(aside(null).column.hidden).toBe(false)
    cleanup()
    expect(aside('ahel-inbox').column.hidden).toBe(true)
  })

  it('lists open approvals and waiting runs under Waiting on you', () => {
    const { props } = aside(null, [issue('AHEL-7', 'waiting_input', '2026-10-07T19:00:00Z')])
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Approve: stripe\.refund/ }))
    expect(props.selectPanel).toHaveBeenCalledWith('ahel-approvals')
    fireEvent.click(screen.getByRole('button', { name: /AHEL-7/ }))
    expect(props.openIssue).toHaveBeenCalledWith('AHEL-7')
    expect(screen.getByText('Needs your answer')).toBeTruthy()
  })

  it('merges the waiting states newest first and follows the cookie workspace', () => {
    const merged = mergeWaiting([[issue('A-1', 'waiting_input', '2026-10-07T10:00:00Z')], [issue('A-2', 'waiting_approval', '2026-10-07T11:00:00Z')]])
    expect(merged.map(row => row.key)).toEqual(['A-2', 'A-1'])
    const view = {
      status: 'signed-in', attempt: null, reachable: true, workspace: 'w1',
      profile: { email: 'k@example.com', name: null, workspaces: [{ id: 'w1', name: 'A', slug: 'a', role: 'OWNER' }, { id: 'w2', name: 'B', slug: 'b', role: 'MEMBER' }] },
    } as const
    expect(workspaceToFollow(view, 'w2')).toBe('w2')
    expect(workspaceToFollow(view, 'w1')).toBeNull()
    expect(workspaceToFollow(view, 'elsewhere')).toBeNull()
    expect(workspaceToFollow(view, null)).toBeNull()
    document.cookie = `${CHAT_WORKSPACE_COOKIE}=`
    expect(readCookie(CHAT_WORKSPACE_COOKIE)).toBeNull()
    document.cookie = `${CHAT_WORKSPACE_COOKIE}=w2`
    expect(readCookie(CHAT_WORKSPACE_COOKIE)).toBe('w2')
  })
})
