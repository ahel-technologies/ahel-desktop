/**
 * Run with Ahel: open a new chat in the most recent folder, send the issue as
 * its first message, and report the chat's state to ahel.ai as the issue's
 * run. A run with a workspace (the issue's) pins its chat there before the
 * first message, so the chat's model requests and tool calls act in the
 * issue's workspace whatever workspace is selected later; a chat that cannot
 * be pinned (no seat there any more) ends the run `failed` with the reason.
 * The turn ending normally reports `finished`, an error `failed`, a
 * held tool call `waiting_approval`, a question to the person
 * `waiting_input`, and the answer `running` again. A turn that ends on a card
 * waiting for the person (a connector confirm or a held call, whose result
 * names a pending interaction) reports `waiting_approval` (`waiting_input` for
 * a connector question) instead of `finished`; the person's press on the card,
 * or the chat's next turn, moves the run on. While the run is live the
 * current state is reported again every {@link KEEP_ALIVE_MS}, so ahel.ai's
 * sweep of runs without reports leaves it alone. Steps are the tool calls
 * made so far; the expected total stays unknown because the goal package
 * keeps rounds, not steps. A run that claims a run queued on ahel.ai opens
 * its chat without showing it, sends its first report through `claim` and
 * waits for the answer before the issue reaches the chat: when another
 * session holds the run, the new chat is archived unused.
 */
import type { IssueRunReport, IssueRunState } from '@ahel/dsh-ahel-account/types'
import type { RemoteResult } from '@ahel/dsh-typert-protocol'
import type {} from '@ahel/dsh-api-session-controller/client'

declare module '@ahel/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A Run with Ahel chat, held until its first turn settles or the card it ended on is answered. */
    issueRun: unknown
  }
}

/** One chat event a run reads: tool calls count as steps, the last assistant message is the summary. */
export interface RunEntry {
  readonly event: { readonly type: string; readonly data?: unknown }
}

/** The part of a chat a run reads and drives. */
export interface RunSession {
  readonly session: {
    getSnapshot(): { readonly running: boolean; readonly lastAgentError: string | null; readonly promptError: object | null }
    subscribe(listener: () => void): () => void
  }
  readonly eventSource: {
    getSnapshot(): {
      readonly entries: readonly RunEntry[]
      readonly change: { readonly kind: string; readonly entries?: readonly RunEntry[] }
    }
    subscribe(listener: () => void): () => void
  }
  /** Queue one user message, echoed in the chat like a typed one. */
  send(text: string): Promise<RemoteResult<{ accepted: true }>>
}

/** What a chat waits for: a held tool call, or the person's answer to a question. */
export type RunWait = 'waiting_approval' | 'waiting_input'

/** What a run needs from the Client: a new chat and whether it waits for the person. */
export interface RunHost {
  /**
   * Pin a chat that has taken no step yet to one workspace.
   * @returns null once pinned, or the plain reason it cannot act there.
   */
  pinChat(sessionId: string, workspace: string): Promise<string | null>
  /**
   * Open a new chat and hold it.
   * @param reveal - show the chat in the main panel; false leaves the person's view as it is.
   * @returns its id, the binding and the release, or null without a folder to open it in.
   */
  openChat(reveal: boolean): Promise<{ sessionId: string; binding: RunSession; release: () => void } | null>
  /** What the chat waits for from the person, or null while it waits for nothing. */
  waiting(sessionId: string): RunWait | null
  /** Observe `waiting` changes. */
  subscribeWaiting(listener: () => void): () => void
  /**
   * Observe the tool calls a chat's cards make (a press), with the call's structured result.
   * @returns the stop.
   */
  subscribeCardCalls(listener: (sessionId: string, structuredContent: unknown) => void): () => void
  /** Archive a chat a run opened and never used. */
  discard(sessionId: string): void
}

/** How a run start ended. */
export type RunStart =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly reason: 'no-workspace' | 'failed' | 'claimed'; readonly message: string | null }

/**
 * What a tool result asks of the person, read from the persisted card record (`meta.mcpApp.structuredContent`):
 * a pending confirm card or held call waits for a decision, a pending connector question for an answer.
 * @param structuredContent - a card's structured result.
 * @returns the wait, or null when it asks nothing.
 */
export function cardWait(structuredContent: unknown): RunWait | null {
  if (typeof structuredContent !== 'object' || structuredContent === null) return null
  const view = structuredContent as { view?: unknown; mode?: unknown; interaction?: { status?: unknown } }
  if (view.interaction?.status !== 'pending') return null
  if (view.view === 'approval') return 'waiting_approval'
  if (view.view !== 'question') return null
  return view.mode === 'confirm' ? 'waiting_approval' : 'waiting_input'
}

/**
 * What the chat's latest card waits for.
 * @param entries - the chat's event window.
 * @returns the wait of the last tool result that rendered a card, or null.
 */
export function lastCardWait(entries: readonly RunEntry[]): RunWait | null {
  for (const { event } of [...entries].reverse()) {
    if (event.type !== 'tool/result') continue
    const meta = (event.data as { meta?: { mcpApp?: { structuredContent?: unknown } } } | undefined)?.meta
    if (meta?.mcpApp === undefined) continue
    return cardWait(meta.mcpApp.structuredContent)
  }
  return null
}

/** Steps are reported at most this often while the state stays the same. */
const STEP_REPORT_MS = 3_000

/** A live run reports its state again this often; ahel.ai fails a live run after 30 minutes without a report. */
const KEEP_ALIVE_MS = 5 * 60_000

/** Count tool calls in some event entries. */
function toolCalls(entries: readonly RunEntry[]): number {
  let n = 0
  for (const entry of entries) if (entry.event.type === 'tool/call') n++
  return n
}

/**
 * The text of the last assistant message in some event entries; reasoning and tool calls stay out.
 * @param entries - the chat's event window.
 * @returns the text, or an empty string.
 */
export function lastReply(entries: readonly RunEntry[]): string {
  for (const { event } of [...entries].reverse()) {
    if (event.type !== 'assistant/message') continue
    const message = (event.data as { message?: { content?: unknown } } | undefined)?.message
    const content = Array.isArray(message?.content) ? message.content as { type?: unknown; text?: unknown }[] : []
    const text = content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => (block.text as string).trim())
      .filter(Boolean).join('\n\n')
    if (text !== '') return text
  }
  return ''
}

/**
 * Start one run.
 * @param host - the chat opener and the waiting signal.
 * @param seed - the chat's first message.
 * @param report - sends one run report; failures are the caller's to log.
 * @param summarise - receives the closing reply of a finished run, to post as Ahel's comment.
 * @param claim - sends the first report to claim a queued run; resolves false when another session holds it.
 *   A claimed run's chat opens without being shown.
 * @param workspace - the issue's workspace to pin the chat to, or null to leave the chat to the selected one.
 * @returns whether the chat started (`claimed` when another session holds the run); tracking continues until
 *   the first turn settles, or until the person answers the card it ended on.
 */
export async function startRun(
  host: RunHost,
  seed: string,
  report: (report: IssueRunReport) => void,
  summarise?: (text: string) => void,
  claim?: (report: IssueRunReport) => Promise<boolean>,
  workspace: string | null = null,
): Promise<RunStart> {
  const chat = await host.openChat(claim === undefined)
  if (chat === null) return { ok: false, reason: 'no-workspace', message: null }
  const { sessionId, binding, release } = chat
  const session = binding.session
  const refused = workspace === null ? null : await host.pinChat(sessionId, workspace)
  if (refused !== null) {
    // The run fails where its issue is rather than acting in another workspace.
    const failed: IssueRunReport = { sessionId, state: 'failed', steps: 0, totalSteps: null, reason: refused }
    if (claim === undefined) report(failed)
    else await claim(failed)
    release()
    host.discard(sessionId)
    return { ok: false, reason: 'failed', message: refused }
  }
  let state: IssueRunState = 'running'
  let steps = toolCalls(binding.eventSource.getSnapshot().entries)
  let reported = 0
  const send = (next: IssueRunState, force: boolean): void => {
    const now = Date.now()
    if (!force && next === state && now - reported < STEP_REPORT_MS) return
    state = next
    reported = now
    report({ sessionId, state, steps, totalSteps: null })
  }
  if (claim === undefined) {
    send('running', true)
  } else {
    reported = Date.now()
    if (!await claim({ sessionId, state, steps, totalSteps: null })) {
      release()
      host.discard(sessionId)
      return { ok: false, reason: 'claimed', message: null }
    }
  }

  let ended = false
  const disposers: (() => void)[] = []
  const end = (final: 'finished' | 'failed', withSummary = true): void => {
    if (ended) return
    ended = true
    for (const dispose of disposers) dispose()
    send(final, true)
    if (final === 'finished' && withSummary) {
      const reply = lastReply(binding.eventSource.getSnapshot().entries)
      if (reply !== '') summarise?.(reply)
    }
    release()
  }

  let started = session.getSnapshot().running
  /** The card the last turn ended on waits for the person; the run reports that wait until the card is answered. */
  let parked = false
  const onSession = (): void => {
    const snapshot = session.getSnapshot()
    if (snapshot.running) {
      started = true
      if (parked) {
        parked = false
        if (host.waiting(sessionId) === null) send('running', true)
      }
      return
    }
    if (!started || ended || parked) return
    if (snapshot.lastAgentError !== null || snapshot.promptError !== null) { end('failed'); return }
    const wait = lastCardWait(binding.eventSource.getSnapshot().entries)
    if (wait === null) { end('finished'); return }
    parked = true
    send(wait, true)
  }
  const onCardCall = (id: string, structuredContent: unknown): void => {
    if (id !== sessionId || !parked || ended || cardWait(structuredContent) !== null) return
    // The person answered the card; its own result is the run's outcome, not the reply that asked for the press.
    end('finished', false)
  }
  const onEvents = (): void => {
    const window = binding.eventSource.getSnapshot()
    const count = window.change.kind === 'append' && window.change.entries !== undefined
      ? steps + toolCalls(window.change.entries)
      : toolCalls(window.entries)
    if (count === steps) return
    steps = count
    if (state === 'running') send('running', false)
  }
  const onWaiting = (): void => {
    if (ended) return
    const waiting = host.waiting(sessionId)
    if (waiting !== null && state !== waiting) send(waiting, true)
    else if (waiting === null && !parked && (state === 'waiting_approval' || state === 'waiting_input')) send('running', true)
  }
  const keepAlive = setInterval(() => { if (!ended) send(state, true) }, KEEP_ALIVE_MS)
  disposers.push(
    session.subscribe(onSession), binding.eventSource.subscribe(onEvents),
    host.subscribeWaiting(onWaiting), host.subscribeCardCalls(onCardCall),
    () => { clearInterval(keepAlive) },
  )

  let result: RemoteResult<{ accepted: true }>
  try {
    result = await binding.send(seed)
  } catch (error) {
    end('failed')
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : null }
  }
  if (!result.ok) {
    end('failed')
    return { ok: false, reason: 'failed', message: result.error.message }
  }

  onSession()
  return { ok: true, sessionId }
}
