/**
 * The chat's theme and the ahel.ai account theme stay one preference. On load,
 * and each time the page regains focus, the `ahel.theme` cookie wins over the
 * chat's current preference; a change made in the chat (the rail's Theme row or
 * Settings > Appearance) is written back to the cookie and to this origin's
 * localStorage, the two places ahel.ai's own pages read.
 */
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-client-ui-theme/client'
import { ACCOUNT_THEME_KEY, type AccountTheme, accountThemeCookie, readAccountTheme } from '../account-theme.ts'

/** Built-in preferences the account theme can carry; registered theme ids stay chat-local. */
const ACCOUNT_PREFERENCES: ReadonlySet<string> = new Set<AccountTheme>(['light', 'dark', 'system'])

/** Read the cookie; a sandboxed document that refuses cookie access reads as none. */
function cookieTheme(): AccountTheme | null {
  try {
    return readAccountTheme(document.cookie)
  } catch (_blocked) {
    // A sandboxed document throws on cookie access: there is no account theme to follow.
    return null
  }
}

/** Store the preference where ahel.ai reads it: the shared cookie, then this origin's localStorage. */
function saveAccountTheme(preference: AccountTheme): void {
  try {
    document.cookie = accountThemeCookie(preference, window.location)
  } catch (_blocked) {
    // A blocked cookie jar: localStorage below still records the choice for ahel.ai on this origin.
  }
  try {
    localStorage.setItem(ACCOUNT_THEME_KEY, preference)
  } catch (_blocked) {
    // Storage blocked (private mode, quota): the cookie carries the choice.
  }
}

/**
 * Keep `ctx.theme` and the account theme in step for the lifetime of the effect.
 * @param ctx - Client context with the theme service.
 * @returns the disposer removing the listeners.
 */
export function followAccountTheme(ctx: Context): () => void {
  let saved = ctx.theme.getTheme().preference
  const adopt = (): void => {
    const preference = cookieTheme()
    if (preference === null || preference === ctx.theme.getTheme().preference) return
    saved = preference
    ctx.theme.setTheme(preference)
  }
  adopt()
  const offChange = ctx.on('theme/change', (snapshot) => {
    const preference = snapshot.preference
    if (preference === saved || !ACCOUNT_PREFERENCES.has(preference)) return
    saved = preference
    saveAccountTheme(preference)
  })
  const onVisible = (): void => { if (document.visibilityState === 'visible') adopt() }
  window.addEventListener('focus', adopt)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    offChange()
    window.removeEventListener('focus', adopt)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
