/**
 * Host face of the computer-use UI: the `computerUseApproval` Remote
 * namespace over the action gate. The approval card reads its details here,
 * the composer dock streams the live state, pauses a session and calls the
 * kill switch, and the Settings row edits the user's block list. The on
 * switch itself belongs to `@ahel/dsh-computer-use` and its Settings row.
 *
 * @module @ahel/dsh-client-ui-computer-use
 */

import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-computer-use-action-gate'
import type { ComputerUseCard, ComputerUseView } from '@ahel/dsh-computer-use-action-gate/types'
import { Remote, TypertRemoteService } from '@ahel/dsh-typert-protocol'

declare module '@ahel/cordis' {
  interface Context {
    /** Remote access for the computer-use approval card, dock and settings row. */
    computerUseApproval: ComputerUseController
  }
}

/** Remote namespace `computerUseApproval`. */
export default class ComputerUseController extends TypertRemoteService {
  static inject = ['computerUseGate']

  /** @param ctx - Host context carrying the computer-use gate. */
  constructor(ctx: Context) {
    super(ctx, 'computerUseApproval')
  }

  /**
   * The approval card for one pending write.
   * @param callId - the tool call waiting for approval.
   * @returns the card, or null when the call is no longer waiting.
   */
  @Remote
  card(callId: string): ComputerUseCard | null {
    return this.ctx.computerUseGate.card(callId)
  }

  /**
   * Subscribe to the complete computer-use state, starting with the current one.
   * @param signal - subscription lifetime.
   * @returns views as the state changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<ComputerUseView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    const stop = this.ctx.computerUseGate.subscribe(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!signal.aborted) {
        if (dirty) {
          dirty = false
          yield this.ctx.computerUseGate.view()
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      stop()
      signal.removeEventListener('abort', changed)
    }
  }

  /** Kill switch: cancel every turn using computer use and turn it off. */
  @Remote
  async stop(): Promise<void> {
    await this.ctx.computerUseGate.stop()
  }

  /**
   * Pause or resume computer use in one session.
   * @param sessionId - the session.
   * @param paused - the new state.
   */
  @Remote
  setPaused(sessionId: string, paused: boolean): void {
    this.ctx.computerUseGate.setPaused(sessionId, paused)
  }

  /**
   * Replace the user's own block list.
   * @param apps - app names or bundle ids.
   */
  @Remote
  async setBlockedApps(apps: string[]): Promise<void> {
    await this.ctx.computerUseGate.setBlockedApps(apps)
  }
}
