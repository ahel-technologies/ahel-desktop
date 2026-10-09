/**
 * Boot row that applies the ahel.ai account theme before first paint. It runs
 * after ui-theme's boot rows (which carry the Host-side preference, `system` on
 * the hosted chat because a non-loopback page keeps theme choices process-local)
 * and before any client plugin starts. When the `ahel.theme` cookie holds a
 * preference, the row replaces ui-theme's canvas colors, the body palette
 * attribute and `html[data-ds-theme-source]`, from which the theme service
 * takes its initial preference.
 */
import type { IndexInjection } from '@ahel/dsh-host-webserver'
import { ACCOUNT_THEME_PATTERN, type AccountTheme } from './account-theme.ts'

// The canvas colors of ui-theme's boot style (packages/client/ui-theme/src/boot-theme.ts);
// tests/account-theme.host.spec.ts fails when the two differ.
const LIGHT_BACKGROUND = '#fff'
const DARK_BACKGROUND = '#14171d'

/**
 * Canvas CSS for one preference, in the form ui-theme's boot style uses.
 * @param preference - the account theme.
 * @returns CSS that colors the document canvas for that preference.
 */
export function accountThemeStyle(preference: AccountTheme): string {
  const light = `:root{color-scheme:light}body{background-color:${LIGHT_BACKGROUND};--dsh-boot-bg:${LIGHT_BACKGROUND}}`
  const dark = `:root{color-scheme:dark}body{background-color:${DARK_BACKGROUND};--dsh-boot-bg:${DARK_BACKGROUND}}`
  if (preference === 'light') return light
  if (preference === 'dark') return dark
  return `${light}@media(prefers-color-scheme:dark){${dark}}`
}

/** Build the body script; it does nothing when the page has no well-formed cookie. */
function accountThemeScript(): string {
  const styles: Record<AccountTheme, string> = {
    light: accountThemeStyle('light'),
    dark: accountThemeStyle('dark'),
    system: accountThemeStyle('system'),
  }
  return `(() => {
  let cookies = ''
  try { cookies = document.cookie } catch (_blocked) { return }
  const match = ${ACCOUNT_THEME_PATTERN}.exec(cookies)
  if (match === null) return
  const preference = match[1]
  const style = document.createElement('style')
  style.textContent = ${JSON.stringify(styles)}[preference]
  document.head.append(style)
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.dsThemeSource = preference
  document.body.toggleAttribute('data-ds-dark-theme', preference === 'dark' || systemDark)
})()`
}

/**
 * The account-theme boot rows. Push them without `prepend`, so they follow
 * ui-theme's prepended rows in the table.
 * @returns one body script row.
 */
export function accountThemeInjections(): IndexInjection[] {
  return [{ kind: 'script', placement: 'body', text: accountThemeScript() }]
}
