/** Issue rows of the Inbox: open one in the desktop's Issues panel and mark it read. */
import type {} from '@ahel/cordis'
import type { IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import type { RemoteResult } from '@ahel/dsh-typert-protocol'
import type { InboxAnswer } from './contract.ts'

// The same event @ahel/dsh-client-ui-issues declares and listens to; the Inbox only emits it.
declare module '@ahel/cordis' {
  interface Events {
    /**
     * Show the desktop Issues panel with one issue's detail open, for example from an Inbox row.
     * @mode emit
     * @param key - the issue key, for example `AHEL-137`.
     */
    'ahel-issues/open'(key: string): void
  }
}

/** ahel.ai's Issues page; one issue's detail is `<this>/<key>`. */
export const WEB_ISSUES = 'https://ahel.ai/app/issues'

/** What opening an issue row needs. */
export interface IssueItemHost {
  /** Show the issue in the desktop (the `ahel-issues/open` event). */
  readonly show: (key: string) => void
  /** `ahelIssues.readItem`. */
  readonly markRead: (id: string) => Promise<RemoteResult<number>>
  /** Re-read the summary, so the badge drops. */
  readonly refresh: () => void
}

/**
 * Open one issue row: show the issue, then mark the row read when it was unread.
 * @param host - the event, the read write and the summary refresh.
 * @param item - the row; a row whose issue is gone only marks itself read.
 * @returns ahel.ai's refusal of the read, if any.
 */
export async function openIssueItem(host: IssueItemHost, item: IssueInboxItem): Promise<InboxAnswer> {
  if (item.issueKey !== null) host.show(item.issueKey)
  if (!item.unread) return { ok: true }
  const result = await host.markRead(item.id)
  host.refresh()
  if (result.ok) return { ok: true }
  return { ok: false, outdated: result.error.code === 'ahel-issues/outdated', message: null }
}
