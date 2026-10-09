// @vitest-environment jsdom
/** The ahel.ai account theme cookie: parsing, the write string, and the chat's theme following it. */
import { Context } from '@ahel/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@ahel/dsh-client-test-runtime'
import { ThemeRuntime, type ThemeSettings } from '@ahel/dsh-client-ui-theme/client'
import { accountThemeCookie, readAccountTheme } from '../src/account-theme.ts'
import { followAccountTheme } from '../src/client/account-theme.ts'

/** The cookie strings the page wrote, in order. */
let written: string[] = []
/** What `document.cookie` reads as. */
let jar = ''

function stubCookies(initial: string): void {
  jar = initial
  written = []
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => jar)
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => { written.push(value) })
}

/** A theme service as the hosted chat sees it: memory-only settings, seeded from the boot attribute. */
function mount(): { ctx: Context; theme: ThemeRuntime; dispose: () => void } {
  const ctx = new Context()
  const theme = new ThemeRuntime(ctx, stubConfigForm<ThemeSettings>().scope)
  ctx.provide('theme', theme)
  return { ctx, theme, dispose: followAccountTheme(ctx) }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.dsThemeSource
})

describe('readAccountTheme', () => {
  it.each([
    ['ahel.theme=light', 'light'],
    ['a=1; ahel.theme=dark', 'dark'],
    ['ahel.theme=system; b=2', 'system'],
    ['ahel.theme=sepia; ahel.theme=dark', 'dark'],
    ['ahel.theme=light; ahel.theme=dark', 'light'],
  ] as const)('reads %j as %s', (cookies, preference) => {
    expect(readAccountTheme(cookies)).toBe(preference)
  })

  it.each(['', 'ahel.theme=', 'ahel.theme=Light', 'xahel.theme=light', 'ahel.theme=lightish', 'ahel_theme=dark'])('reads %j as none', (cookies) => {
    expect(readAccountTheme(cookies)).toBeNull()
  })
})

describe('accountThemeCookie', () => {
  it('shares the cookie across ahel.ai over https', () => {
    expect(accountThemeCookie('light', { hostname: 'ahel.ai', protocol: 'https:' }))
      .toBe('ahel.theme=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure; Domain=.ahel.ai')
    expect(accountThemeCookie('dark', { hostname: 'App.Ahel.AI', protocol: 'https:' }))
      .toBe('ahel.theme=dark; Max-Age=31536000; Path=/; SameSite=Lax; Secure; Domain=.ahel.ai')
  })

  it('keeps the cookie host-only elsewhere and drops Secure over http', () => {
    expect(accountThemeCookie('system', { hostname: 'localhost', protocol: 'http:' }))
      .toBe('ahel.theme=system; Max-Age=31536000; Path=/; SameSite=Lax')
    expect(accountThemeCookie('light', { hostname: 'notahel.ai', protocol: 'https:' }))
      .toBe('ahel.theme=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure')
  })
})

describe('followAccountTheme', () => {
  it('starts from the boot-row preference without writing the cookie back', () => {
    stubCookies('ahel.theme=light')
    document.documentElement.dataset.dsThemeSource = 'light'
    const { theme, dispose } = mount()
    expect(theme.getTheme().preference).toBe('light')
    expect(written).toEqual([])
    dispose()
  })

  it('adopts the cookie on load when no boot row ran', () => {
    stubCookies('ahel.theme=dark')
    const { theme, dispose } = mount()
    expect(theme.getTheme().preference).toBe('dark')
    expect(written).toEqual([])
    dispose()
  })

  it('keeps the chat preference when the page has no account theme', () => {
    stubCookies('ahel_chat_workspace=w1')
    const { theme, dispose } = mount()
    expect(theme.getTheme().preference).toBe('system')
    expect(written).toEqual([])
    dispose()
  })

  it('writes a change made in the chat to the cookie and localStorage', () => {
    stubCookies('ahel.theme=light')
    const { theme, dispose } = mount()
    theme.setTheme('dark')
    // jsdom serves http://localhost: no Domain, no Secure.
    expect(written).toEqual(['ahel.theme=dark; Max-Age=31536000; Path=/; SameSite=Lax'])
    expect(localStorage.getItem('ahel.theme')).toBe('dark')
    dispose()
    theme.setTheme('system')
    expect(written).toHaveLength(1)
  })

  it('keeps a registered theme id chat-local', () => {
    stubCookies('')
    const { theme, dispose } = mount()
    theme.register({ id: 'sepia', colorScheme: 'light', tokens: {} })
    theme.setTheme('sepia')
    expect(written).toEqual([])
    dispose()
  })

  it('follows a change made on ahel.ai when the chat regains focus, without echoing it', () => {
    stubCookies('ahel.theme=light')
    const { theme, dispose } = mount()
    jar = 'ahel.theme=dark'
    window.dispatchEvent(new Event('focus'))
    expect(theme.getTheme().preference).toBe('dark')
    jar = 'ahel.theme=system'
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(theme.getTheme().preference).toBe('dark')
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(theme.getTheme().preference).toBe('system')
    expect(written).toEqual([])
    dispose()
    jar = 'ahel.theme=light'
    window.dispatchEvent(new Event('focus'))
    expect(theme.getTheme().preference).toBe('system')
  })

  it('treats refused cookie access as no account theme and tolerates blocked storage', () => {
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    const { theme, dispose } = mount()
    expect(theme.getTheme().preference).toBe('system')
    expect(() => { theme.setTheme('light') }).not.toThrow()
    expect(theme.getTheme().preference).toBe('light')
    dispose()
  })
})
