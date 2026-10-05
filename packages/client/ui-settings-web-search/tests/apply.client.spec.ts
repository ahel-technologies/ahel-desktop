/** Both halves load without registering anything while no search provider ships. */

import { Context } from '@ahel/cordis'
import { expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

it('loads both halves without services or registrations', async () => {
  expect(inject).toEqual([])
  expect(() => { hostApply() }).not.toThrow()
  const ctx = new Context()
  await ctx.plugin({ inject: [...inject], apply }).await()
  await ctx.fiber.dispose()
})
