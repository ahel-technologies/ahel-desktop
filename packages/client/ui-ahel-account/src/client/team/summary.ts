/**
 * One shared `ahelTeam.summary()` poll: every 30 s while the window has
 * focus, at once on window focus, on an account or workspace change, and on
 * demand after a team write. Signed out it publishes nothing to read and
 * calls nothing. An Inbox read replaces the inbox count with the list's own
 * until the next poll.
 */
import type { Context } from '@ahel/cordis'
import type { AhelAccountView } from '@ahel/dsh-ahel-account/types'
// Type-only: the `ahel-team/*` Remote failure codes.
import type {} from '@ahel/dsh-ahel-account'
import type {} from '@ahel/dsh-api-remotes/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { TeamSummary, TeamSummaryState } from './contract.ts'

/** Poll period while the window has focus. */
const POLL_MS = 30_000

/** Window focus re-reads at most this often. */
const FOCUS_REFRESH_MS = 5_000

const EMPTY: TeamSummaryState = { summary: null, outdated: false, error: null }

/**
 * Start the shared summary poll.
 * @param ctx - Client context with `remote.ahelTeam`.
 * @param account - the live account view.
 * @returns the summary observable and its manual trigger.
 */
export function registerTeamSummary(ctx: Context, account: HostObservable<AhelAccountView | null>): TeamSummary {
  let value = EMPTY
  const listeners = new Set<() => void>()
  const state: HostObservable<TeamSummaryState> = {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const publish = (next: TeamSummaryState): void => {
    value = next
    for (const listener of listeners) listener()
  }

  let timer: ReturnType<typeof setInterval> | undefined
  const stopPolling = (): void => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  // Only the newest read publishes, so a slow answer never overwrites a newer one.
  let generation = 0
  let lastRead = 0
  const read = async (): Promise<void> => {
    const mine = ++generation
    if (account.getSnapshot()?.status !== 'signed-in') {
      if (value !== EMPTY) publish(EMPTY)
      return
    }
    lastRead = Date.now()
    const result = await ctx.remote.ahelTeam.summary()
    if (mine !== generation) return
    if (result.ok) {
      publish({ summary: result.value, outdated: false, error: null })
      return
    }
    const code = result.error.code
    if (code === 'ahel-team/outdated') {
      // An old ahel.ai: stop asking until the window is focused again.
      stopPolling()
      publish({ summary: null, outdated: true, error: null })
    } else if (code === 'ahel-team/signed-out') {
      publish(EMPTY)
    } else {
      publish({ ...value, error: result.error.message })
    }
  }
  const refresh = (): void => { void read().catch(() => undefined) }

  const startPolling = (): void => {
    if (timer !== undefined) return
    timer = setInterval(() => {
      if (document.hasFocus()) refresh()
    }, POLL_MS)
  }

  ctx.effect(() => {
    startPolling()
    return stopPolling
  }, 'ui-ahel-account: summary poll')
  refresh()
  ctx.effect(() => {
    let previous = account.getSnapshot()
    return account.subscribe(() => {
      const next = account.getSnapshot()
      const moved = next?.status !== previous?.status || next?.workspace !== previous?.workspace
      previous = next
      if (!moved) return
      // A different workspace's balance must not show while the new one loads.
      if (value.summary !== null) publish({ ...EMPTY, outdated: value.outdated })
      refresh()
    })
  }, 'ui-ahel-account: summary follows the account')
  ctx.effect(() => {
    const onFocus = (): void => {
      startPolling()
      if (Date.now() - lastRead >= FOCUS_REFRESH_MS) refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, 'ui-ahel-account: summary on window focus')

  const adoptInbox = (unread: number): void => {
    const summary = value.summary
    if (summary === null || summary.inbox?.unread === unread) return
    publish({ ...value, summary: { ...summary, inbox: { ...summary.inbox, unread } } })
  }

  return { state, refresh, adoptInbox }
}
