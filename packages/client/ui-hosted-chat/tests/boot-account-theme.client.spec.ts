// @vitest-environment jsdom
/** The account-theme boot script: the ahel.ai `ahel.theme` cookie applied before any client plugin runs. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountThemeInjections, accountThemeStyle } from '../src/boot-account-theme.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/**
 * Run the boot row against the jsdom document, read through a page whose cookie string is fixed.
 * `systemDark` undefined runs the row without `matchMedia`.
 */
function boot(cookie: string, systemDark?: boolean): void {
  const [row] = accountThemeInjections()
  if (row?.kind !== 'script' || row.placement !== 'body') throw new Error('expected one body script row')
  const page = {
    cookie,
    head: document.head,
    body: document.body,
    documentElement: document.documentElement,
    createElement: (tag: string) => document.createElement(tag),
  }
  const matchMedia = systemDark === undefined ? {} : { matchMedia: vi.fn(() => ({ matches: systemDark })) }
  runInNewContext(row.text, { document: page, ...matchMedia })
}

/** The state ui-theme's own boot rows leave for a dark Host preference. */
function uiThemeBootedDark(): void {
  document.documentElement.dataset.dsThemeSource = 'dark'
  document.body.setAttribute(DARK_ATTRIBUTE, '')
}

afterEach(() => {
  delete document.documentElement.dataset.dsThemeSource
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.head.replaceChildren()
})

describe('account-theme boot script', () => {
  it.each([
    ['light', true, false],
    ['dark', false, true],
    ['system', true, true],
    ['system', false, false],
  ] as const)('applies a %s cookie (system dark: %s)', (preference, systemDark, dark) => {
    uiThemeBootedDark()
    boot(`ahel_chat_workspace=w1; ahel.theme=${preference}`, systemDark)
    expect(document.documentElement.dataset.dsThemeSource).toBe(preference)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
    expect(document.head.querySelector('style')?.textContent).toBe(accountThemeStyle(preference))
  })

  it.each([
    ['no cookie', ''],
    ['an unknown value', 'ahel.theme=sepia'],
    ['a look-alike name', 'xahel.theme=light'],
  ])('leaves ui-theme\'s boot state alone with %s', (_case, cookie) => {
    uiThemeBootedDark()
    boot(cookie, false)
    expect(document.documentElement.dataset.dsThemeSource).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('takes the first well-formed cookie entry', () => {
    boot('ahel.theme=bogus; ahel.theme=light; ahel.theme=dark', true)
    expect(document.documentElement.dataset.dsThemeSource).toBe('light')
  })

  it('resolves a system cookie to light without matchMedia', () => {
    boot('ahel.theme=system')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it('does nothing when the document refuses cookie access', () => {
    const [row] = accountThemeInjections()
    if (row?.kind !== 'script') throw new Error('expected a script row')
    const sandboxed = { get cookie(): string { throw new Error('SecurityError') } }
    expect(() => { runInNewContext(row.text, { document: sandboxed }) }).not.toThrow()
  })
})
