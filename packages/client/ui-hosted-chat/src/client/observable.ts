/** Small observables behind the hosted chat face: a settable cell and a relay that follows a source once one exists. */
import type { HostObservable } from '@ahel/dsh-client-ui-slots'

/** An observable value this plugin sets. */
export interface Cell<T> extends HostObservable<T> {
  /** @param next - the new value; listeners run only when it differs. */
  set(next: T): void
}

/**
 * Create a cell.
 * @param initial - the value before the first `set`.
 * @returns the cell.
 */
export function cell<T>(initial: T): Cell<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}

/** An observable that reads `initial` until a source is bound, then the source. */
export interface Relay<T> extends HostObservable<T> {
  /**
   * Follow a source until the returned disposer runs.
   * @param source - the observable to read.
   * @returns the unbind, which falls back to `initial`.
   */
  bind(source: HostObservable<T>): () => void
}

/**
 * Create a relay.
 * @param initial - the value while no source is bound.
 * @returns the relay.
 */
export function relay<T>(initial: T): Relay<T> {
  let source: HostObservable<T> | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => source === null ? initial : source.getSnapshot(),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    bind: (next) => {
      source = next
      const off = next.subscribe(notify)
      notify()
      return () => {
        off()
        if (source === next) source = null
        notify()
      }
    },
  }
}
