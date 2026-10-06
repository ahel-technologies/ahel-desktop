/** Injected face and prop types of the computer-use registrations. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { PendingApproval } from '@ahel/dsh-client-ui-approval/client'
import type { ComputerUseCard, ComputerUseView } from '@ahel/dsh-computer-use-action-gate/types'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type {} from './locales.ts'

/** Host access shared by the card, the dock and the Settings row. */
export interface ComputerUseInjected {
  /**
   * Read the card for one pending write.
   * @param callId - the tool call waiting for approval.
   * @returns the card, or null when the call is no longer waiting.
   */
  card(callId: string): Promise<ComputerUseCard | null>
  /** Kill switch: cancel every turn using computer use and turn it off. */
  stop(): Promise<void>
  /**
   * Pause or resume computer use in one session.
   * @param sessionId - the session.
   * @param paused - the new state.
   */
  setPaused(sessionId: string, paused: boolean): Promise<void>
  /**
   * Replace the user's own block list.
   * @param apps - app names or bundle ids.
   */
  setBlockedApps(apps: string[]): Promise<void>
  /** Readable keys of the stop shortcut. */
  stopKeys: string
  hooks: {
    /** The latest state, or null before the first frame. */
    view: HostObservable<ComputerUseView | null>
  }
}

/** Props of the approval card that replaces the composer. */
export type ApprovalCardProps = PropsRuntime<'conversation.composer'> & { matched: PendingApproval }
  & InjectFace<ComputerUseInjected> & PropsLocale<'computer-use'>

/** Props of the composer dock entry. */
export type DockProps = PropsRuntime<'conversation.composer.dock'> & InjectFace<ComputerUseInjected> & PropsLocale<'computer-use'>

/** Props of the Settings > General row. */
export type SettingsRowProps = PropsRuntime<'settings.general.item'> & InjectFace<ComputerUseInjected> & PropsLocale<'computer-use'>
