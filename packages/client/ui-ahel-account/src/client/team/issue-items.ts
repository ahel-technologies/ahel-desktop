/** Issue rows of the Inbox: the one list they share with received handoffs, and opening one in the desktop's Issues panel. */
import type {} from '@ahel/cordis'
import type { HandoffReceivedRow, IssueInboxItem } from '@ahel/dsh-ahel-account/types'
import type { RemoteResult } from '@ahel/dsh-typert-protocol'
import type { AhelAccountKey } from '../locales.ts'
import type { InboxAnswer } from './contract.ts'

// The same events @ahel/dsh-client-ui-issues declares and listens to; the Inbox only emits them.
declare module '@ahel/cordis' {
  interface Events {
    /**
     * Show the desktop Issues panel with one issue's detail open, for example from an Inbox row.
     * @mode emit
     * @param key - the issue key, for example `AHEL-137`.
     */
    'ahel-issues/open'(key: string): void
    /**
     * Read the agent's issues now and claim the runs this person queued on ahel.ai, for example after the Inbox read.
     * @mode emit
     */
    'ahel-issues/poll'(): void
  }
}

/** ahel.ai's Issues page; one issue's detail is `<this>/<key>`. */
export const WEB_ISSUES = 'https://ahel.ai/app/issues'

/** The kind label and the sentence of each kind of issue row. */
export const ISSUE_KIND_COPY: Readonly<Record<IssueInboxItem['type'], { readonly label: AhelAccountKey; readonly sentence: AhelAccountKey }>> = {
  assigned: { label: 'inboxKindAssigned', sentence: 'inboxIssueAssigned' },
  mentioned: { label: 'inboxKindMentioned', sentence: 'inboxIssueMentioned' },
  run_queued: { label: 'inboxKindRunQueued', sentence: 'inboxIssueRunQueued' },
  run_waiting_input: { label: 'inboxKindRunWaitingInput', sentence: 'inboxIssueRunWaitingInput' },
  run_finished: { label: 'inboxKindRunFinished', sentence: 'inboxIssueRunFinished' },
  run_failed: { label: 'inboxKindRunFailed', sentence: 'inboxIssueRunFailed' },
}

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

/** One Inbox row: a received handoff or an issue update. */
export type InboxEntry =
  | { readonly kind: 'handoff'; readonly id: string; readonly at: string; readonly unread: boolean; readonly row: HandoffReceivedRow }
  | { readonly kind: 'issue'; readonly id: string; readonly at: string; readonly unread: boolean; readonly item: IssueInboxItem }

/**
 * The local calendar day of a timestamp, for grouping.
 * @param iso - the timestamp.
 * @returns `YYYY-M-D` in local time, or the input when it does not parse.
 */
function localDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * Merge received handoffs and issue updates into one list: newest day first,
 * unread before read within a day, then newest first.
 * @param received - the received handoffs.
 * @param items - the issue updates.
 * @returns the rows in display order.
 */
export function inboxEntries(received: readonly HandoffReceivedRow[], items: readonly IssueInboxItem[]): InboxEntry[] {
  const entries: InboxEntry[] = [
    ...received.map(row => ({ kind: 'handoff' as const, id: `handoff:${row.id}`, at: row.updatedAt, unread: row.unread, row })),
    ...items.map(item => ({ kind: 'issue' as const, id: `issue:${item.id}`, at: item.createdAt, unread: item.unread, item })),
  ]
  const time = (entry: InboxEntry): number => {
    const ms = Date.parse(entry.at)
    return Number.isNaN(ms) ? 0 : ms
  }
  return entries.sort((a, b) => {
    const dayA = localDay(a.at)
    const dayB = localDay(b.at)
    if (dayA !== dayB) return time(b) - time(a)
    return Number(b.unread) - Number(a.unread) || time(b) - time(a)
  })
}
