// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { AhelBrandMark, AhelBrandName, AhelHeroMark } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const SIDEBAR_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark' as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...SIDEBAR_HOLES, HERO_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Ahel browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills the sidebar and hero slots in every build profile', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of [...SIDEBAR_HOLES, HERO_HOLE]) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of SIDEBAR_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of SIDEBAR_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of SIDEBAR_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of [...SIDEBAR_HOLES, HERO_HOLE]) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of [...SIDEBAR_HOLES, HERO_HOLE]) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of [...SIDEBAR_HOLES, HERO_HOLE]) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders the tile at each requested size and the wordmark without the tile', () => {
    const name = render(<AhelBrandName />)
    expect(name.container.querySelector('svg svg')).toBeNull()
    expect(name.container.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
    name.unmount()

    const mark = render(<AhelBrandMark size={34} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    mark.rerender(<AhelBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
    mark.unmount()

    const hero = render(<AhelHeroMark size={34} className="host-mark" />)
    const svg = hero.container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('195 228 157 157')
    expect(svg?.getAttribute('class')).toBe('host-mark')
  })
})
