// @vitest-environment jsdom
/**
 * Command palette happy path: an open palette lists the registered groups,
 * a scattered query fuzzy-matches the intended row first, and Enter closes
 * the palette, records the row as recent and runs its action.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@ahel/dsh-client-test-runtime'
import type { ShortcutCatalogEntry } from '@ahel/dsh-client-shortcuts/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import { CommandPalette } from '../src/client/Palette.tsx'
import type { PaletteProps } from '../src/client/Palette.tsx'
import { PaletteRegistry } from '../src/client/registry.ts'
import type { RecentStore } from '../src/client/registry.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

it('fuzzy-matches a row and runs it on Enter', async () => {
  const recent = new Map<string, number>()
  const store: RecentStore = { read: () => recent, touch: (id) => { recent.set(id, Date.now()) } }
  const registry = new PaletteRegistry(store)
  const openApprovals = vi.fn()
  const openChat = vi.fn()
  registry.register({
    id: 'panels', label: () => 'Go to', order: 10,
    items: () => [
      { id: 'panel:ahel-discover', title: 'Discover', run: vi.fn() },
      { id: 'panel:ahel-approvals', title: 'Approvals', run: openApprovals },
    ],
  })
  registry.register({
    id: 'chats', label: () => 'Chats', order: 20,
    items: () => [{ id: 'chat:a', title: 'Quarterly plan for Acme', recency: 2, run: openChat }],
  })
  const noKeys: readonly ShortcutCatalogEntry[] = []
  const catalog: HostObservable<readonly ShortcutCatalogEntry[]> = { getSnapshot: () => noKeys, subscribe: () => () => undefined }
  const props = {
    sections: (query: string) => registry.sections(query, 'Recent'),
    run: (command) => { registry.run(command) },
    close: () => { registry.close() },
    usePalette: bindSnapshotSelector(registry.state),
    useShortcuts: bindSnapshotSelector(catalog),
    t: makeTranslate(en),
  } as PaletteProps
  render(<CommandPalette {...props} />)
  expect(screen.queryByRole('dialog')).toBeNull()

  act(() => { registry.open() })
  expect(screen.getAllByRole('option').map(row => row.textContent)).toEqual(['Discover', 'Approvals', 'Quarterly plan for Acme'])

  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: 'aprv' } })
  expect(screen.getAllByRole('option')[0]?.textContent).toBe('Approvals')

  fireEvent.keyDown(input, { key: 'Enter' })
  await act(async () => { await Promise.resolve() })
  expect(openApprovals).toHaveBeenCalledOnce()
  expect(openChat).not.toHaveBeenCalled()
  expect(registry.state.getSnapshot().open).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()

  // Reopened with an empty query, the row just run leads under Recent.
  act(() => { registry.open() })
  expect(screen.getByText('Recent')).toBeTruthy()
  expect(screen.getAllByRole('option')[0]?.textContent).toBe('Approvals')
})
