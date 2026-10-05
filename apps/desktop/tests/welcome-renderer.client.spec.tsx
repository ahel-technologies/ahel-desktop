// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

afterEach(cleanup)

function mount(language = 'zh-CN') {
  cleanup()
  const api = {
    ...resolveDesktopLocale(language),
    continue: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  const mounted = render(<Welcome api={api} />)
  const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!
  const copy = () => [
    document.title, document.querySelector('img')!.alt, document.getElementById('welcome-heading')!.textContent,
    document.querySelector('#welcome-description')!.textContent,
    ...[...document.querySelectorAll('[role="alert"]')].filter(item => item.closest('[hidden]') === null && !item.hasAttribute('hidden'))
      .map(item => `alert: ${item.textContent}`),
    ...[...document.querySelectorAll('button')].map(item => `${item.textContent}${item.disabled ? ' [disabled]' : ''}`),
    '',
  ].join('\n')
  return { api, button, copy, unmount: mounted.unmount }
}

describe('desktop welcome presentation', () => {
  it.each(['zh-CN', 'en'])('renders the %s entry with Continue focused and sign-in unavailable', async (language) => {
    const view = mount(language)
    expect(document.documentElement.lang).toBe(language)
    expect(document.querySelector('img')!.getAttribute('src')).toBe('assets/welcome-brand.svg')
    expect(document.activeElement).toBe(view.button('#continue'))
    expect(view.button('#sign-in').disabled).toBe(true)
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}.expected.txt`)
  })

  it('continues once while the workspace opens', async () => {
    const view = mount('en')
    const opened = Promise.withResolvers<undefined>()
    view.api.continue.mockReturnValue(opened.promise)
    fireEvent.click(view.button('#continue'))
    fireEvent.click(view.button('#continue'))
    expect(view.api.continue).toHaveBeenCalledOnce()
    expect(view.button('#continue').disabled).toBe(true)
    await act(async () => { opened.resolve(undefined) })
    expect(view.button('#continue').disabled).toBe(false)
  })

  it('shows a retryable failure when the workspace cannot open', async () => {
    const view = mount('en')
    view.api.continue.mockRejectedValueOnce(new Error('closed'))
    await act(async () => { fireEvent.click(view.button('#continue')) })
    expect(document.querySelector('#continue-error')!.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('#continue-error')!.textContent).toBe(view.api.messages.welcomeContinueFailed)
    await act(async () => { fireEvent.click(view.button('#continue')) })
    expect(view.api.continue).toHaveBeenCalledTimes(2)
    expect(document.querySelector('#continue-error')!.hasAttribute('hidden')).toBe(true)
  })
})
