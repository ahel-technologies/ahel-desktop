// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import { AccountMenu } from '../src/client/AccountMenu.tsx'
import type { AccountMenuProps } from '../src/client/contract.ts'
import type { TeamSummaryState } from '../src/client/team/contract.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en) as AccountMenuProps['t']
const hook = <T,>(value: T) => <R,>(selector: (value: T) => R): R => selector(value)
const noSummary: TeamSummaryState = { summary: null, outdated: false, error: null }

function menu(view: AhelAccountView | null): void {
  const props = {
    wide: true, signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}), selectWorkspace: vi.fn(async () => {}),
    openLink: vi.fn(), openPanel: vi.fn(), openBilling: vi.fn(), openModels: vi.fn(),
    useAccount: hook(view), useSummary: hook(noSummary), t,
  } as AccountMenuProps
  render(<AccountMenu {...props} />)
}

describe('account menu before the account answers', () => {
  it('shows a busy placeholder with nothing to press until the first account view', () => {
    menu(null)
    expect(screen.getByRole('status', { name: 'Loading your account' }).getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers Sign in once the account answers signed out', () => {
    menu({ status: 'signed-out', profile: null, attempt: null, workspace: null, reachable: true })
    expect(screen.getByRole('button', { name: 'Sign in with Ahel' })).toBeTruthy()
  })
})
