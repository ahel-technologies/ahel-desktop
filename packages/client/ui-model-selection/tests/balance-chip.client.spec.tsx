// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@ahel/dsh-client-store'
import type { ComponentProps } from 'react'
import { balanceChip, type ActiveBilling, type ModelBillingFrame, type ModelBillingState } from '../src/client/billing.ts'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en } from '../src/client/locales.ts'

const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function billing(state: Partial<ModelBillingState> = {}, refreshBalance = vi.fn()): ActiveBilling {
  return {
    provider: 'ahel',
    refreshBalance,
    state: { signedIn: true, name: 'ahel', models: {}, defaultModel: null, balanceCents: 1240, frame: null, ...state },
  }
}

const settled: ModelBillingFrame = { phase: 'settled', sessionId: 's1', heldCents: 0, chargedCents: 3, balanceCents: 1237 }

afterEach(cleanup)

describe('balance chip', () => {
  it('derives hidden, your key, held and balance', () => {
    expect(balanceChip(null, 'ahel', false, null)).toEqual({ kind: 'hidden' })
    expect(balanceChip(billing({ signedIn: false }), 'ahel', false, null)).toEqual({ kind: 'hidden' })
    expect(balanceChip(billing(), 'deepseek', true, null)).toEqual({ kind: 'key' })
    expect(balanceChip(billing(), 'ahel', false, null)).toEqual({ kind: 'balance', cents: 1240 })
    expect(balanceChip(billing(), 'ahel', true, null)).toEqual({ kind: 'held', heldCents: null })
    expect(balanceChip(billing(), 'ahel', true, { ...settled, phase: 'held', heldCents: 25, chargedCents: null, balanceCents: 1240 }))
      .toEqual({ kind: 'held', heldCents: 25 })
    // A settle whose provider cost is not known yet still holds money.
    expect(balanceChip(billing(), 'ahel', true, { ...settled, heldCents: 10 })).toEqual({ kind: 'held', heldCents: 10 })
    expect(balanceChip(billing(), 'ahel', true, settled)).toEqual({ kind: 'balance', cents: 1237 })
  })

  it('reads held from send until the settle, then the new balance; re-reads the balance after a turn without one', () => {
    const refresh = vi.fn()
    const source = createSnapshotStore<ActiveBilling | null>(billing({}, refresh), { flush: 'sync' })
    const session = createSnapshotStore({ running: false }, { flush: 'sync' })
    const directory = createSnapshotStore<ModelDirectoryState>({
      current: { provider: 'ahel', model: 'anthropic/claude-sonnet-5.5' },
      routable: true,
      groups: [{ id: 'ahel', name: 'Ahel', models: [{ id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' }] }],
      failures: [], status: 'ready', pending: null, error: null,
    }, { flush: 'sync' })
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={vi.fn()} billing={source} session={session}
      remembered={createSnapshotStore({}, { flush: 'sync' })} sessionKey="s1" setRemembered={vi.fn()} registerOpener={() => () => undefined}
      shortcutKeys={() => []} t={t} />)
    expect(screen.getByRole('status').textContent).toBe('$12.40')

    act(() => { session.set({ running: true }) })
    expect(screen.getByRole('status').textContent).toBe('held')
    act(() => { source.set(billing({ balanceCents: 1237, frame: settled }, refresh)) })
    expect(screen.getByRole('status').textContent).toBe('$12.37')
    act(() => { session.set({ running: false }) })
    expect(refresh).not.toHaveBeenCalled()

    act(() => { session.set({ running: true }) })
    expect(screen.getByRole('status').textContent).toBe('held')
    act(() => { session.set({ running: false }) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('$12.37')
  })
})
