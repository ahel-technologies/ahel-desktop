/** The browser half waits for the Ahel account namespaces; the Host half does nothing. */

import { expect, it } from 'vitest'
import { inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'

it('declares its services and ships both dictionaries', () => {
  expect(inject).toEqual(['slots', 'locale', 'remote'])
  expect(NS).toBe('settings.webSearch')
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  expect(en.on).toBe('Ahel Web Search (on)')
  expect(() => { hostApply() }).not.toThrow()
})
