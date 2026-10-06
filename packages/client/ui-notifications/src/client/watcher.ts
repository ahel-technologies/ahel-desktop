/** Decide which Session changes become system notifications; React-free and timer-injectable for tests. */
import type { SessionId } from '@ahel/dsh-session/types'

/** Person-chosen notification preference, stored per device. */
export interface NotificationSettings {
  /** On by default. */
  readonly enabled: boolean
}

/** Default for a device without a saved choice. */
export const DEFAULT_SETTINGS: NotificationSettings = { enabled: true }

/** One notification handed to the platform. */
export interface SystemNotification {
  readonly title: string
  readonly body: string
  /** What a click opens: a SessionId, or `panel:<main panel id>`. */
  readonly target: string
}

/** Platform notification sink: the Desktop bridge, the Web Notification API, or a test double. */
export interface Notifier {
  show(note: SystemNotification): void
  /**
   * Observe clicks on shown notifications.
   * @param listener - receives the clicked notification's target.
   * @returns the unsubscribe.
   */
  onClick(listener: (target: string) => void): () => void
}

/** What a Session is waiting on, reduced to the copy a notification needs. */
export interface PendingWait {
  /** Opaque identity of one request; a new key notifies again. */
  readonly key: string
  readonly kind: 'approval' | 'question'
  /** Card summary (approval) or the question text; may be empty. */
  readonly text: string
}

/** Localized notification bodies; the title is always the chat title. */
export interface SessionCopy {
  /** Body when the finished turn has no reply preview. */
  replyReady(): string
  failed(reason: string): string
  approval(summary: string): string
  question(text: string): string
}

/** Everything the Session watcher reads from the running Client. */
export interface SessionWatcherEnvironment {
  readonly copy: SessionCopy
  /** Post one notification; the caller applies the preference and the focus rule. */
  post(note: SystemNotification): void
  /** Whether this Session is a top-level chat (subagents never notify). */
  notifiable(sessionId: SessionId): boolean
  /** Human label of the Session. */
  title(sessionId: SessionId): string
  /** The finished turn's final assistant text (possibly a bounded preview), absent when unknown. */
  finalResponse(sessionId: SessionId): string | undefined
  /** Timer seam; defaults to `setTimeout`. */
  readonly schedule?: (run: () => void, ms: number) => () => void
}

/**
 * Delay between a turn stopping and its notification. The stop, the failure and the final
 * response preview travel on separate streams, so the decision waits for all three.
 */
export const SETTLE_MS = 400

/** Longest title or body handed to the platform. */
const MAX_TEXT = 180

/**
 * Clip one line of notification text.
 * @param text - raw text.
 * @returns whitespace-collapsed text of at most {@link MAX_TEXT} characters.
 */
export function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1).trimEnd()}…` : line
}

/**
 * Default timer seam.
 * @param run - callback.
 * @param ms - delay.
 * @returns the cancel.
 */
export function schedule(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms)
  return () => { clearTimeout(timer) }
}

/** Turns Session running, failure and pending-wait facts into notifications. */
export class SessionNotifications {
  private readonly running = new Set<SessionId>()
  private readonly failures = new Map<SessionId, string>()
  private readonly settling = new Map<SessionId, () => void>()
  private readonly waits = new Map<SessionId, string>()

  /** @param env - Client reads, copy and the notification sink. */
  constructor(private readonly env: SessionWatcherEnvironment) {}

  /**
   * Record one Agent running-state change; a stop notifies "reply ready" after {@link SETTLE_MS}.
   * @param sessionId - Session whose Agent changed.
   * @param running - current state.
   */
  status(sessionId: SessionId, running: boolean): void {
    if (running) {
      this.running.add(sessionId)
      this.failures.delete(sessionId)
      this.settling.get(sessionId)?.()
      this.settling.delete(sessionId)
      return
    }
    if (!this.running.delete(sessionId)) return
    this.settling.set(sessionId, (this.env.schedule ?? schedule)(() => {
      this.settling.delete(sessionId)
      this.settle(sessionId)
    }, SETTLE_MS))
  }

  /**
   * Record one Agent failure; it replaces the turn's reply-ready body.
   * @param sessionId - Session whose Agent failed.
   * @param message - user-safe failure text.
   */
  failed(sessionId: SessionId, message: string): void {
    if (this.running.has(sessionId) || this.settling.has(sessionId)) this.failures.set(sessionId, message)
  }

  /**
   * Reconcile what each Session is waiting on; each new request notifies once.
   * @param waits - current wait per Session.
   */
  pending(waits: ReadonlyMap<SessionId, PendingWait>): void {
    for (const sessionId of [...this.waits.keys()]) {
      if (!waits.has(sessionId)) this.waits.delete(sessionId)
    }
    for (const [sessionId, wait] of waits) {
      if (this.waits.get(sessionId) === wait.key) continue
      this.waits.set(sessionId, wait.key)
      const detail = clip(wait.text)
      this.notify(sessionId, wait.kind === 'approval' ? this.env.copy.approval(detail) : this.env.copy.question(detail))
    }
  }

  /** Cancel pending decisions. */
  dispose(): void {
    for (const cancel of this.settling.values()) cancel()
    this.settling.clear()
  }

  private settle(sessionId: SessionId): void {
    const failure = this.failures.get(sessionId)
    this.failures.delete(sessionId)
    if (failure !== undefined) {
      this.notify(sessionId, this.env.copy.failed(clip(failure)))
      return
    }
    // A turn that stopped on an approval or a question already notified for the wait.
    if (this.waits.has(sessionId)) return
    this.notify(sessionId, this.env.finalResponse(sessionId) ?? this.env.copy.replyReady())
  }

  private notify(sessionId: SessionId, body: string): void {
    if (!this.env.notifiable(sessionId)) return
    this.env.post({ title: clip(this.env.title(sessionId)), body: clip(body), target: sessionId })
  }
}
