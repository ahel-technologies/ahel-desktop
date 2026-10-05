// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

afterEach(cleanup)

function mount(language = 'zh-CN', notice: 'session-ended' | null = null) {
  cleanup()
  const api = {
    ...resolveDesktopLocale(language),
    notice,
    signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancelSignIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    onSignInState: vi.fn(() => () => {}),
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
  it.each(['zh-CN', 'en'])('renders the %s entry with Sign in with Ahel focused', async (language) => {
    const view = mount(language)
    expect(document.documentElement.lang).toBe(language)
    expect(document.querySelector('img')!.getAttribute('src')).toBe('assets/welcome-brand.svg')
    expect(document.activeElement).toBe(view.button('#sign-in'))
    expect(view.button('#sign-in').disabled).toBe(false)
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}.expected.txt`)
  })

  it('starts the ahel.ai sign-in and offers Cancel while the browser is open', async () => {
    const view = mount('en')
    await act(async () => { fireEvent.click(view.button('#sign-in')) })
    expect(view.api.signIn).toHaveBeenCalledOnce()
    expect(document.querySelector('#sign-in-status')!.textContent).toBe(view.api.messages.welcomeSignInWaiting)
    await act(async () => { fireEvent.click(view.button('#sign-in-cancel')) })
    expect(view.api.cancelSignIn).toHaveBeenCalledOnce()
  })

  it('says the session ended until the next sign-in starts', async () => {
    const view = mount('en', 'session-ended')
    expect(document.querySelector('#sign-in-status')!.textContent).toBe(view.api.messages.welcomeSessionEnded)
    await act(async () => { fireEvent.click(view.button('#sign-in')) })
    expect(document.querySelector('#sign-in-status')!.textContent).toBe(view.api.messages.welcomeSignInWaiting)
  })
})
