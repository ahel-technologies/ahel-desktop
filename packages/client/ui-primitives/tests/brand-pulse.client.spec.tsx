// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandPulse } from '../src/BrandPulse.tsx'

afterEach(cleanup)

describe('BrandPulse', () => {
  it('breathes the supplied mark at the requested edge and falls back to a neutral dot', () => {
    const branded = render(<BrandPulse size={16}><svg data-testid="mark" /></BrandPulse>)
    const box = branded.container.firstElementChild as HTMLElement
    expect(box.getAttribute('data-brand-pulse')).toBe('active')
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.style.getPropertyValue('--brand-pulse-size')).toBe('16px')
    expect(branded.getByTestId('mark')).toBeTruthy()
    expect(box.querySelector('[data-brand-pulse-dot]')).toBeNull()
    cleanup()

    const neutral = render(<BrandPulse active={false} />)
    const still = neutral.container.firstElementChild as HTMLElement
    expect(still.getAttribute('data-brand-pulse')).toBe('still')
    expect(still.querySelector('[data-brand-pulse-dot]')).not.toBeNull()
  })
})
