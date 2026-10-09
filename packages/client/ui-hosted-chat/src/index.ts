/**
 * Hosted chat browser plugin, node half: the boot row that applies the ahel.ai
 * account theme before first paint. The browser half ships through
 * `exports["./client"]`.
 */
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-host-webserver'
import { accountThemeInjections } from './boot-account-theme.ts'

/**
 * Host plugin body: add the account-theme boot row to every index render.
 * @param ctx - Host context serving browser pages.
 */
export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push(...accountThemeInjections())
  })
}
