// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@ahel/dsh-client-store'
import type { ModelSelection } from '@ahel/dsh-api-remotes/client'
import type { ComponentProps } from 'react'
import type { ActiveBilling, ModelBillingState } from '../src/client/billing.ts'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@ahel/dsh-client-locale/src/locales/en.ts'

const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = { efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' }

function directoryState(current: ModelSelection): ModelDirectoryState {
  return {
    current,
    routable: true,
    groups: [{
      id: 'ahel',
      name: 'Ahel',
      models: [
        { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', reasoning },
        { id: 'openai/gpt-5.2', name: 'OpenAI: GPT-5.2' },
        { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: DeepSeek V4.1 Flash' },
      ],
    }, {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
  }
}

function billingState(overrides: Partial<ModelBillingState> = {}): ActiveBilling {
  return {
    provider: 'ahel',
    refreshBalance: vi.fn(),
    state: {
      signedIn: true,
      name: 'ahel',
      models: {
        'anthropic/claude-sonnet-5.5': { shortName: 'Claude Sonnet 5.5', maker: 'Anthropic', bestFor: 'Best for everyday work and writing', typicalMessageCents: 3.3, lastChargeCents: 4.1 },
        'openai/gpt-5.2': { typicalMessageCents: 3.5 },
      },
      defaultModel: 'anthropic/claude-sonnet-5.5',
      balanceCents: 1240,
      frame: null,
      ...overrides,
    },
  }
}

function mount(current: ModelSelection) {
  const directory = createSnapshotStore<ModelDirectoryState>(directoryState(current), { flush: 'sync' })
  const select = vi.fn(async (selection: ModelSelection) => {
    directory.set(directoryState(selection))
    return { ok: true as const, value: undefined }
  })
  const setRemembered = vi.fn()
  render(<ModelSelect
    locked={false}
    available
    directory={directory}
    load={vi.fn()}
    select={select}
    billing={createSnapshotStore<ActiveBilling | null>(billingState(), { flush: 'sync' })}
    session={createSnapshotStore({ running: false }, { flush: 'sync' })}
    remembered={createSnapshotStore<Readonly<Record<string, boolean>>>({}, { flush: 'sync' })}
    sessionKey="s1"
    setRemembered={setRemembered}
    registerOpener={() => () => undefined}
    shortcutKeys={() => ['⌥', '⌘', '/']}
    t={t}
  />)
  return { select, setRemembered }
}

// jsdom has no layout; the picker scrolls the highlighted row into view.
Element.prototype.scrollIntoView = () => undefined

afterEach(cleanup)

describe('model picker rows', () => {
  it('groups by maker with short names, prices and where each row is billed', () => {
    mount({ provider: 'ahel', model: 'anthropic/claude-sonnet-5.5', reasoningEffort: 'medium' })
    const trigger = screen.getByRole('button', { name: 'Select model, current Claude Sonnet 5.5, reasoning effort Medium' })
    expect(trigger.textContent).toBe('Claude Sonnet 5.5')
    fireEvent.click(trigger)

    const groups = screen.getAllByRole('group').filter(group => group.hasAttribute('data-menu-group'))
    expect(groups.map(group => group.querySelector('[data-menu-group-heading]')?.textContent)).toEqual(['Anthropic', 'OpenAI', 'DeepSeek'])
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map(row => row.querySelector('[class*="rowName"]')?.textContent)).toEqual([
      'Claude Sonnet 5.5Default', 'GPT-5.2', 'DeepSeek V4.1 Flash', 'DeepSeek V4 Pro',
    ])
    const sonnet = rows[0]!
    expect(sonnet.getAttribute('aria-checked')).toBe('true')
    expect(sonnet.getAttribute('title')).toBe('About 4.1¢ last time')
    expect(within(sonnet).getByText('3.3¢')).toBeTruthy()
    expect(within(sonnet).getByText('Best for everyday work and writing')).toBeTruthy()
    expect(within(sonnet).getByText('ahel · billed to the workspace')).toBeTruthy()
    expect(within(rows[1]!).getByText('Best for analysis, numbers and code')).toBeTruthy()
    // The metered and own-key DeepSeek V4.1 Flash is one row with a billing switch; the key-only model says "your key".
    expect(within(rows[2]!).getByRole('group', { name: 'Billing for DeepSeek V4.1 Flash' })).toBeTruthy()
    expect(within(rows[3]!).getByText('your key')).toBeTruthy()
    expect(within(rows[3]!).getByText('billed by DeepSeek')).toBeTruthy()

    expect(screen.getByRole('switch', { name: 'Remember for this chat' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Off: this chat follows the workspace default.')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Effort' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Low', 'Medium', 'High'])
    expect(screen.getByText(/Prices include ahel's fee\. Balance \$12\.40\./)).toBeTruthy()
  })

  it('selects a route from the billing switch and remembers a non-default model for the chat', async () => {
    const { select, setRemembered } = mount({ provider: 'ahel', model: 'anthropic/claude-sonnet-5.5' })
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    const row = screen.getAllByRole('menuitemradio')[2]!
    fireEvent.click(within(row).getByRole('button', { name: 'your key' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'deepseek', model: 'deepseek-v4.1-flash' })
      expect(setRemembered).toHaveBeenCalledWith(true)
    })
  })

  it('searches short names and picks the highlighted row with Enter', async () => {
    const { select } = mount({ provider: 'ahel', model: 'anthropic/claude-sonnet-5.5' })
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    fireEvent.change(search, { target: { value: 'gpt' } })
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'ahel', model: 'openai/gpt-5.2' }) })
  })
})
