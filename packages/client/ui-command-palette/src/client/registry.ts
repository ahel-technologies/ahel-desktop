/**
 * The palette's command registry: sources contribute grouped rows, the
 * registry ranks them against the query with a fuzzy subsequence score, keeps
 * the person's recently run rows first, and owns the open state the overlay
 * renders from. It holds no DOM or React state, so tests and other packages
 * drive it directly.
 */
import type { HostObservable } from '@ahel/dsh-client-ui-slots'

/** One runnable palette row. */
export interface PaletteCommand {
  /** Stable across openings; the recent list keys on it. */
  readonly id: string
  /** Resolved display text; the query matches it first. */
  readonly title: string
  /** Secondary text shown at the row's end. */
  readonly subtitle?: string
  /** Further words the query matches, ranked below a title match. */
  readonly keywords?: readonly string[]
  /** `ctx.shortcuts` command id whose effective keys the row shows. */
  readonly shortcut?: string
  /** Epoch ms ordering the group while the query is empty, newest first. */
  readonly recency?: number
  /** Marks the current choice, such as the session's model or the theme. */
  readonly active?: boolean
  /** Perform the row's action after the palette closes; a rejection is logged. */
  run(): void | Promise<void>
}

/** One group of rows contributed by a package. */
export interface PaletteSource {
  /** Unique source id; a second registration under the same id throws. */
  readonly id: string
  /** Group header text, read at render time so it follows the locale. */
  readonly label: () => string
  /** Group position while the query is empty; lower first. */
  readonly order: number
  /** Most rows shown while the query is empty; absent shows every row. */
  readonly limit?: number
  /** Refresh asynchronous data when the palette opens; call `invalidate` when it lands. */
  open?(): void
  /** @returns the group's current rows. */
  items(): readonly PaletteCommand[]
}

/** Open state and a counter that moves whenever rows may have changed. */
export interface PaletteState {
  readonly open: boolean
  readonly revision: number
}

/** One matched row and the title positions the query hit. */
export interface PaletteRow {
  readonly command: PaletteCommand
  readonly highlights: readonly number[]
}

/** One rendered group. */
export interface PaletteSection {
  readonly id: string
  readonly label: string
  readonly rows: readonly PaletteRow[]
}

/** Extension point other packages use through `ctx.commandPalette`. */
export interface CommandPalette {
  /**
   * Contribute one group of rows.
   * @param source - the group; its id must be unique.
   * @returns disposer removing the group.
   */
  register(source: PaletteSource): () => void
  /** Signal that a source's rows changed, for example after an asynchronous read. */
  invalidate(): void
  /** Show the palette; every source's `open` runs first. */
  open(): void
  /** Hide the palette. */
  close(): void
  /** Show the palette, or hide it when it is showing. */
  toggle(): void
  /** Open state and revision for renderers. */
  readonly state: HostObservable<PaletteState>
}

/** Remembered run times, newest last; the store may be unavailable. */
export interface RecentStore {
  /** @returns command id to last run time. */
  read(): ReadonlyMap<string, number>
  /** @param id - the command just run. */
  touch(id: string): void
}

/** Section id of the recently run rows. */
export const RECENT_SECTION = 'recent'

/** Rows the Recent group shows. */
const RECENT_LIMIT = 5

/** Recent run ids kept. */
const RECENT_KEEP = 30

/** Characters that start a word after them. */
const SEPARATOR = /[\s\-_/.:·,()[\]]/

/**
 * Score a query against one text as a case-insensitive subsequence.
 * A contiguous hit beats a scattered one; hits at word starts and at the
 * beginning score higher; whitespace in the query matches anything.
 * @param query - the person's text.
 * @param text - the candidate.
 * @returns the score and hit positions, or null when the query is not a subsequence.
 */
export function fuzzyMatch(query: string, text: string): { score: number; highlights: number[] } | null {
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (needle === '') return { score: 0, highlights: [] }
  const hay = text.toLowerCase()
  const wordStart = (index: number): boolean => index === 0 || SEPARATOR.test(hay[index - 1] ?? '')
  const contiguous = hay.indexOf(needle)
  if (contiguous >= 0) {
    const highlights = Array.from({ length: needle.length }, (_, offset) => contiguous + offset)
    const score = 100 + (contiguous === 0 ? 40 : 0) + (wordStart(contiguous) ? 20 : 0) - contiguous - (hay.length - needle.length) * 0.05
    return { score, highlights }
  }
  const highlights: number[] = []
  let score = 0
  let from = 0
  for (const char of needle) {
    // Prefer the next word start holding the character, else its next occurrence.
    let at = -1
    for (let index = hay.indexOf(char, from); index >= 0; index = hay.indexOf(char, index + 1)) {
      if (at < 0) at = index
      if (wordStart(index)) { at = index; break }
      if (highlights.length > 0 && index === (highlights.at(-1) ?? -2) + 1) { at = index; break }
    }
    if (at < 0) return null
    const previous = highlights.at(-1)
    score += 1 + (wordStart(at) ? 6 : 0) + (previous !== undefined && at === previous + 1 ? 5 : 0)
    score -= previous === undefined ? at * 0.2 : (at - previous - 1) * 0.3
    highlights.push(at)
    from = at + 1
  }
  return { score, highlights }
}

/**
 * Score one command against the query: the title first, keywords and subtitle below it.
 * @param query - the person's text.
 * @param command - the candidate row.
 * @returns the score and title positions, or null when nothing matches.
 */
function matchCommand(query: string, command: PaletteCommand): { score: number; highlights: number[] } | null {
  const title = fuzzyMatch(query, command.title)
  let best = title
  for (const extra of [...(command.keywords ?? []), ...(command.subtitle === undefined ? [] : [command.subtitle])]) {
    const hit = fuzzyMatch(query, extra)
    const score = hit === null ? null : hit.score * 0.7
    if (score !== null && (best === null || score > best.score)) best = { score, highlights: title?.highlights ?? [] }
  }
  return best
}

/**
 * Rank every source's rows against the query.
 * Empty query: a Recent group first, then the groups in source order, each
 * ordered by recency and cut to its limit. Otherwise: every match, recently
 * run rows boosted, groups ordered by their best match.
 * @param sources - registered groups.
 * @param query - the person's text.
 * @param recent - last run time by command id.
 * @param recentLabel - the Recent group header.
 * @returns the sections to render, without empty ones.
 */
export function rankSections(
  sources: readonly PaletteSource[],
  query: string,
  recent: ReadonlyMap<string, number>,
  recentLabel: string,
): PaletteSection[] {
  const ordered = [...sources].sort((a, b) => a.order - b.order)
  const groups = ordered.map(source => ({ source, items: safeItems(source) }))
  if (query.trim() === '') {
    const byId = new Map(groups.flatMap(group => group.items.map(command => [command.id, command] as const)))
    const recentIds = [...recent.entries()]
      .filter(([id]) => byId.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, RECENT_LIMIT)
      .map(([id]) => id)
    const shown = new Set(recentIds)
    const sections: PaletteSection[] = []
    if (recentIds.length > 0) {
      sections.push({
        id: RECENT_SECTION, label: recentLabel,
        rows: recentIds.flatMap((id) => {
          const command = byId.get(id)
          return command === undefined ? [] : [{ command, highlights: [] }]
        }),
      })
    }
    for (const { source, items } of groups) {
      const rows = items
        .filter(command => !shown.has(command.id))
        .map((command, index) => ({ command, index }))
        .sort((a, b) => (b.command.recency ?? 0) - (a.command.recency ?? 0) || a.index - b.index)
        .slice(0, source.limit ?? Number.POSITIVE_INFINITY)
        .map(({ command }) => ({ command, highlights: [] }))
      if (rows.length > 0) sections.push({ id: source.id, label: source.label(), rows })
    }
    return sections
  }
  const now = Date.now()
  const scored = groups.map(({ source, items }) => {
    const rows = items.flatMap((command) => {
      const hit = matchCommand(query, command)
      if (hit === null) return []
      const ran = recent.get(command.id)
      // A row run in the last week gains up to 10 points, fading with age.
      const boost = ran === undefined ? 0 : Math.max(0, 10 - (now - ran) / 60_480_000)
      return [{ command, highlights: hit.highlights, score: hit.score + boost }]
    }).sort((a, b) => b.score - a.score)
    return { source, rows, best: rows[0]?.score ?? Number.NEGATIVE_INFINITY }
  }).filter(group => group.rows.length > 0)
  scored.sort((a, b) => b.best - a.best || a.source.order - b.source.order)
  return scored.map(({ source, rows }) => ({
    id: source.id, label: source.label(), rows: rows.map(({ command, highlights }) => ({ command, highlights })),
  }))
}

/**
 * Read a source's rows without letting one failing source empty the palette.
 * @param source - the group.
 * @returns its rows, or none when it throws.
 */
function safeItems(source: PaletteSource): readonly PaletteCommand[] {
  try {
    return source.items()
  } catch (error) {
    console.warn(`command palette: source "${source.id}" failed`, error)
    return []
  }
}

/**
 * Recent run times in origin-local storage; reads and writes that the
 * browser refuses fall back to memory for this window.
 * @param storage - returns the window's storage, or throws when it is blocked.
 * @param key - the storage key.
 * @returns the recent store.
 */
export function recentStore(storage: () => Storage, key: string): RecentStore {
  let memory: Map<string, number> | null = null
  const load = (): Map<string, number> => {
    if (memory !== null) return memory
    memory = new Map()
    try {
      const raw = storage().getItem(key)
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') memory.set(entry[0], entry[1])
        }
      }
    } catch (_unreadable) {
      // Blocked or corrupt storage: start an in-memory list for this window.
    }
    return memory
  }
  return {
    read: () => load(),
    touch: (id) => {
      const map = load()
      map.delete(id)
      map.set(id, Date.now())
      while (map.size > RECENT_KEEP) map.delete(map.keys().next().value ?? '')
      try {
        storage().setItem(key, JSON.stringify([...map.entries()]))
      } catch (_blocked) {
        // Storage refused the write; the list still holds for this window.
      }
    },
  }
}

/** The registry behind `ctx.commandPalette` and the overlay. */
export class PaletteRegistry implements CommandPalette {
  private readonly sources = new Map<string, PaletteSource>()
  private readonly listeners = new Set<() => void>()
  private value: PaletteState = { open: false, revision: 0 }

  /** Open state and revision for renderers. */
  readonly state: HostObservable<PaletteState> = {
    getSnapshot: () => this.value,
    subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
  }

  /** @param recent - where run times are remembered. */
  constructor(private readonly recent: RecentStore) {}

  register(source: PaletteSource): () => void {
    if (this.sources.has(source.id)) throw new Error(`command palette: duplicate source "${source.id}"`)
    this.sources.set(source.id, source)
    this.invalidate()
    return () => {
      if (this.sources.get(source.id) !== source) return
      this.sources.delete(source.id)
      this.invalidate()
    }
  }

  invalidate(): void {
    this.publish({ ...this.value, revision: this.value.revision + 1 })
  }

  open(): void {
    if (this.value.open) return
    for (const source of this.sources.values()) {
      try {
        source.open?.()
      } catch (error) {
        console.warn(`command palette: source "${source.id}" failed to refresh`, error)
      }
    }
    this.publish({ open: true, revision: this.value.revision + 1 })
  }

  close(): void {
    if (this.value.open) this.publish({ ...this.value, open: false })
  }

  toggle(): void {
    if (this.value.open) this.close()
    else this.open()
  }

  /**
   * Rank every registered row against the query.
   * @param query - the person's text.
   * @param recentLabel - the Recent group header.
   * @returns the sections to render.
   */
  sections(query: string, recentLabel: string): PaletteSection[] {
    return rankSections([...this.sources.values()], query, this.recent.read(), recentLabel)
  }

  /**
   * Remember the row, close the palette, then run the row's action once the dialog has handed focus back.
   * @param command - the chosen row.
   */
  run(command: PaletteCommand): void {
    this.recent.touch(command.id)
    this.close()
    queueMicrotask(() => {
      try {
        const result = command.run()
        if (result instanceof Promise) result.catch((error: unknown) => { console.warn(`command palette: "${command.id}" failed`, error) })
      } catch (error) {
        console.warn(`command palette: "${command.id}" failed`, error)
      }
    })
  }

  private publish(next: PaletteState): void {
    this.value = next
    for (const listener of this.listeners) listener()
  }
}
