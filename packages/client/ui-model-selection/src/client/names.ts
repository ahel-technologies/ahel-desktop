/**
 * Short names, makers and "best for" lines for model ids the server sends no
 * facts for: bring-your-own-key routes and an ahel.ai without model facts. A
 * small static table recognises common families; any other id falls back to
 * its last path segment made readable ("deepseek-v4.1-flash" → "DeepSeek V4.1 Flash").
 */

/** Locale keys of the static "best for" lines. */
export type BestForKey =
  | 'bestFor.everyday' | 'bestFor.hard' | 'bestFor.quick' | 'bestFor.analysis' | 'bestFor.drafts'
  | 'bestFor.reasoning' | 'bestFor.longFiles' | 'bestFor.bulk' | 'bestFor.code'

/** What the client knows about one model id without server facts. */
export interface StaticModelFacts {
  readonly shortName: string
  /** Maker name, or undefined when the id names no known family. */
  readonly maker: string | undefined
  readonly bestFor: BestForKey | undefined
}

/** One family: a pattern over the normalized id, its maker and best-for line. */
interface Family {
  readonly match: RegExp
  readonly maker: string
  readonly bestFor?: BestForKey
}

/** Ordered: the first matching family wins, so narrower patterns come first. */
const FAMILIES: readonly Family[] = [
  { match: /^claude-.*opus/, maker: 'Anthropic', bestFor: 'bestFor.hard' },
  { match: /^claude-.*sonnet/, maker: 'Anthropic', bestFor: 'bestFor.everyday' },
  { match: /^claude-.*haiku/, maker: 'Anthropic', bestFor: 'bestFor.quick' },
  { match: /^claude/, maker: 'Anthropic' },
  { match: /^gpt-.*(mini|nano)/, maker: 'OpenAI', bestFor: 'bestFor.drafts' },
  { match: /^gpt-.*codex/, maker: 'OpenAI', bestFor: 'bestFor.code' },
  { match: /^gpt-/, maker: 'OpenAI', bestFor: 'bestFor.analysis' },
  { match: /^o\d/, maker: 'OpenAI', bestFor: 'bestFor.reasoning' },
  { match: /^gemini-.*flash/, maker: 'Google', bestFor: 'bestFor.longFiles' },
  { match: /^gemini-.*pro/, maker: 'Google', bestFor: 'bestFor.hard' },
  { match: /^gemini/, maker: 'Google' },
  { match: /^deepseek-(.*flash|chat)/, maker: 'DeepSeek', bestFor: 'bestFor.bulk' },
  { match: /^deepseek-(.*pro|reasoner|r\d)/, maker: 'DeepSeek', bestFor: 'bestFor.reasoning' },
  { match: /^deepseek/, maker: 'DeepSeek' },
  { match: /^grok/, maker: 'xAI' },
  { match: /^(mistral|codestral|magistral|devstral)/, maker: 'Mistral' },
  { match: /^(kimi|moonshot)/, maker: 'Moonshot' },
  { match: /^qwen/, maker: 'Qwen' },
  { match: /^glm/, maker: 'Z.ai' },
  { match: /^llama/, maker: 'Meta' },
]

/** Words with fixed casing; any other word is capitalized. */
const CASING: Readonly<Record<string, string>> = {
  gpt: 'GPT', deepseek: 'DeepSeek', glm: 'GLM', ai: 'AI', xai: 'xAI', oss: 'OSS', vl: 'VL', r1: 'R1',
}

/** Leading id prefixes that are routing, not part of the name ("openai/", "models/"). */
const PREFIX = /^.*\//

/** Trailing release dates (`-20250929`, `-2025-09-29`) and tags (`:free`, `-latest`). */
const SUFFIX = /(:[a-z0-9-]+|-latest|-\d{8}|-\d{4}-\d{2}-\d{2})$/

/**
 * Comparable identity of one model across routes: the last path segment,
 * lower case, dots as dashes, without release dates or tags.
 * @param id - provider-owned model id.
 * @returns the identity; `anthropic/claude-sonnet-5.5` and `claude-sonnet-5-5` match.
 */
export function modelIdentity(id: string): string {
  let base = id.trim().toLowerCase().replace(PREFIX, '')
  for (let previous = ''; previous !== base;) {
    previous = base
    base = base.replace(SUFFIX, '')
  }
  return base.replaceAll('.', '-').replaceAll('_', '-')
}

/**
 * The id's last path segment made readable: words capitalized, version
 * numbers joined with dots, and `GPT` joined to its version.
 * @param id - provider-owned model id.
 * @returns the readable name, e.g. "Claude Sonnet 4.5" for `claude-sonnet-4-5-20250929`.
 */
export function readableModelName(id: string): string {
  const words = modelIdentity(id).split('-').filter(word => word !== '')
  const out: string[] = []
  for (const word of words) {
    const previous = out.at(-1)
    if (/^\d+$/.test(word) && previous !== undefined && /\d$/.test(previous)) {
      out[out.length - 1] = `${previous}.${word}`
    } else if (/^v?\d+(\.\d+)?$/.test(word) && previous === 'GPT') {
      out[out.length - 1] = `GPT-${word}`
    } else if (/^o\d$/.test(word)) {
      out.push(word)
    } else {
      out.push(CASING[word] ?? (word.charAt(0).toUpperCase() + word.slice(1)))
    }
  }
  return out.join(' ')
}

/**
 * Facts for one id from the static table.
 * @param id - provider-owned model id.
 * @returns short name, maker (undefined for an unknown family) and best-for key.
 */
export function staticModelFacts(id: string): StaticModelFacts {
  const identity = modelIdentity(id)
  const family = FAMILIES.find(candidate => candidate.match.test(identity))
  return { shortName: readableModelName(id), maker: family?.maker, bestFor: family?.bestFor }
}
