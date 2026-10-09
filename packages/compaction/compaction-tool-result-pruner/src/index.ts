/**
 * Replay-safe, model-free tool-result pruning service.
 *
 * @module @ahel/dsh-compaction-tool-result-pruner
 */

import { Context, Service } from '@ahel/cordis'
import z from '@ahel/schemastery'
import { freezeMessage } from '@ahel/dsh-llm'
import type { ContentBlock } from '@ahel/dsh-llm'
import type { Session, SessionEvent, SessionSeq, ToolResultMessage } from '@ahel/dsh-session'
// Type-only: the `agent/pre-step` Events merge for the earlier-result trim.
import type {} from '@ahel/dsh-agent'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@ahel/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@ahel/dsh-token-meter'
import { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig, trimNote } from './config.ts'
import type {
  PrunedEntry,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig, TRIM_NOTE_MAX_CHARS, trimNote } from './config.ts'
export type {
  EarlierResultTrimConfig,
  PrunedEntry,
  ResolvedEarlierResultTrimConfig,
  PruneResult,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

declare module '@ahel/cordis' {
  interface Context {
    toolResultPruner: ToolResultPruner
  }
}

interface SnapshotCandidate {
  readonly seq: SessionSeq
  readonly event: SessionEvent<'tool/result'>
}

/** Deterministic head/middle/tail pruning for current tool-result surface nodes. */
export class ToolResultPruner extends Service {
  // The token meter prices each shadowed node for its logged shadow-price
  // event, so pruning genuinely requires the pricing capability.
  static inject = ['tokenMeter']

  static Config: z<ToolResultPruneConfig> = z.object({
    thresholdChars: z.number().step(1).min(1).default(DEFAULTS.thresholdChars),
    headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
    tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
    earlierResults: z.object({
      enabled: z.boolean().default(DEFAULTS.earlierResults.enabled),
      thresholdChars: z.number().step(1).min(1).default(DEFAULTS.earlierResults.thresholdChars),
      keepChars: z.number().step(1).min(0).default(DEFAULTS.earlierResults.keepChars),
    }),
  })

  /** Resolved and immutable character budgets. */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: ToolResultPruneConfig = {}) {
    super(ctx, 'toolResultPruner')
    this.config = resolveConfig(config)
    if (this.config.earlierResults.enabled) {
      ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
        if (!signal.aborted) {
          try {
            this.trimEarlierResults(agent.session)
          } catch (error: unknown) {
            ctx.logger.warn(`earlier tool-result trim failed: ${error instanceof Error ? error.message : String(error)}; continuing the turn`)
          }
        }
        return next()
      })
    }
  }

  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number {
    let chars = 0
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * Replace an over-budget text middle while retaining rich-block order.
   * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
   * boundary cannot split a surrogate pair. Grapheme clusters may still split.
   * @param blocks - original tool-result content.
   * @returns pruned content, or `null` when the text is within budget.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    const totalChars = this.measureContent(blocks)
    if (totalChars <= this.config.thresholdChars) return null

    const removedStart = this.config.headChars
    const removedEnd = totalChars - this.config.tailChars
    const pruned: ContentBlock[] = []
    let consumed = 0
    let markerInserted = false

    for (const block of blocks) {
      if (block.type !== 'text') {
        pruned.push(block)
        continue
      }

      const points = Array.from(block.text)
      const blockStart = consumed
      const blockEnd = blockStart + points.length
      const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
      const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
      const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
      const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : ''
      if (marker.length > 0) markerInserted = true
      const text = points.slice(0, headEnd).join('')
        + marker
        + points.slice(tailStart).join('')
      if (text.length > 0) pruned.push({ ...block, text })
      consumed = blockEnd
    }

    /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
    if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
    const charsAfter = this.measureContent(pruned)
    /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
    if (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) {
      throw new Error('tool-result prune: replacement must be smaller and within threshold')
    }
    return pruned
  }

  /**
   * Keep the first `earlierResults.keepChars` text code points of an
   * over-threshold all-text result and end it with {@link trimNote}.
   * @param blocks - original tool-result content.
   * @returns trimmed content, or `null` when the result is within the
   * threshold or carries a non-text block.
   */
  trimContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    if (blocks.some(block => block.type !== 'text')) return null
    const { thresholdChars, keepChars } = this.config.earlierResults
    const totalChars = this.measureContent(blocks)
    if (totalChars <= thresholdChars) return null
    const kept: ContentBlock[] = []
    let remaining = keepChars
    for (const block of blocks) {
      /* v8 ignore next -- the all-text check above admits only text blocks. */
      if (block.type !== 'text') continue
      if (remaining === 0) break
      const points = Array.from(block.text)
      const text = points.slice(0, remaining).join('')
      remaining -= Math.min(remaining, points.length)
      kept.push({ ...block, text })
    }
    const note = trimNote(totalChars - (keepChars - remaining))
    const last = kept.at(-1)
    if (last?.type === 'text') kept[kept.length - 1] = { ...last, text: last.text + note }
    else kept.push({ type: 'text', text: note.trimStart() })
    return kept
  }

  /**
   * Trim every large tool result the model already saw: a `tool/result`
   * surface node before the latest `assistant/message` node. Results after
   * it are the next request's fresh input and stay whole. Error results,
   * replacements, results with non-text blocks, and pending question or
   * confirm cards are never trimmed. Each trim is one logged single-node
   * replacement, preceded by its `compaction/prune` shadow price, that
   * changes only the message content; the original event and its card stay
   * in the log.
   * A replacement is fixed once written, so every later request sends the
   * same bytes for that result.
   * @param session - session whose current surface is trimmed.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the session rejects a replacement; replacements committed
   * earlier in the pass remain durable.
   */
  trimEarlierResults(session: Session): PruneResult {
    const nodes = session.surface.nodes
    let seenEnd = -1
    for (let index = nodes.length - 1; index >= 0; index--) {
      // Existing Session history read; surface seqs are validated log references.
      // oxlint-disable-next-line typescript/no-deprecated, typescript/no-non-null-assertion
      if (session.eventAt(nodes[index]!)?.type === 'assistant/message') {
        seenEnd = index
        break
      }
    }
    const candidates: SnapshotCandidate[] = []
    for (const seq of nodes.slice(0, Math.max(0, seenEnd))) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(seq)
      if (event?.type === 'tool/result' && isTrimmable(event)) candidates.push({ seq, event })
    }
    const pruned: PrunedEntry[] = []
    let charsRemoved = 0
    for (const { seq, event } of candidates) {
      const original = session.deriveEventMessage(event) as ToolResultMessage
      const content = this.trimContent(original.content)
      if (content === null) continue
      const charsBefore = this.measureContent(original.content)
      const charsAfter = this.measureContent(content)
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message: freezeMessage<ToolResultMessage>({ ...original, content }),
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId: event.data.message.source.callId,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }

  /**
   * Prune every over-budget tool result from one stable current-surface snapshot.
   * Each replacement preserves the complete event data except for `content`,
   * cites the shadowed node so replay can recover the replacement input, and is
   * immediately preceded by a `compaction/prune` shadow-price event pricing the
   * shadowed node through the injected token meter, so pure consumers can
   * subtract it without per-node state.
   * @param session - session whose current surface is rewritten.
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the session rejects a replacement; replacements committed
   * earlier in the pass remain durable.
   */
  pruneSession(session: Session): PruneResult {
    const candidates: SnapshotCandidate[] = []
    for (const seq of [...session.surface.nodes]) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(seq)
      /* v8 ignore next -- surface seqs are validated contiguous log references. */
      if (event?.type === 'tool/result') candidates.push({ seq, event })
    }

    const pruned: PrunedEntry[] = []
    let charsRemoved = 0
    for (const { seq, event } of candidates) {
      const original = session.deriveEventMessage(event) as ToolResultMessage
      const content = this.pruneContent(original.content)
      if (content === null) continue
      const charsBefore = this.measureContent(original.content)
      const charsAfter = this.measureContent(content)
      const message = freezeMessage<ToolResultMessage>({
        ...original,
        content,
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // shadowed node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId: event.data.message.source.callId,
        charsBefore,
        charsAfter,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }
}

/**
 * Whether one original tool result may be trimmed once the model has seen it:
 * not a replacement, not an error, and not a card still asking the person.
 */
function isTrimmable(event: SessionEvent<'tool/result'>): boolean {
  if (event.surfaceOp !== 'append' || event.data.message.isError === true || event.data.error !== undefined) return false
  return !asksThePerson(event.data.meta) && !event.data.message.content.some(block => block.type === 'text' && block.text.includes('interaction_id'))
}

/** Whether a result's persisted MCP Apps card is a question, approval, or confirm card. */
function asksThePerson(meta: unknown): boolean {
  if (!isObject(meta) || !isObject(meta['mcpApp'])) return false
  const view = meta['mcpApp']['structuredContent']
  if (!isObject(view)) return false
  return view['interaction'] !== undefined || view['mode'] === 'confirm' || view['view'] === 'question' || view['view'] === 'approval'
}

/** Narrow a JSON value to a string-keyed object. */
function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default ToolResultPruner
