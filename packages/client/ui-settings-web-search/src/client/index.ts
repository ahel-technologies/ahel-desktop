/**
 * Settings > General > Web search, browser half. Web search in Ahel Desktop
 * is Ahel Web Search through the Ahel account, so the row shows its state in
 * the selected workspace and, when it is off there, a Turn on button; there
 * is no provider picker. It reads `ahelAccount` and `ahelCatalog`, which
 * `dsh-client-ui-ahel-account` mounts.
 */

import type { Context as ClientContext } from '@ahel/cordis'
import type {} from '@ahel/dsh-ahel-account'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
import type {} from '@ahel/dsh-ahel-account/remote'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import { WebSearchRow } from './WebSearchRow.tsx'
import type { WebSearchRowInjected, WebSearchRowState, WebSearchStatus } from './WebSearchRow.tsx'
import { en, zh, type WebSearchSettingsLocaleKey } from './locales.ts'

export type { WebSearchRowInjected, WebSearchRowProps, WebSearchRowState, WebSearchStatus } from './WebSearchRow.tsx'
export type { WebSearchSettingsLocaleKey } from './locales.ts'

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Web search settings row copy. */
    'settings.webSearch': WebSearchSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.webSearch'

/** ahel.ai's catalog id and gateway key of Web Search. */
const WEB_SEARCH_ID = 'ahel.services/web-search'
const WEB_SEARCH_KEY = 'ahel-services-web-search'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote']

/**
 * Register the row once the Ahel account namespaces are mounted.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-web-search: dictionaries')
  ctx.inject(['remote.ahelAccount', 'remote.ahelCatalog', 'slots'], (inner) => { register(inner) })
}

function register(ctx: ClientContext): void {
  let state: WebSearchRowState = { status: 'checking', busy: false, failed: false }
  const listeners = new Set<() => void>()
  const row: HostObservable<WebSearchRowState> = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: Partial<WebSearchRowState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  let generation = 0
  const read = async (): Promise<void> => {
    const mine = ++generation
    const result = await ctx.remote.ahelCatalog.installed()
    if (mine !== generation) return
    let status: WebSearchStatus = 'unreachable'
    if (result.ok) {
      const found = result.value.rows.find(entry => entry.key === WEB_SEARCH_KEY)
      status = !result.value.signedIn ? 'signed-out' : found?.state === 'on' ? 'on' : 'off'
    } else if (result.error.code === 'ahel-catalog/signed-out') {
      status = 'signed-out'
    }
    publish({ status })
  }
  const refresh = (): void => { void read().catch(() => { publish({ status: 'unreachable' }) }) }

  // Signed-in status plus the selected workspace; a change of either reads the workspace again.
  let seen: string | undefined
  const stream = ctx.remote.$stream<AhelAccountView>({
    name: 'web search account', open: signal => ctx.remote.ahelAccount.watch(signal), ended: () => new Error('ahel account stream ended'),
  })
  ctx.effect(() => () => stream.dispose(), 'ui-settings-web-search: account stream')
  void (async () => {
    for await (const frame of stream) {
      const next = frame.value.status === 'signed-in'
      const key = next ? `in:${frame.value.workspace ?? ''}` : 'out'
      frame.accept()
      if (key === seen) continue
      seen = key
      if (next) {
        publish({ status: 'checking', failed: false })
        refresh()
      } else {
        ++generation
        publish({ status: 'signed-out', failed: false })
      }
    }
  })().catch(() => undefined)

  const injected: WebSearchRowInjected = {
    hooks: { row },
    turnOn: async () => {
      publish({ busy: true, failed: false })
      try {
        const listed = await ctx.remote.ahelCatalog.installed()
        const found = listed.ok ? listed.value.rows.find(entry => entry.key === WEB_SEARCH_KEY) : undefined
        const result = found === undefined
          ? await ctx.remote.ahelCatalog.add(WEB_SEARCH_ID)
          : await ctx.remote.ahelCatalog.setEnabled(WEB_SEARCH_KEY, true)
        if (!result.ok) publish({ failed: true })
        await read()
      } catch (_unreachable) {
        // The Remote call itself failed (Host gone or ahel.ai unreachable); the row says so.
        publish({ failed: true })
      } finally {
        publish({ busy: false })
      }
    },
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'web-search', order: 50, locale: NS, inject: () => injected,
  }, WebSearchRow))
}
