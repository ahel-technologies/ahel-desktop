/**
 * The ahel.ai account theme: ahel.ai and app.ahel.ai keep one preference,
 * `light`, `dark` or `system`, in the `ahel.theme` cookie (Path=/, Domain=.ahel.ai,
 * SameSite=Lax, readable by page script). The chat at ahel.ai/chat shares the
 * ahel.ai site, so the cookie reaches its document. The parse rule and the write
 * attributes match ahel.ai's `src/lib/theme.ts`; a mismatch makes the sharing one-way.
 * This module is DOM-free and import-free, so the Host and browser halves share
 * it: the Host half embeds {@link ACCOUNT_THEME_PATTERN} in the boot script and
 * the browser half reads and writes through it.
 */

/** An account theme value; the same three values as ui-theme's built-in preferences. */
export type AccountTheme = 'light' | 'dark' | 'system'

/** Cookie and localStorage key of the account theme on ahel.ai. */
export const ACCOUNT_THEME_KEY = 'ahel.theme'

/** Cookie domain shared by ahel.ai and its subdomains. */
export const ACCOUNT_THEME_DOMAIN = '.ahel.ai'

/** Cookie lifetime: one year, in seconds. */
export const ACCOUNT_THEME_MAX_AGE = 31536000

/** `document.cookie` entry of the account theme; the first well-formed entry wins. */
export const ACCOUNT_THEME_PATTERN = /(?:^|; )ahel\.theme=(light|dark|system)(?:;|$)/

/**
 * Read the account theme from a `document.cookie` string.
 * @param cookies - the page's cookie string.
 * @returns the preference of the first well-formed `ahel.theme` entry, or null when there is none.
 */
export function readAccountTheme(cookies: string): AccountTheme | null {
  const match = ACCOUNT_THEME_PATTERN.exec(cookies)
  return match === null ? null : match[1] as AccountTheme
}

/**
 * Build the `document.cookie` assignment that stores the account theme. The Domain
 * attribute is set only on ahel.ai and its subdomains, where browsers accept it;
 * Secure only over https; never HttpOnly, because the boot script reads it.
 * @param preference - the preference to store.
 * @param location - the page's hostname and protocol.
 * @returns the cookie assignment string.
 */
export function accountThemeCookie(preference: AccountTheme, location: { hostname: string; protocol: string }): string {
  const host = location.hostname.toLowerCase()
  const shared = host === 'ahel.ai' || host.endsWith('.ahel.ai')
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  const domain = shared ? `; Domain=${ACCOUNT_THEME_DOMAIN}` : ''
  return `${ACCOUNT_THEME_KEY}=${preference}; Max-Age=${ACCOUNT_THEME_MAX_AGE}; Path=/; SameSite=Lax${secure}${domain}`
}
