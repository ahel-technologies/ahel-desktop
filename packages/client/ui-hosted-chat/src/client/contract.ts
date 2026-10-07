/** The face every hosted chat surface receives, and the composed props of each slot occupant. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { AhelAccountView, Issue } from '@ahel/dsh-ahel-account/types'
import type { TeamSummaryState } from '@ahel/dsh-client-ui-ahel-account/client'
import type { ThemePreference } from '@ahel/dsh-client-ui-theme/client'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-layout/client'
import type {} from '@ahel/dsh-client-ui-sidebar/client'
import type {} from './locales.ts'

/** Account actions, the rail's navigation and the shared reads of the hosted chat. */
export interface HostedShellInjected {
  /**
   * Show an in-app main panel; an id that is not registered right now is ignored.
   * @param id - main panel id, or null for the Conversation.
   */
  selectPanel(id: string | null): void
  /**
   * Choose the workspace the chat acts in, then pin it as ahel.ai's active workspace so the next load keeps it;
   * does nothing before the account is mounted.
   * @param id - one of the profile's workspace ids.
   */
  selectWorkspace(id: string): Promise<void>
  /** Sign out the way the account menu does. */
  signOut(): Promise<void>
  /** Open the workspace's ahel.ai billing page; does nothing before the account is mounted. */
  openBilling(): void
  /** Open the in-app settings window the way its shortcut does, on its first section. */
  openChatSettings(): void
  /** Step the theme preference System, Light, Dark, System. */
  cycleTheme(): void
  /**
   * Show one issue in the Issues panel.
   * @param key - for example `AHEL-137`.
   */
  openIssue(key: string): void
  /**
   * Publish the chat column's element the rail draws New chat and the Chats list into.
   * @param element - the column's seat, or null once it unmounts.
   */
  setChatSeat(element: HTMLElement | null): void
  hooks: {
    /** The latest account view, or null before the account is mounted. */
    account: HostObservable<AhelAccountView | null>
    /** The shared team summary poll. */
    summary: HostObservable<TeamSummaryState>
    /** Issue runs this person asked for that wait for their answer or approval, newest first. */
    waitingIssues: HostObservable<readonly Issue[]>
    /** The persisted theme preference. */
    theme: HostObservable<ThemePreference>
    /** The chat column's seat for New chat and the Chats list. */
    chatSeat: HostObservable<HTMLElement | null>
  }
}

/** Props of the app rail in `sidebar.body`. */
export type HostedRailProps = PropsRuntime<'sidebar.body'> & InjectFace<HostedShellInjected> & PropsLocale<'hosted-chat'>

/** Props of the chat column in `shell.aside`. */
export type HostedAsideProps = PropsRuntime<'shell.aside'> & InjectFace<HostedShellInjected> & PropsLocale<'hosted-chat'>

/** Props of the page-header greeting in `conversation.hero.greeting`. */
export type HostedGreetingProps = PropsRuntime<'conversation.hero.greeting'> & InjectFace<HostedShellInjected> & PropsLocale<'hosted-chat'>

/** Props of the apps line under the greeting in `conversation.hero.subhead`. */
export type HostedSubtitleProps = PropsRuntime<'conversation.hero.subhead'> & InjectFace<HostedShellInjected> & PropsLocale<'hosted-chat'>

/** Props of the empty brand mark in `conversation.hero.brand.mark`. */
export type HostedHeroMarkProps = PropsRuntime<'conversation.hero.brand.mark'>

/** Props of the brand link in `sidebar.brand.link`. */
export type BrandHomeLinkProps = PropsRuntime<'sidebar.brand.link'> & PropsLocale<'hosted-chat'>
