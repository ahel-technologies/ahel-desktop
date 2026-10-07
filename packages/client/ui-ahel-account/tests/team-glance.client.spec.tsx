// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { AhelAccountView, DesktopSummary } from '@ahel/dsh-ahel-account/types'
import { HeroGreeting } from '../src/client/HeroGreeting.tsx'
import type { HeroGreetingProps } from '../src/client/contract.ts'
import { InboxPanelIcon } from '../src/client/catalog/PanelIcons.tsx'
import { HandOffButton, type HandOffButtonProps } from '../src/client/team/ShareHandoff.tsx'
import { TeamHeader, TeamStrip, initials } from '../src/client/team/TeamGlance.tsx'
import type { InboxPanelIconProps, TeamHeaderProps, TeamStripProps, TeamSummaryState } from '../src/client/team/contract.ts'
import team from '../src/client/team/Team.module.css'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

const teamCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/client/team/Team.module.css'), 'utf8')

/**
 * The declaration block of one exact selector.
 * @param css - stylesheet text.
 * @param selector - exact selector text.
 * @returns the block's body, or an empty string when absent.
 */
function ruleOf(css: string, selector: string): string {
  for (const [, head = '', body = ''] of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head.trim() === selector) return body
  }
  return ''
}

afterEach(() => { cleanup() })

const account: AhelAccountView = {
  status: 'signed-in',
  profile: { email: 'karl@ahel.ai', name: 'Karl Soone', workspaces: [{ id: 'w1', name: 'Ahel', slug: 'ahel', role: 'OWNER' }] },
  attempt: null,
  workspace: 'w1',
  reachable: true,
}

const summary: DesktopSummary = {
  workspace: { id: 'w1', name: 'Ahel', role: 'OWNER' },
  approvals: { rows: [] },
  inbox: { unread: 2 },
  credits: null,
  me: { id: 'u1', name: 'Karl Soone', email: 'karl@ahel.ai' },
  members: {
    total: 6,
    rows: [
      { id: 'u1', name: 'Karl Soone', email: 'karl@ahel.ai' },
      { id: 'u2', name: 'Pets', email: 'pets@ahel.ai' },
      { id: 'u3', name: null, email: 'ria@ahel.ai' },
    ],
  },
  apps: { installed: 1 },
  at: '2026-10-07T00:00:00Z',
}

const state: TeamSummaryState = { summary, outdated: false, error: null }

const useAccount: TeamHeaderProps['useAccount'] = select => select(account)
const useSummary: TeamHeaderProps['useSummary'] = select => select(state)

function face() {
  return { openPanel: vi.fn(), openMembers: vi.fn(), useAccount, useSummary, t }
}

describe('team at a glance', () => {
  it('heads the sidebar with the workspace, its faces and the member count, and opens the team settings', () => {
    const props = { ...face(), wide: true } as TeamHeaderProps
    const view = render(<TeamHeader {...props} />)
    expect(screen.getByText('Ahel')).toBeTruthy()
    expect(screen.getByText('6 members')).toBeTruthy()
    expect([...view.container.querySelectorAll('[aria-hidden="true"] > span')].map(item => item.textContent)).toEqual(['KS', 'P', 'R', '+3'])
    fireEvent.click(screen.getByRole('button'))
    expect(props.openMembers).toHaveBeenCalledOnce()
  })

  it('tells same-first-name teammates apart by the first letters of their first two words', () => {
    expect(initials({ id: 'a', name: 'Karl Soone', email: 'karl@ahel.ai' })).toBe('KS')
    expect(initials({ id: 'b', name: 'Karl Hendrik Saar', email: 'kh@ahel.ai' })).toBe('KH')
  })

  it('greets by the live display name the account row shows, not the one stored at sign-in', () => {
    const stored: AhelAccountView = { ...account, profile: { ...account.profile!, name: 'Admin' } }
    const props = {
      greet: (name?: string) => `Hello, ${name ?? 'there'}`,
      useAccount: select => select(stored),
      useSummary,
    } as HeroGreetingProps
    const view = render(<HeroGreeting {...props} />)
    expect(view.container.textContent).toBe('Hello, Karl')
  })

  it('draws the unread count as a trailing pill in the wide sidebar row, positioned by the row', () => {
    const props = { size: 16, active: false, wide: true, useSummary } as unknown as InboxPanelIconProps
    const view = render(<InboxPanelIcon {...props} />)
    const badge = view.getByText('2')
    expect(badge.className).toBe(team.trailingBadge)
    // The wrapper must not be a containing block, or the pill lands on the glyph instead of the row's trailing edge.
    expect(badge.parentElement?.className).toBe(team.glyphWide)
    expect(ruleOf(teamCss, '.glyphWide')).not.toMatch(/\bposition\s*:/)
    expect(ruleOf(teamCss, '.glyph')).toMatch(/position:\s*relative/)
  })

  it('shows quiet tiles on the welcome screen, each opening its panel', () => {
    const props = face() as TeamStripProps
    render(<TeamStrip {...props} />)
    const tiles = screen.getAllByRole('button').map(tile => tile.textContent)
    expect(tiles).toEqual(['KSPR+3Ahel6 members', '0open approvals', '2in your inbox', '1app connected'])
    fireEvent.click(screen.getByText('in your inbox'))
    expect(props.openPanel).toHaveBeenCalledWith('inbox')
  })

  it('hands the open chat off through the share dialog', () => {
    const requestShare = vi.fn()
    const useSession: HandOffButtonProps['useSession'] = select => select({ openState: 'open' } as Parameters<typeof select>[0])
    const props = { sessionId: 's1' as HandOffButtonProps['sessionId'], requestShare, t, useSession } as HandOffButtonProps
    render(<HandOffButton {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    expect(requestShare).toHaveBeenCalledWith('s1', '')
  })
})
