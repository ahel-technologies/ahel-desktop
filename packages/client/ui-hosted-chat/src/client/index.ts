/**
 * Browser face of the hosted chat at ahel.ai/chat: a Workspace row under the
 * sidebar's team header (or first, when there is none) and the sidebar brand
 * as a link, both back to the workspace on app.ahel.ai in the same tab. Only
 * the hosted overlay (packages/bundle/web-app/hosted/chat.patch.yml) mounts
 * this row; the desktop and plain web profiles keep the brand's New Session press.
 */
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import { BrandHomeLink, WorkspaceRow } from './HostedChat.tsx'
import { en, NS, zh } from './locales.ts'

export { APP_HOME, type BrandHomeLinkProps, type WorkspaceRowProps } from './HostedChat.tsx'
export type { HostedChatKey } from './locales.ts'

/** Required services: slots and dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries, the Workspace row and the brand link.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-hosted-chat: dictionaries')
  // After the team header (order 0), above New chat.
  ctx.slots.inject('sidebar.header', () => ctx.slots.register({
    name: 'sidebar.header', id: 'hosted-workspace', order: 10, locale: NS,
  }, WorkspaceRow))
  ctx.slots.inject('sidebar.brand.link', () => ctx.slots.register({
    name: 'sidebar.brand.link', locale: NS,
  }, BrandHomeLink))
}
