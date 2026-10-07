// @vitest-environment jsdom
import { Context } from '@ahel/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@ahel/dsh-client-locale/client'
import { SlotRegistry } from '@ahel/dsh-client-ui-renderer/client'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { BrandHomeLink, WorkspaceRow, type BrandHomeLinkProps, type WorkspaceRowProps } from '../src/client/HostedChat.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en) as WorkspaceRowProps['t']

describe('hosted chat sidebar', () => {
  it('fills the header with the Workspace row and the brand press with the home link', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { 'sidebar.header': { kind: 'list', scope: 'root' }, 'sidebar.brand.link': { kind: 'single', scope: 'root' } },
    } as never, () => null)
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('sidebar.header').map(entry => [entry.options.id, entry.options.order])).toEqual([['hosted-workspace', 10]])
    expect(slots.entries('sidebar.brand.link')).toHaveLength(1)
  })

  it('links the Workspace row to app.ahel.ai in the same tab', () => {
    render(<WorkspaceRow {...({ wide: true, t } as WorkspaceRowProps)} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://app.ahel.ai/app')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).toBe('Workspaceapp.ahel.ai')
  })

  it('wraps the brand identity in the home link', () => {
    render(<BrandHomeLink {...({ className: 'brand', identity: <span>ahel</span>, t } as BrandHomeLinkProps)} />)
    const link = screen.getByRole('link', { name: 'Open your workspace' })
    expect(link.getAttribute('href')).toBe('https://app.ahel.ai/app')
    expect(link.className).toBe('brand')
    expect(link.textContent).toBe('ahel')
  })
})
