/**
 * ModelSelect's injected face. The target 'conversation.input.model' seat is
 * declared (children table) and typed by ui-conversation's composer-bar
 * entry; this package only contributes the single occupant, so no SlotMap
 * merge lives here.
 */
import type { RemoteResult } from '@ahel/dsh-typert-protocol'
import type { ModelSelection } from '@ahel/dsh-api-remotes/client'
import type { ObservableSnapshot, SnapshotStore } from '@ahel/dsh-client-store'
import type { ActiveBilling } from './billing.ts'
import type { ModelDirectoryState } from './directory.ts'

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns the Host outcome, or undefined when this Session cannot select a model.
   */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
  /** The registered metering account and its state; null without one. */
  billing: ObservableSnapshot<ActiveBilling | null>
  /** The Session's run state; the chip reads "held" while a turn runs. */
  session: ObservableSnapshot<{ readonly running: boolean }>
  /** Per-chat "Remember for this chat" choices, keyed by Session id. */
  remembered: ObservableSnapshot<Readonly<Record<string, boolean>>>
  /** This chat's key in {@link remembered}. */
  sessionKey: string
  /**
   * Store this chat's "Remember for this chat" choice.
   * @param on - true keeps the chat's own model.
   */
  setRemembered: (on: boolean) => void
  /**
   * Make this picker reachable by the open-picker shortcut.
   * @param open - opens the picker.
   * @returns the disposer.
   */
  registerOpener: (open: () => void) => () => void
  /** @returns the open-picker shortcut's effective keycaps; empty while unbound. */
  shortcutKeys: () => readonly string[]
}
