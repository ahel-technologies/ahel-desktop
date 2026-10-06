import { describe, expect, it } from 'vitest'
import { heroGreeting } from '../src/client/skeleton/hero-greeting.ts'

describe('heroGreeting', () => {
  it('greets by part of the day, with and without a name', () => {
    expect(heroGreeting({ hour: 8, name: 'Karl', seed: 1 })).toBe('Good morning, Karl')
    expect(heroGreeting({ hour: 14, seed: 1 })).toBe('Good afternoon')
    expect(heroGreeting({ hour: 20, name: 'Karl', seed: 1 })).toBe('Good evening, Karl')
    expect(heroGreeting({ hour: 23, name: 'Karl', seed: 0 })).toBe('Late night, Karl?')
    expect(heroGreeting({ hour: 2, name: 'Karl', seed: 1 })).toBe('Still up, Karl?')
    expect(heroGreeting({ hour: 4, seed: 2 })).toBe('Moonlit chat?')
  })
})
