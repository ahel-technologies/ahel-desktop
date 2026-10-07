/**
 * The quiet banner that announces a run this desktop picked up from ahel.ai:
 * the pickup opens the run's chat without changing the person's view, and this
 * `shell.overlay` entry names the issue with an action that shows the chat.
 */
import type { ReactNode } from 'react'
import { Toast } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-layout/client'

/** One announced pickup; `seq` keys the banner so a later pickup restarts it. */
export interface PickupToastState {
  readonly key: string
  readonly sessionId: string
  readonly seq: number
}

/** The store the pickup reports into and the overlay entry reads. */
export interface PickupToastSource {
  /** The banner on display, or null. */
  readonly hooks: { readonly toast: HostObservable<PickupToastState | null> }
  /**
   * Announce one picked-up run.
   * @param key - the issue key.
   * @param sessionId - the chat the run happens in.
   */
  readonly show: (key: string, sessionId: string) => void
  /** Clear the banner. */
  readonly dismiss: () => void
}

/**
 * Create the pickup banner store.
 * @returns the observable banner with its show and dismiss actions.
 */
export function createPickupToast(): PickupToastSource {
  let state: PickupToastState | null = null
  let seq = 0
  const listeners = new Set<() => void>()
  const publish = (next: PickupToastState | null): void => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    hooks: {
      toast: {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    show: (key, sessionId) => { publish({ key, sessionId, seq: ++seq }) },
    dismiss: () => { publish(null) },
  }
}

/** Props of the `shell.overlay` entry. */
export type PickupToastProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'ahel-issues'>
  & InjectFace<Omit<PickupToastSource, 'show'> & { readonly openSession: (sessionId: string) => void }>

/**
 * Render the pickup banner with its Open action.
 * @param props - the banner hook, dismissal, the chat opener and the dictionary.
 * @returns the banner on display, or null.
 */
export function PickupToast({ useToast, dismiss, openSession, t }: PickupToastProps): ReactNode {
  const toast = useToast(current => current)
  if (toast === null) return null
  return (
    <Toast
      key={`ahel-issues-pickup-${String(toast.seq)}`}
      text={t('runPickedUp', { key: toast.key })}
      holdMs={6000}
      actions={[{ label: t('runPickedUpOpen'), onClick: () => { openSession(toast.sessionId); dismiss() } }]}
      onDone={dismiss}
    />
  )
}
