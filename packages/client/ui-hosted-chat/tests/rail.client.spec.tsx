// @vitest-environment jsdom
import { Context } from '@ahel/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LocaleRuntime } from '@ahel/dsh-client-locale/client'
import { SlotRegistry } from '@ahel/dsh-client-ui-renderer/client'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import { apply, inject } from '../src/client/index.ts'
import { HostedRail } from '../src/client/Rail.tsx'
import type { HostedRailProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en) as HostedRailProps['t']

/** A selector hook over one fixed value. */
const hook = <T,>(value: T) => <R,>(selector: (value: T) => R): R => selector(value)

const view: AhelAccountView = {
  status: 'signed-in',
  profile: {
    email: 'karl@example.com', name: 'Karl Hendrik',
    workspaces: [{ id: 'w1', name: 'Ahel', slug: 'ahel', role: 'OWNER' }, { id: 'w2', name: 'Side project', slug: 'side', role: 'MEMBER' }],
  },
  attempt: null, workspace: 'w1', reachable: true,
}

const summary: TeamSummaryState = {
  summary: {
    workspace: { id: 'w1', name: 'Ahel', role: 'OWNER' }, approvals: null, inbox: { unread: 3 }, credits: null,
    apps: { installed: 30 }, at: '2026-10-07T20:00:00Z',
  },
  outdated: false, error: null,
}

function rail(overrides: Partial<HostedRailProps> = {}) {
  const props = {
    wide: true, expandSidebar: vi.fn(), startSession: vi.fn(),
    renderHeader: () => null, renderWorkspaces: () => <div data-testid="chats" />,
    renderFooterActions: () => <div data-testid="account-entry" />, renderSettings: () => null,
    usePanelInfo: hook({ activePanelId: null }), useAccount: hook(view), useSummary: hook(summary),
    useWaitingIssues: hook([]), useTheme: hook('system'), useChatSeat: hook(null),
    selectPanel: vi.fn(), selectWorkspace: vi.fn(async () => {}), signOut: vi.fn(async () => {}), cycleTheme: vi.fn(),
    openIssue: vi.fn(), setChatSeat: vi.fn(), t,
    ...overrides,
  } as HostedRailProps
  render(<HostedRail {...props} />)
  return props
}

describe('hosted chat app rail', () => {
  it('lists the switcher, the seven rows in ahel.ai order and the foot', () => {
    rail()
    expect(screen.getByRole('button', { name: 'Switch workspace: Ahel' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const rows = [...nav.querySelectorAll('a, button')]
    expect(rows.map(row => [row.textContent, row.getAttribute('href')])).toEqual([
      ['Home', 'https://app.ahel.ai/app'],
      ['Chat', null],
      ['Apps', 'https://app.ahel.ai/app/apps'],
      ['Discover', 'https://app.ahel.ai/app/catalog'],
      ['Inbox3', null],
      ['Team', 'https://app.ahel.ai/app/settings/organization'],
      ['Settings', 'https://app.ahel.ai/app/settings'],
    ])
    expect(within(nav).getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'Inbox, 3 unread' })).toBeTruthy()
    const foot = screen.getByRole('group', { name: 'Account and help' })
    expect(within(foot).getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('https://ahel.ai/contact')
    expect(within(foot).getByTestId('account-entry')).toBeTruthy()
    expect(within(foot).getByRole('button', { name: 'Theme: System' })).toBeTruthy()
    expect(within(foot).getByRole('button', { name: 'Log out' })).toBeTruthy()
    expect(screen.queryByText('Workspace')).toBeNull()
  })

  it('switches the workspace and opens in-app panels', () => {
    const props = rail()
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace: Ahel' }))
    fireEvent.click(screen.getByRole('option', { name: 'Side project' }))
    expect(props.selectWorkspace).toHaveBeenCalledWith('w2')
    fireEvent.click(screen.getByRole('button', { name: 'Inbox, 3 unread' }))
    expect(props.selectPanel).toHaveBeenCalledWith('ahel-inbox')
    fireEvent.click(screen.getByRole('button', { name: 'Theme: System' }))
    expect(props.cycleTheme).toHaveBeenCalled()
  })

  it('draws New chat and the Chats list into the chat column seat', () => {
    const seat = document.createElement('div')
    document.body.append(seat)
    const props = rail({ useChatSeat: hook(seat) })
    expect(within(seat).getByTestId('chats')).toBeTruthy()
    fireEvent.click(within(seat).getByRole('button', { name: 'New chat' }))
    expect(props.startSession).toHaveBeenCalled()
    seat.remove()
  })

  it('fills the sidebar body, the chat column and the hero seats', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('layout', { selectPanel: vi.fn() } as never)
    ctx.provide('theme', { getTheme: () => ({ preference: 'system' }), setTheme: vi.fn() } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'sidebar.body': { kind: 'single', scope: 'root' },
        'sidebar.brand.link': { kind: 'single', scope: 'root' },
        'shell.aside': { kind: 'single', scope: 'root' },
        'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
        'conversation.hero.greeting': { kind: 'single', scope: 'root' },
        'conversation.hero.subhead': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    for (const name of ['sidebar.body', 'sidebar.brand.link', 'shell.aside', 'conversation.hero.brand.mark', 'conversation.hero.greeting'] as const) {
      expect(slots.entries(name), name).toHaveLength(1)
    }
    expect(slots.entries('conversation.hero.subhead').map(entry => [entry.options.id, entry.options.priority])).toEqual([['ahel-team', -1]])
  })
})
