// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { IssuePatch } from '@ahel/dsh-ahel-account/types'
import type { IssuesInjected, IssuesPanelIconProps } from '../src/client/contract.ts'
import { createIssuesFeed } from '../src/client/feed.ts'
import { IssuesPage } from '../src/client/IssuesPage.tsx'
import css from '../src/client/Issues.module.css'
import { IssuesPanelIcon } from '../src/client/PanelIcons.tsx'
import { en } from '../src/client/locales.ts'
import { backendOf, PAGE } from './fixture.client.ts'

afterEach(cleanup)

const t = makeTranslate(en) as Parameters<typeof IssuesPage>[0]['t']

function ok<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

async function mount() {
  const update = vi.fn((key: string, patch: IssuePatch) => {
    const issue = PAGE.issues.find(row => row.key === key)!
    return ok({ issue: { ...issue, status: patch.status ?? issue.status } })
  })
  const backend = backendOf({
    list: vi.fn(() => ok(PAGE)),
    projects: vi.fn(() => ok([{ id: 'p1', name: 'Website' }])),
    assignees: vi.fn(() => ok({ members: [{ id: 'u2', name: 'Kaarna Pets', avatar: 'KP' }], agents: [{ id: 'ahel', name: 'Ahel', avatar: null, model: 'Claude Sonnet' }] })),
    update,
  })
  const feed = createIssuesFeed(backend, () => Promise.resolve({ signedIn: true, role: 'OWNER' }))
  await feed.reload()
  const face: Omit<IssuesInjected, 'hooks'> = {
    ...feed, run: vi.fn(), openSession: vi.fn(), openLink: vi.fn(), viewOnWeb: vi.fn(), refresh: () => undefined,
  }
  const useIssues = ((selector: (state: ReturnType<typeof feed.state.getSnapshot>) => unknown) => {
    return useSyncExternalStore(listener => feed.state.subscribe(listener), () => selector(feed.state.getSnapshot()))
  }) as Parameters<typeof IssuesPage>[0]['useIssues']
  render(<IssuesPage {...face} useIssues={useIssues} t={t} />)
  return { update, feed }
}

it('renders the board from the fixture: six columns with counts, cards with key, project, assignee and run, the model left to the detail', async () => {
  await mount()
  const board = screen.getByRole('region', { name: 'Issues board' })
  const columns = within(board).getAllByRole('region')
  expect(columns.map(column => column.getAttribute('aria-label'))).toEqual(['Backlog', 'Todo', 'In Progress', 'In Review', 'Blocked', 'Done'])
  const progress = within(board).getByRole('region', { name: 'In Progress' })
  expect(within(progress).getByText('AHEL-137')).toBeTruthy()
  expect(within(progress).getByText('Website')).toBeTruthy()
  expect(within(progress).getByText('4/9')).toBeTruthy()
  expect(within(progress).getByText('ahel')).toBeTruthy()
  expect(within(board).queryByText('Claude Sonnet')).toBeNull()
  expect(within(board).getByText('Waiting for approval')).toBeTruthy()
  expect(screen.getByText('2 agents working')).toBeTruthy()
})

it('the detail shows the agent\'s model under the assignee and a parent example in the workspace\'s prefix', async () => {
  await mount()
  await act(async () => { fireEvent.click(screen.getByText('AHEL-137')) })
  expect(screen.getByText('Runs on Claude Sonnet')).toBeTruthy()
  expect(screen.getByPlaceholderText('AHEL-1')).toBeTruthy()
})

it('dropping a card on another column patches its status and moves it at once', async () => {
  const { update } = await mount()
  const board = screen.getByRole('region', { name: 'Issues board' })
  const review = within(board).getByRole('region', { name: 'In Review' })
  const data = new Map<string, string>([['application/x-ahel-issue', 'AHEL-134'], ['text/plain', 'AHEL-134']])
  const dataTransfer = { types: [...data.keys()], getData: (type: string) => data.get(type) ?? '', setData: () => undefined, dropEffect: 'move' }
  await act(async () => {
    fireEvent.dragOver(review, { dataTransfer })
    fireEvent.drop(review, { dataTransfer })
  })
  expect(update).toHaveBeenCalledWith('AHEL-134', { status: 'in_review' })
  expect(within(review).getByText('AHEL-134')).toBeTruthy()
})

it('draws the open-issue count as a trailing pill in the wide sidebar row and on the glyph corner in the rail', () => {
  const useIssues = ((selector: (state: { mine: number }) => unknown) => selector({ mine: 3 })) as IssuesPanelIconProps['useIssues']
  const wide = render(<IssuesPanelIcon {...{ size: 16, active: false, wide: true, useIssues } as unknown as IssuesPanelIconProps} />)
  const pill = within(wide.container).getByText('3')
  expect(pill.className).toBe(css.trailingBadge)
  expect(pill.parentElement?.className).toBe(css.glyphWide)
  wide.unmount()
  const rail = render(<IssuesPanelIcon {...{ size: 18, active: false, useIssues } as unknown as IssuesPanelIconProps} />)
  expect(within(rail.container).getByText('3').className).toBe(css.badge)
})
