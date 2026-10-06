/**
 * The approval gate for desktop computer use. It sits in the Host tools
 * pipeline in front of the Cua Driver MCP server (`ahel-computer`):
 *
 * - every call is denied while `computerUse.enabled` (the `computerUse`
 *   service of `@ahel/dsh-computer-use`) is off or absent, or the session is paused;
 * - reads (screenshots, accessibility trees, window lists) run without a card;
 * - every write is checked against the hard-block list, then asks the user
 *   through `ctx.approval` with a card the approval UI reads from this service;
 * - unknown tool names are denied.
 *
 * It also keeps a per-session activity log and the kill switch.
 *
 * @module @ahel/dsh-computer-use-action-gate
 */

import type { Context, Volatile } from '@ahel/cordis'
import { Service } from '@ahel/cordis'
import Schema from '@ahel/schemastery'
import type { Agent } from '@ahel/dsh-agent'
import type { PreToolDecision, ToolExecution, ToolExecutionResult } from '@ahel/dsh-tools'
import type {} from '@ahel/dsh-user-approval'
// Type-only: the settings service that saves the block list, and the Loader's entry and volatile-update merges.
import type {} from '@ahel/dsh-settings'
import type {} from '@ahel/cordis-plugin-loader'
import { blockReason, BUILT_IN_BLOCKED } from './blocklist.ts'
import { describeAction } from './card.ts'
import { classify, REFUSED_TOOLS } from './classify.ts'
import { argsOf, Observations, type ResolvedTarget } from './observation.ts'
import type {
  ComputerUseActivityRow, ComputerUseCard, ComputerUseSessionView, ComputerUseStatus, ComputerUseView,
} from './types.ts'

export { blockReason, builtInFor, BUILT_IN_BLOCKED, isSecureField } from './blocklist.ts'
export type { BlockedApp, BlockTarget, ElementFacts } from './blocklist.ts'
export { classify, READ_TOOLS, REFUSED_TOOLS, WRITE_TOOLS } from './classify.ts'
export { describeAction } from './card.ts'
export { Observations } from './observation.ts'
export type { ResolvedTarget } from './observation.ts'
export type * from './types.ts'

declare module '@ahel/cordis' {
  interface Context {
    /** The computer-use approval gate. */
    computerUseGate: ComputerUseGate
  }
}

/** Gate configuration. */
export interface Config {
  /** MCP server name of the Cua Driver; its tools are `mcp__<serverName>__<tool>`. */
  serverName?: string
  /** App names or bundle ids the user blocked, on top of the built-in list. */
  blockedApps?: Volatile<string[] | undefined>
  /** Activity rows kept per session. */
  activityLimit?: number
}

/** Validated configuration. */
export const Config = Schema.object({
  serverName: Schema.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default('ahel-computer'),
  blockedApps: Schema.array(Schema.string()).volatile(),
  activityLimit: Schema.natural().min(10).max(1000).default(200),
})

/** Writes that need no observed target app: they name their own target or touch no app. */
const TARGETLESS = new Set(['launch_app', 'clipboard_write', 'page', 'browser_navigate', 'browser_click', 'browser_type', 'browser_dialog'])
/** Writes that put text into a field; they must name the field so it can be checked. */
const TEXT_WRITES = new Set(['type_text', 'set_value'])

const OFF_REASON = 'Computer use is turned off. The user can turn it on in Settings > General > Computer use.'
const PAUSED_REASON = 'Computer use is paused in this chat. Ask the user to resume it.'
const NO_TARGET_REASON = 'Observe the target window with get_window_state first, then act on it by element_token, or pass its pid and window_id.'
const NO_FIELD_REASON = 'Name the field with element_token from get_window_state (or x, y on its screenshot) so it can be checked before typing.'

/**
 * The person's on switch: the `computerUse` service of `@ahel/dsh-computer-use`.
 * Read by shape so the gate fails closed when that package is not composed.
 */
interface EnabledSwitch {
  readonly enabled: boolean
  setEnabled(enabled: boolean): Promise<void>
}

function isSwitch(value: unknown): value is EnabledSwitch {
  return typeof value === 'object' && value !== null
    && typeof Reflect.get(value, 'enabled') === 'boolean' && typeof Reflect.get(value, 'setEnabled') === 'function'
}

interface Pending {
  readonly card: ComputerUseCard
  readonly agent: Agent
}

interface SessionState {
  running: boolean
  paused: boolean
  activity: ComputerUseActivityRow[]
}

/** Computer-use gate service. */
export class ComputerUseGate extends Service {
  static inject = ['tools']
  static Config = Config

  private readonly prefix: string
  private readonly blockedRef: Volatile<string[] | undefined>
  private readonly activityLimit: number
  private readonly entryId: string | undefined
  /** Set by the kill switch; holds computer use off until the saved switch reads off. */
  private stopped = false
  private readonly observations = new WeakMap<Agent, Observations>()
  private readonly pending = new Map<string, Pending>()
  private readonly sessions = new Map<string, SessionState>()
  private readonly active = new Map<string, Agent>()
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - Host context with the tool registry.
   * @param config - gate configuration.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'computerUseGate')
    // The Loader hands live volatile references; parsing them again would replace them.
    const { blockedApps, ...plain } = config
    const resolved = Config(plain)
    this.blockedRef = blockedApps ?? resolved.blockedApps
    this.prefix = `mcp__${resolved.serverName}__`
    this.activityLimit = resolved.activityLimit
    this.entryId = ctx.fiber.entry?.options.id

    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!exec.name.startsWith(this.prefix)) return await next()
      return await this.gate(exec, next)
    })
    ctx.on('tools/execute', async (exec, next) => {
      const pending = this.pending.get(exec.callId)
      if (pending !== undefined) this.update(pending.card.sessionId, exec.callId, 'approved', null)
      return await next()
    })
    ctx.on('tools/result', (exec, result) => {
      if (exec.name.startsWith(this.prefix)) this.settle(exec, result)
      return undefined
    })
    ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      const id = agent.session.id
      const state = this.sessions.get(id)
      this.active.delete(id)
      if (state?.running === true) {
        state.running = false
        this.changed()
      }
    })
    ctx.on('loader/volatile-update', () => { this.changed() })
    ctx.effect(() => () => {
      this.pending.clear()
      for (const listener of this.listeners) listener()
    }, 'computer-use-gate.lifetime')
  }

  /** Whether computer use is on: the person's switch is on and the kill switch has not fired since. */
  get enabled(): boolean {
    const on = this.switch()?.enabled === true
    // Once the saved switch reads off, the kill switch has done its job and the switch rules again.
    if (!on) this.stopped = false
    return on && !this.stopped
  }

  private switch(): EnabledSwitch | undefined {
    const service: unknown = this.ctx.get('computerUse')
    return isSwitch(service) ? service : undefined
  }

  /**
   * The app names and bundle ids this person added to the block list, on top of the built-in one.
   * @returns the user's own block list.
   */
  blockedApps(): string[] {
    return [...this.blockedRef.get() ?? []]
  }

  /**
   * The card for one pending write.
   * @param callId - the tool call.
   * @returns the card, or null when the call is not waiting.
   */
  card(callId: string): ComputerUseCard | null {
    return this.pending.get(callId)?.card ?? null
  }

  /**
   * Everything the card, the dock and the Settings row show: the switch, every session's run state and activity, and the block lists.
   * @returns the complete state for the UI.
   */
  view(): ComputerUseView {
    const sessions: ComputerUseSessionView[] = []
    for (const [sessionId, state] of this.sessions) {
      sessions.push({ sessionId, running: state.running, paused: state.paused, activity: [...state.activity] })
    }
    return {
      enabled: this.enabled,
      blockedApps: this.blockedApps(),
      builtInBlocked: BUILT_IN_BLOCKED.map(entry => entry.windows === undefined ? entry.name : `${entry.name} (Privacy & Security)`),
      sessions,
    }
  }

  /**
   * Observe state changes.
   * @param listener - called after every change.
   * @returns disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Pause or resume computer use in one session. Paused calls are denied.
   * @param sessionId - the session.
   * @param paused - the new state.
   */
  setPaused(sessionId: string, paused: boolean): void {
    this.state(sessionId).paused = paused
    this.changed()
  }

  /**
   * Replace the user's block list and save it.
   * @param apps - app names or bundle ids.
   */
  async setBlockedApps(apps: readonly string[]): Promise<void> {
    const clean = [...new Set(apps.map(app => app.trim()).filter(app => app !== ''))]
    const settings = this.ctx.get('settings')
    if (settings === undefined || this.entryId === undefined) {
      throw new Error('computer-use-gate: the block list requires the settings service and a profile entry')
    }
    await settings.update(this.entryId, { blockedApps: clean })
    this.changed()
  }

  /**
   * Kill switch: turn computer use off now, cancel every turn that is using
   * it, and save the switch as off.
   */
  async stop(): Promise<void> {
    this.stopped = true
    for (const agent of this.active.values()) agent.cancel({ kind: 'user' })
    this.active.clear()
    for (const state of this.sessions.values()) state.running = false
    this.changed()
    await this.switch()?.setEnabled(false).catch((error: unknown) => {
      this.ctx.logger.warn(`computer-use-gate: the off switch was not saved: ${String(error)}`)
    })
    this.changed()
  }

  private async gate(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    const raw = exec.name.slice(this.prefix.length)
    const agent = exec.agent
    const sessionId = agent?.session.id
    const deny = (status: ComputerUseStatus, reason: string, summary = raw, app: string | null = null): PreToolDecision => {
      if (sessionId !== undefined) {
        this.record(sessionId, { callId: exec.callId, time: Date.now(), action: raw, summary, app, status, reason })
      }
      return { kind: 'deny', reason }
    }
    if (!this.enabled) return deny('denied', OFF_REASON)
    if (agent === undefined || sessionId === undefined) return deny('denied', 'Computer use needs a chat session.')
    const state = this.state(sessionId)
    if (state.paused) return deny('denied', PAUSED_REASON)
    const refused = REFUSED_TOOLS.get(raw)
    if (refused !== undefined) return deny('denied', refused)
    const kind = classify(raw)
    if (kind === 'unknown') return deny('denied', `"${raw}" is not an allowed computer-use action.`)
    this.active.set(sessionId, agent)
    if (!state.running) {
      state.running = true
      this.changed()
    }
    if (kind === 'read') {
      const decision = await next()
      this.record(sessionId, {
        callId: exec.callId, time: Date.now(), action: raw, summary: readSummary(raw, exec.arguments), app: null,
        status: decision.kind === 'allow' ? 'read' : 'denied', reason: decision.kind === 'deny' ? decision.reason : null,
      })
      return decision
    }

    const target = this.observationsOf(agent).resolve(raw, exec.arguments)
    const text = describeAction(raw, exec.arguments, target)
    const args = argsOf(exec.arguments)
    if (!TARGETLESS.has(raw) && target.app === null) return deny('denied', NO_TARGET_REASON, text.summary)
    if (TEXT_WRITES.has(raw) && target.element === null && target.point === null) return deny('denied', NO_FIELD_REASON, text.summary, target.app)
    const blocked = blockReason({
      app: target.app,
      bundleId: target.bundleId,
      window: target.window,
      element: target.element,
      focusedSecure: target.focusedSecure,
      writesText: TEXT_WRITES.has(raw) || (raw === 'press_key' && typeof args['key'] === 'string' && args['key'].length === 1),
      urls: target.urls,
    }, this.blockedApps())
    if (blocked !== null) return deny('blocked', blocked, text.summary, target.app)

    const downstream = await next()
    if (downstream.kind === 'deny' || downstream.kind === 'cancel') {
      this.record(sessionId, {
        callId: exec.callId, time: Date.now(), action: raw, summary: text.summary, app: target.app, status: 'denied',
        reason: downstream.kind === 'deny' ? downstream.reason : null,
      })
      return downstream
    }
    const card = cardOf(exec.callId, sessionId, raw, target, text)
    this.pending.set(exec.callId, { card, agent })
    this.record(sessionId, { callId: exec.callId, time: Date.now(), action: raw, summary: text.summary, app: target.app, status: 'asked', reason: null })
    return {
      kind: 'ask',
      reason: `Computer use: ${text.summary}`,
      displayReason: { en: text.summary },
    }
  }

  private settle(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    const sessionId = exec.agent?.session.id
    const pending = this.pending.get(exec.callId)
    this.pending.delete(exec.callId)
    if (sessionId === undefined) return
    const raw = exec.name.slice(this.prefix.length)
    if (!result.isError && exec.agent !== undefined && classify(raw) !== 'unknown') {
      this.observationsOf(exec.agent).ingest(raw, exec.arguments, result.value)
    }
    if (pending === undefined) return
    const row = this.sessions.get(sessionId)?.activity.find(item => item.callId === exec.callId)
    const message = result.isError ? errorText(result) : null
    if (row?.status === 'approved') this.update(sessionId, exec.callId, result.isError ? 'failed' : 'done', message)
    else this.update(sessionId, exec.callId, 'rejected', message)
  }

  private observationsOf(agent: Agent): Observations {
    let observations = this.observations.get(agent)
    if (observations === undefined) {
      observations = new Observations()
      this.observations.set(agent, observations)
    }
    return observations
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (state === undefined) {
      state = { running: false, paused: false, activity: [] }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private record(sessionId: string, row: ComputerUseActivityRow): void {
    const activity = this.state(sessionId).activity
    activity.push(row)
    if (activity.length > this.activityLimit) activity.splice(0, activity.length - this.activityLimit)
    this.changed()
  }

  private update(sessionId: string, callId: string, status: ComputerUseStatus, reason: string | null): void {
    const activity = this.sessions.get(sessionId)?.activity
    const index = activity?.findIndex(row => row.callId === callId) ?? -1
    const row = activity?.[index]
    if (activity === undefined || row === undefined) return
    activity[index] = { ...row, status, reason }
    this.changed()
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

function cardOf(
  callId: string,
  sessionId: string,
  action: string,
  target: ResolvedTarget,
  text: ReturnType<typeof describeAction>,
): ComputerUseCard {
  return {
    callId,
    sessionId,
    action,
    summary: text.summary,
    app: target.app,
    bundleId: target.bundleId,
    window: target.window,
    element: target.element === null ? null : { role: target.element.role, label: target.element.label },
    text: text.text,
    keys: text.keys,
    point: target.point,
    crop: target.crop,
    args: text.args,
  }
}

function readSummary(raw: string, args: unknown): string {
  const a = argsOf(args)
  switch (raw) {
    case 'get_window_state': return 'Looked at a window'
    case 'get_desktop_state': return 'Looked at the screen'
    case 'list_apps': return 'Listed apps'
    case 'list_windows': return 'Listed windows'
    case 'get_accessibility_tree': return 'Read an accessibility tree'
    case 'zoom': return 'Zoomed into a screenshot'
    case 'verify_state': return 'Checked a window'
    default: return typeof a['pid'] === 'number' ? `${raw} (pid ${String(a['pid'])})` : raw
  }
}

function errorText(result: Readonly<ToolExecutionResult>): string {
  const first = result.content.find(block => block.type === 'text')
  return first?.type === 'text' ? first.text.replace(/^Error: /, '').slice(0, 300) : 'failed'
}

export default ComputerUseGate
