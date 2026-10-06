/**
 * Teammate handoffs that arrive while the window is in the background. The account's own
 * summary poll pauses without focus, so this watcher reads the Inbox itself, and only then.
 */
import { clip, type SystemNotification } from './watcher.ts'

/** Poll period while the window is in the background. */
export const INBOX_POLL_MS = 60_000

/** One received handoff, read structurally from `ahelTeam.inbox()`. */
export interface InboxRow {
  readonly id: string
  readonly title: string
  readonly from: string
  readonly unread: boolean
}

/** Main panel the Ahel account plugin registers for the Inbox; a click opens it. */
export const INBOX_TARGET = 'panel:ahel-inbox'

/** Everything the Inbox watcher reads from the running Client. */
export interface InboxWatcherEnvironment {
  /** Received handoffs, or absence when signed out, unavailable or failed. */
  read(): Promise<readonly InboxRow[] | undefined>
  /** Localized title naming the sender. */
  handoff(from: string): string
  post(note: SystemNotification): void
  /** Repeating timer seam; defaults to `setInterval`. */
  readonly every?: (run: () => void, ms: number) => () => void
}

function every(run: () => void, ms: number): () => void {
  const timer = setInterval(run, ms)
  return () => { clearInterval(timer) }
}

/** Seeds the unread handoffs on blur, then notifies each new one until the window is focused again. */
export class InboxNotifications {
  private seen: Set<string> | undefined
  private stop: (() => void) | undefined
  private generation = 0

  /** @param env - Inbox read, copy and the notification sink. */
  constructor(private readonly env: InboxWatcherEnvironment) {}

  /** The window lost focus: remember what is already unread and start polling. */
  background(): void {
    if (this.stop !== undefined) return
    this.seen = undefined
    void this.tick()
    this.stop = (this.env.every ?? every)(() => { void this.tick() }, INBOX_POLL_MS)
  }

  /** The window is focused again: stop polling; the Inbox badge takes over. */
  foreground(): void {
    this.generation += 1
    this.stop?.()
    this.stop = undefined
  }

  /** Stop polling. */
  dispose(): void { this.foreground() }

  /** Read once; the first read only seeds. Exposed for tests. */
  async tick(): Promise<void> {
    const mine = this.generation
    const rows = await this.env.read().catch(() => undefined)
    if (rows === undefined || mine !== this.generation) return
    const unread = rows.filter(row => row.unread)
    if (this.seen === undefined) {
      this.seen = new Set(unread.map(row => row.id))
      return
    }
    for (const row of unread) {
      if (this.seen.has(row.id)) continue
      this.seen.add(row.id)
      this.env.post({ title: clip(this.env.handoff(row.from)), body: clip(row.title), target: INBOX_TARGET })
    }
  }
}
