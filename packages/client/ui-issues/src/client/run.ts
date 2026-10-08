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
 * or the chat's next turn, moves the run on. While a turn has ended on a
 * pending confirm card, the run reads whether ahel.ai still lists the card as
 * waiting for the person, after {@link CONFIRM_POLL_FIRST_MS} and then at
 * doubling intervals up to {@link CONFIRM_POLL_MAX_MS}, until the chat goes
 * on or closes, the run ends, or the card's expiry passes. Once the card is
 * no longer listed (pressed or declined on ahel.ai), the run sends the card's
 * own continuation once: ahel.ai runs a pressed card exactly once, with the
 * values it was pressed with, and refuses a declined or unpressed one, so
 * nothing runs that the person did not press. The run then tells the chat the
 * outcome in a note and the chat finishes its turn: a card that ran lets the
 * run finish, a declined one reports `waiting_input`, an expired one fails the
 * run with the reason `confirm expired`. While the run is live the
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
  /** Whether the chat is still in the person's chat list; false once it is archived or deleted. */
  chatOpen(sessionId: string): boolean
  /**
   * Whether a confirm card still waits for the person's press on ahel.ai, read in the workspace the chat acts in.
   * @returns true while it waits, false once it does not, null when unknown.
   */
  confirmWaiting(sessionId: string, interactionId: string): Promise<boolean | null>
  /**
   * Send a confirm card's own continuation through the chat's tool pipeline, as the card's button does.
   * @returns the call's MCP result fields, or null when the chat cannot call its card's server.
   */
  continueConfirm(sessionId: string, confirm: PendingConfirm): Promise<ConfirmContinuation | null>
  /** The note that tells the chat how a confirm card it ended on was answered, in the person's language. */
  confirmNote(outcome: ConfirmOutcome): string
}

/** A pending confirm card a turn ended on, read from its persisted card record. */
export interface PendingConfirm {
  /** The MCP server that drew the card. */
  readonly server: string
  /** The card's action id (`action.id`), which its continuation names. */
  readonly actionId: string
  /** The card's interaction id. */
  readonly interactionId: string
  /** What the card does (`action.summary`). */
  readonly what: string
  /** Epoch milliseconds after which the card can no longer run, or null when the card names none. */
  readonly expiresAt: number | null
}

/** MCP result fields of a confirm card's continuation. */
export interface ConfirmContinuation {
  readonly content: readonly unknown[]
  readonly structuredContent?: unknown
  readonly isError?: boolean
}

/** How the person answered a confirm card outside the chat. */
export type ConfirmOutcome =
  | { readonly kind: 'ran'; readonly what: string; readonly receipt: string }
  | { readonly kind: 'declined'; readonly what: string }
  | { readonly kind: 'expired'; readonly what: string }
  | { readonly kind: 'failed'; readonly what: string; readonly reason: string }

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

/** The persisted card record of the last tool result that rendered a card. */
function lastCard(entries: readonly RunEntry[]): { readonly server?: unknown; readonly structuredContent?: unknown } | null {
  for (const { event } of [...entries].reverse()) {
    if (event.type !== 'tool/result') continue
    const meta = (event.data as { meta?: { mcpApp?: { server?: unknown; structuredContent?: unknown } } } | undefined)?.meta
    if (meta?.mcpApp !== undefined) return meta.mcpApp
  }
  return null
}

/** A card's interaction id, or undefined. */
function interactionOf(structuredContent: unknown): string | undefined {
  const id = (structuredContent as { interaction?: { id?: unknown } } | null | undefined)?.interaction?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * What the chat's latest card waits for.
 * @param entries - the chat's event window.
 * @param answered - interaction ids of cards answered outside the chat; such a card waits for nothing.
 * @returns the wait of the last tool result that rendered a card, or null.
 */
export function lastCardWait(entries: readonly RunEntry[], answered: ReadonlySet<string> = new Set()): RunWait | null {
  const card = lastCard(entries)
  if (card === null) return null
  const id = interactionOf(card.structuredContent)
  return id !== undefined && answered.has(id) ? null : cardWait(card.structuredContent)
}

/**
 * The pending confirm card the chat's latest card is, if it is one the person can press on ahel.ai.
 * @param entries - the chat's event window.
 * @returns the card, or null.
 */
export function pendingConfirm(entries: readonly RunEntry[]): PendingConfirm | null {
  const card = lastCard(entries)
  const view = card?.structuredContent as {
    view?: unknown
    mode?: unknown
    interaction?: { id?: unknown; status?: unknown; expiresAt?: unknown }
    action?: { id?: unknown; summary?: unknown }
  } | null | undefined
  if (typeof card?.server !== 'string' || view?.view !== 'question' || view.mode !== 'confirm') return null
  const { interaction, action } = view
  if (interaction?.status !== 'pending' || typeof interaction.id !== 'string' || typeof action?.id !== 'string') return null
  const expiresAt = typeof interaction.expiresAt === 'string' ? Date.parse(interaction.expiresAt) : Number.NaN
  return {
    server: card.server,
    actionId: action.id,
    interactionId: interaction.id,
    what: typeof action.summary === 'string' ? action.summary : action.id,
    expiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
  }
}

/** Longest server text a confirm outcome carries. */
const MAX_OUTCOME_TEXT = 1_000

/** The text blocks of MCP content, joined and bounded. */
function contentText(content: readonly unknown[]): string {
  const text = content.flatMap((block) => {
    const { type, text: value } = (block ?? {}) as { type?: unknown; text?: unknown }
    return type === 'text' && typeof value === 'string' ? [value] : []
  }).join('\n').trim()
  return text.length <= MAX_OUTCOME_TEXT ? text : `${text.slice(0, MAX_OUTCOME_TEXT)}…`
}

/**
 * Read a confirm card's continuation as the person's answer. ahel.ai's refusals carry no code, so an unpressed card
 * (`Refused: … runs only when the person presses …`), a run already in flight and a declined card (`withdrawn`) are
 * read from its words.
 * @param result - the continuation's MCP result fields.
 * @param what - what the card does.
 * @returns the outcome, or null while the card still waits for a press or its run is in flight.
 */
export function confirmOutcome(result: ConfirmContinuation, what: string): ConfirmOutcome | null {
  const text = contentText(result.content)
  const view = result.structuredContent as { view?: unknown; interaction?: { status?: unknown } } | null | undefined
  if (view?.view === 'question' || view?.view === 'approval') {
    // The card again: expired, withdrawn, waiting on its fields, or held by an approval rule until a manager answers.
    if (view.interaction?.status === 'expired') return { kind: 'expired', what }
    if (view.interaction?.status === 'cancelled') return { kind: 'declined', what }
    return null
  }
  if (result.isError !== true) return { kind: 'ran', what, receipt: text }
  if (/^Refused:/.test(text) || /already (running|being submitted)/.test(text)) return null
  if (/withdrawn/.test(text)) return { kind: 'declined', what }
  return { kind: 'failed', what, reason: text.split('\n', 1)[0] ?? '' }
}

/** Steps are reported at most this often while the state stays the same. */
const STEP_REPORT_MS = 3_000

/** A live run reports its state again this often; ahel.ai fails a live run after 30 minutes without a report. */
const KEEP_ALIVE_MS = 5 * 60_000

/** The first read of a pending confirm card's state comes this long after the turn ends on it. */
const CONFIRM_POLL_FIRST_MS = 15_000

/** Reads of a pending confirm card's state double their interval up to this. */
const CONFIRM_POLL_MAX_MS = 60_000

/** The reason a run whose confirm card expired unpressed fails with. */
const CONFIRM_EXPIRED_REASON = 'confirm expired'

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
 * @param summarise - receives the closing reply of a finished run and its chat, to post as Ahel's comment.
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
  summarise?: (text: string, sessionId: string) => void,
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
  const send = (next: IssueRunState, force: boolean, reason?: string): void => {
    const now = Date.now()
    if (!force && next === state && now - reported < STEP_REPORT_MS) return
    state = next
    reported = now
    report({ sessionId, state, steps, totalSteps: null, ...reason === undefined ? {} : { reason } })
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
  const end = (final: 'finished' | 'failed', withSummary = true, reason?: string): void => {
    if (ended) return
    ended = true
    for (const dispose of disposers) dispose()
    send(final, true, reason)
    if (final === 'finished' && withSummary) {
      const reply = lastReply(binding.eventSource.getSnapshot().entries)
      if (reply !== '') summarise?.(reply, sessionId)
    }
    release()
  }

  let started = session.getSnapshot().running
  /** The card the last turn ended on waits for the person; the run reports that wait until the card is answered. */
  let parked = false
  /** Confirm cards answered outside the chat, whose outcome the chat was told. */
  const answered = new Set<string>()
  /** The outcome the running turn was told; it decides what the turn's end reports. */
  let told: ConfirmOutcome | null = null
  let stopWatch: (() => void) | null = null

  /** Read a pending confirm card's state until it changes, then tell the chat the outcome once. */
  const watchConfirm = (confirm: PendingConfirm): void => {
    let delay = CONFIRM_POLL_FIRST_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const stop = (): void => {
      stopped = true
      clearTimeout(timer)
      if (stopWatch === stop) stopWatch = null
    }
    const schedule = (): void => {
      const left = confirm.expiresAt === null ? delay : Math.max(0, confirm.expiresAt - Date.now())
      timer = setTimeout(() => { void tick() }, Math.min(delay, left))
      delay = Math.min(delay * 2, CONFIRM_POLL_MAX_MS)
    }
    const read = async (): Promise<ConfirmOutcome | null> => {
      if (confirm.expiresAt !== null && Date.now() >= confirm.expiresAt) return { kind: 'expired', what: confirm.what }
      if (await host.confirmWaiting(sessionId, confirm.interactionId) !== false) return null
      if (stopped) return null
      const result = await host.continueConfirm(sessionId, confirm)
      return result === null ? null : confirmOutcome(result, confirm.what)
    }
    const tick = async (): Promise<void> => {
      if (!host.chatOpen(sessionId)) { stop(); return }
      let outcome: ConfirmOutcome | null
      try {
        outcome = await read()
      } catch (error) {
        console.warn('[ui-issues] could not read a confirm card\'s state:', error)
        outcome = null
      }
      if (outcome !== null) answered.add(confirm.interactionId)
      // A chat that went on, or a run that ended, already holds the continuation's result as logged card context.
      if (stopped || ended) return
      if (outcome === null) { schedule(); return }
      stop()
      told = outcome
      void binding.send(host.confirmNote(outcome)).then((sent) => {
        if (!sent.ok) end('failed')
      }, () => { end('failed') })
    }
    stopWatch?.()
    stopWatch = stop
    schedule()
  }

  const onSession = (): void => {
    const snapshot = session.getSnapshot()
    if (snapshot.running) {
      started = true
      stopWatch?.()
      if (parked) {
        parked = false
        if (host.waiting(sessionId) === null) send('running', true)
      }
      return
    }
    if (!started || ended || parked) return
    if (snapshot.lastAgentError !== null || snapshot.promptError !== null) { end('failed'); return }
    const entries = binding.eventSource.getSnapshot().entries
    const outcome = told
    told = null
    const wait = lastCardWait(entries, answered)
    if (wait === null) {
      if (outcome?.kind === 'declined') { parked = true; send('waiting_input', true); return }
      if (outcome?.kind === 'expired') { end('failed', false, CONFIRM_EXPIRED_REASON); return }
      if (outcome?.kind === 'failed') { end('failed', false, outcome.reason === '' ? undefined : outcome.reason); return }
      end('finished')
      return
    }
    parked = true
    send(wait, true)
    const confirm = wait === 'waiting_approval' ? pendingConfirm(entries) : null
    if (confirm !== null) watchConfirm(confirm)
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
    () => { clearInterval(keepAlive) }, () => { stopWatch?.() },
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
