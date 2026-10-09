/** Configuration resolution for deterministic tool-result pruning. */

import { deepFreeze } from '@ahel/dsh-util-values'
import type {
  EarlierResultTrimConfig,
  ResolvedConfig,
  ResolvedEarlierResultTrimConfig,
  ToolResultPruneConfig,
} from './types.ts'

/** Fixed marker substituted for every removed middle span. */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/**
 * The one-line note that replaces the text cut from a seen tool result.
 * @param removedChars - Unicode code points removed.
 * @returns the note, naming the removed size in whole KB rounded up.
 */
export function trimNote(removedChars: number): string {
  return `\n\n[trimmed: ${Math.ceil(removedChars / 1024)} KB more; call the tool again for the full result]`
}

/** Longest {@link trimNote} for any safe-integer size; the budget check reserves it. */
export const TRIM_NOTE_MAX_CHARS = codePointLength(trimNote(Number.MAX_SAFE_INTEGER))

/** Low-friction defaults for coding-agent tool output; earlier-result trimming is off. */
export const DEFAULTS: ResolvedConfig = deepFreeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
  earlierResults: {
    enabled: false,
    thresholdChars: 8192,
    keepChars: 2048,
  },
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'thresholdChars',
  'headChars',
  'tailChars',
  'earlierResults',
])

const EARLIER_RESULT_KEYS: ReadonlySet<string> = new Set([
  'enabled',
  'thresholdChars',
  'keepChars',
])

/**
 * Count Unicode code points without splitting surrogate pairs.
 * @param text - text to measure.
 * @returns the Unicode code-point count.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Resolve and validate pruning budgets.
 * @param config - raw plugin configuration.
 * @returns a detached deeply immutable configuration.
 */
export function resolveConfig(config: ToolResultPruneConfig = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown key "${key}" `
        + '(allowed: thresholdChars, headChars, tailChars, earlierResults)',
      )
    }
  }

  const resolved: ResolvedConfig = {
    thresholdChars: config.thresholdChars ?? DEFAULTS.thresholdChars,
    headChars: config.headChars ?? DEFAULTS.headChars,
    tailChars: config.tailChars ?? DEFAULTS.tailChars,
    earlierResults: resolveEarlierResults(config.earlierResults ?? {}),
  }
  assertPositiveInteger('thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('headChars', resolved.headChars)
  assertNonNegativeInteger('tailChars', resolved.tailChars)

  const emittedChars = resolved.headChars
    + codePointLength(PRUNE_MARKER)
    + resolved.tailChars
  if (emittedChars > resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: headChars + marker + tailChars (${emittedChars}) `
      + `must be at most thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return deepFreeze(structuredClone(resolved))
}

/** Resolve and validate the earlier-result trimming policy. */
function resolveEarlierResults(config: EarlierResultTrimConfig): ResolvedEarlierResultTrimConfig {
  for (const key of Object.keys(config)) {
    if (!EARLIER_RESULT_KEYS.has(key)) {
      throw new Error(
        `ToolResultPruneConfig: unknown earlierResults key "${key}" `
        + '(allowed: enabled, thresholdChars, keepChars)',
      )
    }
  }
  const defaults = DEFAULTS.earlierResults
  const resolved: ResolvedEarlierResultTrimConfig = {
    enabled: config.enabled ?? defaults.enabled,
    thresholdChars: config.thresholdChars ?? defaults.thresholdChars,
    keepChars: config.keepChars ?? defaults.keepChars,
  }
  assertPositiveInteger('earlierResults.thresholdChars', resolved.thresholdChars)
  assertNonNegativeInteger('earlierResults.keepChars', resolved.keepChars)
  if (resolved.keepChars + TRIM_NOTE_MAX_CHARS >= resolved.thresholdChars) {
    throw new Error(
      `ToolResultPruneConfig: earlierResults.keepChars + note (${resolved.keepChars + TRIM_NOTE_MAX_CHARS}) `
      + `must be below earlierResults.thresholdChars (${resolved.thresholdChars})`,
    )
  }
  return resolved
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a positive integer`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ToolResultPruneConfig: ${name} (${value}) must be a non-negative integer`)
  }
}
