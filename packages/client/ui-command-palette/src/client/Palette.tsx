/**
 * The palette dialog in `shell.overlay`: a search field over grouped rows.
 * Arrows move, Enter or a click runs the highlighted row, Escape or a click
 * outside closes. Each opening starts with an empty query.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { IconSearchOutlineRegular, MenuSurface, Modal, ShortcutKeys } from '@ahel/dsh-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@ahel/dsh-client-shortcuts/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { PaletteCommand, PaletteSection, PaletteState } from './registry.ts'
import css from './Palette.module.css'

/** The overlay's face over the registry. */
export interface PaletteInjected {
  /**
   * Rank the rows for the query.
   * @param query - the search text.
   * @returns the sections to show.
   */
  sections(query: string): readonly PaletteSection[]
  /** Close the palette and run a row. @param command - the chosen row. */
  run(command: PaletteCommand): void
  /** Close the palette without running anything. */
  close(): void
  hooks: {
    /** Open state and row revision. */
    palette: HostObservable<PaletteState>
    /** Effective key bindings, for the rows' keycaps. */
    shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>
  }
}

/** Props of the `shell.overlay` palette. */
export type PaletteProps = PropsRuntime<'shell.overlay'> & InjectFace<PaletteInjected> & PropsLocale<'command-palette'>

/**
 * Mount the dialog while the palette is open, so each opening starts fresh.
 * @param props - composed slot props.
 * @returns the dialog, or nothing while closed.
 */
export function CommandPalette(props: PaletteProps) {
  const open = props.usePalette(state => state.open)
  return open ? <PaletteDialog {...props} /> : null
}

/**
 * Title text with the query's hits marked.
 * @param text - the title.
 * @param highlights - hit positions.
 * @returns the rendered title.
 */
function Highlighted({ text, highlights }: { text: string; highlights: readonly number[] }): ReactNode {
  if (highlights.length === 0) return text
  const hits = new Set(highlights)
  const parts: ReactNode[] = []
  let run = ''
  let marked = false
  const flush = (): void => {
    if (run === '') return
    parts.push(marked ? <mark key={parts.length} className={css.hit}>{run}</mark> : run)
    run = ''
  }
  for (let index = 0; index < text.length; index++) {
    const hit = hits.has(index)
    if (hit !== marked) { flush(); marked = hit }
    run += text.charAt(index)
  }
  flush()
  return parts
}

/**
 * The open dialog: query, keyboard selection and the grouped list.
 * @param props - composed slot props.
 * @returns the modal.
 */
function PaletteDialog({ sections, run, close, usePalette, useShortcuts, t }: PaletteProps) {
  const revision = usePalette(state => state.revision)
  const catalog = useShortcuts(entries => entries)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)

  // `revision` moves when a source's rows land after the dialog opened.
  const shown = useMemo(() => sections(query), [sections, query, revision])
  const rows = useMemo(() => shown.flatMap(section => section.rows), [shown])
  const keysById = useMemo(() => new Map(catalog.map(entry => [entry.id as string, entry.keys] as const)), [catalog])
  const current = rows.length === 0 ? -1 : Math.min(active, rows.length - 1)

  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    const node = list.current?.querySelector<HTMLElement>(`[data-index="${String(current)}"]`)
    // jsdom has no scrollIntoView.
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [current])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + rows.length) % rows.length)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const row = rows[current]
      if (row !== undefined) run(row.command)
    }
  }

  let index = 0
  return (
    <Modal open onClose={close} title={t('dialog')} headless shortcutModal="command-palette" className={css.dialog ?? ''}>
      <div className={css.search}>
        <IconSearchOutlineRegular size={16} className={css.searchIcon} />
        <input
          data-modal-autofocus
          className={css.input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={current < 0 ? undefined : `${listId}-${String(current)}`}
          aria-label={t('dialog')}
          placeholder={t('placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={onKeyDown}
        />
      </div>
      <MenuSurface ref={list} id={listId} role="listbox" aria-label={t('dialog')} className={css.list}>
        {rows.length === 0 && <div className={css.empty}>{t('empty')}</div>}
        {shown.map(section => (
          <Fragment key={section.id}>
            <div role="presentation" className={css.group}>{section.label}</div>
            {section.rows.map((row) => {
              const position = index++
              const keys = row.command.shortcut === undefined ? undefined : keysById.get(row.command.shortcut)
              return (
                <div
                  key={`${section.id}:${row.command.id}`}
                  id={`${listId}-${String(position)}`}
                  data-index={position}
                  role="option"
                  aria-selected={position === current}
                  className={css.row}
                  onMouseMove={() => { if (position !== current) setActive(position) }}
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={() => { run(row.command) }}
                >
                  <span className={css.title}><Highlighted text={row.command.title} highlights={row.highlights} /></span>
                  {row.command.active === true && <span className={css.badge}>{t('current')}</span>}
                  {row.command.subtitle !== undefined && <span className={css.subtitle}>{row.command.subtitle}</span>}
                  {keys !== undefined && keys.length > 0 && <ShortcutKeys keys={keys} className={css.keys} />}
                </div>
              )
            })}
          </Fragment>
        ))}
      </MenuSurface>
      <div className={css.footer} aria-hidden="true">
        <span><kbd className={css.kbd}>↑</kbd><kbd className={css.kbd}>↓</kbd> {t('hintMove')}</span>
        <span><kbd className={css.kbd}>↵</kbd> {t('hintRun')}</span>
        <span><kbd className={css.kbd}>{t('keyEscape')}</kbd> {t('hintClose')}</span>
      </div>
    </Modal>
  )
}
