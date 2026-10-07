/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * A quiet trigger shows the current model's short name, followed by the
 * balance chip: the workspace balance for a metered model, "held" from send
 * until the request settles, and "your key" on the person's own key. The
 * menu opens at once on one list grouped by maker; each row shows the short
 * name, a "best for" line, the typical message price and where it is billed.
 * A model offered both metered and on an own key is one row with a billing
 * switch. The footer holds "Remember for this chat" and the effort levels.
 * Search keeps focus while ↑/↓ move the highlight; Enter and Tab pick it;
 * Escape and Shift+Tab close back to the trigger. Data and submission ride
 * the same per-session ModelDirectory as the /model popup. A rejected
 * selection announces through the shared Toast anchored to the composer card.
 */
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCloseFillRegular, IconDataOutlineRegular, IconWarningOutlineRegular,
  Input, MenuGroup, MenuSurface, observeStickyMenuGroups, ShortcutKeys, StateDot, Switch, Toast,
} from '@ahel/dsh-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type FocusEvent, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ModelReasoning, ModelSelection } from '@ahel/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@ahel/dsh-client-store'
import type { PropsLocale } from '@ahel/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import { balanceChip, formatCents, formatPrice, type ActiveBilling, type ModelBillingFrame } from './billing.ts'
import { connectingProvider } from './directory.ts'
import { pickerGroups, preferredRoute, rowOf, routeOf, searchGroups, type PickerRoute, type PickerRow } from './rows.ts'
import css from './ModelSelect.module.css'

type Translate = PropsLocale<'model'>['t']

/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real (Menu primitive's measure pass). */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** One effort choice; undefined keeps the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

function useStore<T>(store: ObservableSnapshot<T>): T {
  return useSyncExternalStore(fn => store.subscribe(fn), () => store.getSnapshot())
}

/**
 * The localized "best for" line of a row.
 * @param row - picker row.
 * @param t - model translate.
 * @returns the line, or undefined when nothing is known.
 */
export function bestForText(row: PickerRow, t: Translate): string | undefined {
  if (row.bestFor === undefined) return undefined
  if ('key' in row.bestFor) return t(row.bestFor.key)
  return /^best for /i.test(row.bestFor.text) ? row.bestFor.text : t('bestFor.server', { text: row.bestFor.text })
}

/**
 * Where a route is billed.
 * @param route - the route.
 * @param billing - the metering source.
 * @param t - model translate.
 * @returns "ahel · billed to the workspace" or "billed by DeepSeek".
 */
export function billedText(route: PickerRoute, billing: ActiveBilling | null, t: Translate): string {
  return route.metered && billing !== null
    ? t('billing.metered', { name: billing.state.name })
    : t('billing.own', { provider: route.providerName })
}

function effortChoices(reasoning: ModelReasoning | undefined, t: Translate): EffortChoice[] {
  if (reasoning === undefined) return []
  return [
    ...reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }] : [],
    ...reasoning.efforts.map(effort => ({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name })),
  ]
}

/**
 * Render the composer model seat: trigger, balance chip and the picker.
 * @param props - owner share (locked), injected face, and the locale seat.
 * @returns the seat.
 */
export function ModelSelect(props: ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>) {
  const {
    locked, available, directory, load, select, billing, session, remembered, sessionKey, setRemembered, registerOpener, shortcutKeys, t,
  } = props
  const state = useStore(directory)
  const active = useStore(billing)
  const { running } = useStore(session)
  const rememberMap = useStore(remembered)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [selectionFocus, setSelectionFocus] = useState(false)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const [turnStart, setTurnStart] = useState<{ frame: ModelBillingFrame | null } | null>(null)
  const toastSeq = useRef(0)
  const lastActionRef = useRef<'load' | 'select'>('load')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const groupsRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()

  const groups = useMemo(() => pickerGroups(state.groups, active), [state.groups, active])
  const visible = useMemo(() => searchGroups(groups, query), [groups, query])
  const flat = useMemo(() => visible.flatMap(group => group.rows), [visible])
  const current = rowOf(groups, state.current)
  const currentIndex = flat.findIndex(row => routeOf(row, state.current) !== undefined)
  const activeIndex = flat.length === 0 ? -1 : Math.min(highlighted ?? Math.max(0, currentIndex), flat.length - 1)
  const reasoning = current?.route.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const efforts = useMemo(() => effortChoices(reasoning, t), [reasoning, t])
  const effortLabel = reasoning === undefined
    ? state.retainedEffort
    : efforts.find(choice => choice.effort === effectiveEffort)?.label ?? effectiveEffort ?? t('effort.providerDefault')
  const { pending } = state
  const busy = pending !== null
  const defaultModel = active?.state.signedIn === true ? active.state.defaultModel : undefined
  const defaultRow = typeof defaultModel === 'string' && active !== null
    ? rowOf(groups, { provider: active.provider, model: defaultModel })?.row
    : undefined
  const rememberOn = rememberMap[sessionKey]
    ?? (defaultRow !== undefined && current !== undefined && !(current.route.metered && current.route.model === defaultModel))

  // The chip's turn: the frame seen when the turn started, so only later frames count for it.
  const frame = active?.state.frame ?? null
  // Only the run flag starts and ends a turn; the refs give the effect the latest frame and source.
  const latest = useRef({ turnStart, frame, active, sessionKey })
  latest.current = { turnStart, frame, active, sessionKey }
  useEffect(() => {
    const now = latest.current
    if (running) {
      if (now.turnStart === null) setTurnStart({ frame: now.frame })
      return
    }
    if (now.turnStart === null) return
    setTurnStart(null)
    const settled = now.frame !== now.turnStart.frame && now.frame?.phase === 'settled'
      && (now.frame.sessionId === null || now.frame.sessionId === now.sessionKey)
    if (!settled) now.active?.refreshBalance()
  }, [running])
  const turnFrame = turnStart !== null && frame !== turnStart.frame && (frame?.sessionId === null || frame?.sessionId === sessionKey)
    ? frame
    : null
  const chip = balanceChip(active, state.current?.provider, running, turnFrame)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useEffect(() => {
    const viewport = groupsRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [open, visible])

  useLayoutEffect(() => {
    if (open && activeIndex >= 0) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  /* jscpd:ignore-start -- deliberate mirror of ui-primitives useAnchoredPosition:
     that hook only places from the anchor's LEFT edge, while this card aligns
     right edges (x = rect.right - width), so the measure-and-clamp plumbing repeats. */
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    const place = (): void => {
      /* v8 ignore next 2 -- the trigger ref is attached whenever the menu is open. */
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const MARGIN = 12
      const lw = menuRef.current?.offsetWidth ?? 0
      const lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - lw
      let y = rect.top - 8 - lh
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN)
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, state, query])
  /* jscpd:ignore-end */

  const show = (): void => {
    setSelectionFocus(false)
    setQuery('')
    setHighlighted(null)
    setOpen(true)
    lastActionRef.current = 'load'
    load()
  }
  const showRef = useRef(show)
  showRef.current = show
  useEffect(() => available && !locked ? registerOpener(() => { showRef.current() }) : undefined, [available, locked, registerOpener])

  if (!available) return null

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const settleSelection = (result: Awaited<ReturnType<ModelSelectInjected['select']>>): boolean => {
    if (result === undefined) return false
    if (result.ok) {
      if (rootRef.current !== null) {
        setSelectionFocus(true)
        close(true)
      }
      return true
    }
    const { error } = result
    toastSeq.current += 1
    setToast({
      seq: toastSeq.current,
      text: error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error.code}: ${error.message}` }),
    })
    return false
  }

  const submit = (selection: ModelSelection, after?: () => void): void => {
    lastActionRef.current = 'select'
    setSelectionFocus(true)
    triggerRef.current?.focus()
    void select(selection).then((result) => { if (settleSelection(result)) after?.() })
  }

  const choose = (route: PickerRoute): void => {
    const following = defaultRow !== undefined
    const isDefault = route.metered && route.model === defaultModel
    if (state.current?.provider === route.provider && state.current.model === route.model) {
      setSelectionFocus(true)
      close(true)
      return
    }
    const effort = route.reasoning?.defaultEffort
    submit({ provider: route.provider, model: route.model, ...effort === undefined ? {} : { reasoningEffort: effort } }, () => {
      // Picking another model keeps it for this chat; picking the default follows the default again.
      if (following) setRemembered(!isDefault)
    })
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null || effectiveEffort === effort) return
    lastActionRef.current = 'select'
    const { provider, model } = state.current
    void select({ provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } })
      .then((result) => { if (result !== undefined && !result.ok) settleSelection(result) })
  }

  const toggleRemember = (on: boolean): void => {
    setRemembered(on)
    const route = defaultRow?.metered
    if (on || route === undefined || routeOf(defaultRow as PickerRow, state.current) !== undefined) return
    const effort = route.reasoning?.defaultEffort
    lastActionRef.current = 'select'
    void select({ provider: route.provider, model: route.model, ...effort === undefined ? {} : { reasoningEffort: effort } })
      .then((result) => { if (result !== undefined && !result.ok) settleSelection(result) })
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || !open) return
    if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!busy && flat.length > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlighted((activeIndex + direction + flat.length) % flat.length)
        searchRef.current?.focus()
      }
      return
    }
    if (event.target === searchRef.current && (event.key === 'Enter' || event.key === 'Tab')) {
      const row = flat[activeIndex]
      if (row === undefined) return
      event.preventDefault()
      if (!busy) choose(preferredRoute(row, state.current))
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && (
      rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true
    )) return
    close()
  }

  const waiting = state.current === null && state.status === 'loading'
  const connecting = connectingProvider(state) !== undefined
  const noModels = state.current === null && state.status === 'ready' && groups.length === 0
  const modelLabel = waiting
    ? t('trigger.loading')
    : connecting
      ? t('trigger.connecting')
      : noModels
        ? t('trigger.empty')
        : current?.row.shortName ?? (state.current === null ? t('trigger.fallback') : `${state.current.provider}/${state.current.model}`)
  const triggerAria = waiting || connecting || noModels
    ? modelLabel
    : state.current === null
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  const keys = shortcutKeys()
  const triggerTitle = keys.length === 0 ? modelLabel : t('trigger.title', { keys: keys.join('') })
  const anyPrice = groups.some(group => group.rows.some(row => row.metered !== undefined))
  const onOwnKey = current !== undefined && !current.route.metered
  const balanceCents = active?.state.signedIn === true ? active.state.balanceCents : null

  rowRefs.current = []
  let rowIndex = 0

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
      onMouseDown={(event) => {
        // WebKit blurs a focused control before click unless the button's mousedown keeps focus.
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerTitle}
        aria-busy={busy}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => { if (open) close(true); else show() }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        <span className={css.triggerLabel}>{modelLabel}</span>
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>
      <BalanceChipView chip={chip} provider={current?.route.providerName} t={t} />

      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={menuPos ?? MEASURE_STYLE}
          role="group"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          <div className={css.searchRow}>
            <Input
              ref={searchRef}
              className={clsx(css.search, query !== '' && css.searchWithQuery)}
              type="text"
              role="searchbox"
              aria-label={t('search.placeholder')}
              aria-controls={`${id}-models`}
              aria-activedescendant={activeIndex < 0 ? undefined : `${id}-row-${String(activeIndex)}`}
              placeholder={t('search.placeholder')}
              value={query}
              readOnly={busy}
              onChange={(event) => { setQuery(event.target.value); setHighlighted(0) }}
            />
            {query !== ''
              ? (
                <button type="button" className={css.searchClear} aria-label={t('search.clear')} disabled={busy}
                  onClick={() => { setQuery(''); setHighlighted(0); searchRef.current?.focus() }}>
                  <IconCloseFillRegular />
                </button>
              )
              : keys.length > 0 && <ShortcutKeys keys={keys} className={css.searchKeys} />}
          </div>
          {state.status === 'loading' && <div className={css.status}>{t('status.loading')}</div>}
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={() => { lastActionRef.current = 'load'; load() }}>{t('action.reload')}</button>
            </div>
          )}
          {state.failures.map(failure => (
            <div key={failure.id} className={css.warning}>
              <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
              <button type="button" className={css.retry} onClick={() => { lastActionRef.current = 'load'; load() }}>{t('action.reload')}</button>
            </div>
          ))}
          <div ref={groupsRef} id={`${id}-models`} className={clsx(css.groups, 'scrollable')} role="menu" aria-label={t('menu.models')}
            hidden={visible.length === 0}>
            {visible.map((group, groupIndex) => (
              <MenuGroup key={group.maker} label={group.maker}>
                {groupIndex === 0 && anyPrice && <span className={css.priceHeader} aria-hidden="true">{t('price.header')}</span>}
                {group.rows.map((row) => {
                  const index = rowIndex++
                  const used = routeOf(row, state.current)
                  const route = preferredRoute(row, state.current)
                  const pendingHere = pending !== null
                    && [row.metered, row.own].some(r => r?.provider === pending.provider && r.model === pending.model)
                  const best = bestForText(row, t)
                  return (
                    <div
                      key={row.key}
                      ref={(node) => { rowRefs.current[index] = node }}
                      id={`${id}-row-${String(index)}`}
                      role="menuitemradio"
                      aria-checked={used !== undefined}
                      aria-disabled={busy}
                      tabIndex={-1}
                      data-highlighted={index === activeIndex ? '' : undefined}
                      className={clsx(css.row, index === activeIndex && css.rowActive)}
                      title={row.lastChargeCents === undefined || !route.metered
                        ? undefined
                        : t('price.lastCharge', { price: formatPrice(row.lastChargeCents) })}
                      onMouseMove={busy || index === activeIndex ? undefined : () => { setHighlighted(index) }}
                      onClick={() => { if (!busy) choose(route) }}
                    >
                      <span className={css.check}>
                        {pendingHere ? <StateDot state="ongoing" /> : used !== undefined ? <IconCheckOutlineRegular /> : null}
                      </span>
                      <span className={css.rowName}>
                        {row.shortName}
                        {defaultRow?.key === row.key && <span className={css.defaultBadge}>{t('default.badge')}</span>}
                      </span>
                      <span className={clsx(css.rowPrice, !route.metered && css.rowPriceKey)}>
                        {route.metered
                          ? row.typicalCents === undefined ? null : formatPrice(row.typicalCents)
                          : t('price.ownKey')}
                      </span>
                      {best !== undefined && <span className={css.rowHint}>{best}</span>}
                      {row.metered !== undefined && row.own !== undefined
                        ? (
                          <span className={css.billingSwitch} role="group" aria-label={t('billing.switch', { model: row.shortName })}>
                            {[row.metered, row.own].map(option => (
                              <button
                                key={option.provider}
                                type="button"
                                aria-pressed={route.provider === option.provider}
                                disabled={busy}
                                onClick={(event) => { event.stopPropagation(); choose(option) }}
                              >
                                {option.metered ? billedText(option, active, t) : t('billing.switchOwn')}
                              </button>
                            ))}
                          </span>
                        )
                        : <span className={clsx(css.rowSource, !route.metered && css.rowSourceKey)}>{billedText(route, active, t)}</span>}
                    </div>
                  )
                })}
              </MenuGroup>
            ))}
          </div>
          {state.status === 'ready' && visible.length === 0 && (
            <div className={css.empty} role="status">{t(groups.length === 0 ? 'empty.models' : 'search.empty')}</div>
          )}
          {(current !== undefined || (active !== null && anyPrice)) && <div className={css.foot}>
            {defaultRow !== undefined && current !== undefined && (
              <div className={css.footRow}>
                <span className={css.footLabel}>
                  {t('remember.label')}
                  <small>{rememberOn
                    ? t('remember.on', { model: current.row.shortName, default: defaultRow.shortName })
                    : t('remember.off')}</small>
                </span>
                <Switch checked={rememberOn} label={t('remember.label')} disabled={busy} onChange={toggleRemember} />
              </div>
            )}
            {current !== undefined && (
              <div className={css.footRow}>
                <span className={css.footLabel}>{t('menu.effort')}</span>
                {efforts.length === 0
                  ? <span className={css.footNote}>{t('effort.none')}</span>
                  : (
                    <span className={css.efforts} role="group" aria-label={t('menu.effort')}>
                      {efforts.map(choice => (
                        <button key={choice.key} type="button" aria-pressed={effectiveEffort === choice.effort} disabled={busy}
                          onClick={() => { chooseEffort(choice.effort) }}>
                          {choice.label}
                        </button>
                      ))}
                    </span>
                  )}
              </div>
            )}
            {active !== null && anyPrice && (
              <p className={css.fine}>
                {onOwnKey
                  ? t('fine.own', { name: active.state.name })
                  : `${t('fine.metered', { name: active.state.name })}${balanceCents === null ? '' : ` ${t('fine.balance', { balance: formatCents(balanceCents) })}`}`}
              </p>
            )}
          </div>}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}

/**
 * The balance chip beside the trigger.
 * @param props - the chip state, the own-key provider name and translate.
 * @returns the chip, or nothing when hidden.
 */
export function BalanceChipView(
  { chip, provider, t }: { chip: ReturnType<typeof balanceChip>; provider: string | undefined; t: Translate },
) {
  switch (chip.kind) {
    case 'hidden':
      return null
    case 'key':
      return (
        <span className={clsx(css.chip, css.chipKey)} title={t('chip.keyTitle', { provider: provider ?? '' })}>
          <span className={css.chipDot} aria-hidden="true" />{t('chip.key')}
        </span>
      )
    case 'held':
      return (
        <span className={clsx(css.chip, css.chipHeld)} role="status"
          title={chip.heldCents === null ? t('chip.heldTitleUnknown') : t('chip.heldTitle', { amount: formatPrice(chip.heldCents) })}>
          <span className={css.chipDot} aria-hidden="true" />{t('chip.held')}
        </span>
      )
    case 'balance':
      return (
        <span className={css.chip} role="status" title={t('chip.balanceTitle')}>
          <span className={css.chipDot} aria-hidden="true" />{formatCents(chip.cents)}
        </span>
      )
  }
}
