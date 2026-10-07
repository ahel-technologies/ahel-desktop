/** Locale-owned copy for the hosted chat's way back to the workspace on app.ahel.ai. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'hosted-chat'

/** English dictionary and key source. */
export const en = {
  workspace: 'Workspace',
  openWorkspace: 'Open your workspace',
}

/** Keys of the hosted chat dictionary. */
export type HostedChatKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<HostedChatKey, string> = {
  workspace: '工作区',
  openWorkspace: '打开你的工作区',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Hosted chat sidebar copy. */
    'hosted-chat': HostedChatKey
  }
}
