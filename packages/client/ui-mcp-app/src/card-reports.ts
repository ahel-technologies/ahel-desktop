/** Delivery of card-reported text to an Agent as logged model context. */

import type { Agent } from '@ahel/dsh-agent'
import { createUserMessage } from '@ahel/dsh-llm'

/** Most distinct report texts remembered per Agent for duplicate suppression. */
export const MAX_REMEMBERED_REPORTS = 256

/** The Agent members report delivery uses. */
export type ReportTarget = Pick<Agent, 'status' | 'whenIdle' | 'inject'>

/**
 * Queue card-reported text as logged context for an Agent's next turn.
 *
 * - A text the Agent was already given is dropped: a card drawn again after a
 *   page reload repeats its state read and its `ui/update-model-context`.
 * - While a turn runs, the text waits until the Agent is idle. Injected
 *   context joins the nearest step boundary, so a running turn that receives
 *   it after its answer step takes one more step that answers the card
 *   instead of the person's prompt. Idle, the text waits in the inbox and is
 *   sent with the next prompt, ahead of it.
 * - Delivery to a disposed Agent is dropped.
 */
export class CardReports {
  private readonly reported = new WeakMap<ReportTarget, Set<string>>()

  /**
   * @param agent - the Session's Agent; nothing is reported without one.
   * @param text - the context text.
   */
  report(agent: ReportTarget | undefined, text: string): void {
    if (agent === undefined) return
    let reported = this.reported.get(agent)
    if (reported === undefined) {
      reported = new Set()
      this.reported.set(agent, reported)
    }
    if (reported.has(text)) return
    reported.add(text)
    if (reported.size > MAX_REMEMBERED_REPORTS) {
      for (const oldest of reported) {
        reported.delete(oldest)
        break
      }
    }
    injectWhenIdle(agent, text).catch(() => {
      // A disposed Agent has no next request; its pending context goes with it.
    })
  }
}

/** Inject one report once the Agent has no running turn. */
async function injectWhenIdle(agent: ReportTarget, text: string): Promise<void> {
  while (agent.status !== 'idle') await agent.whenIdle()
  agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'mcp-app' } }))
}
