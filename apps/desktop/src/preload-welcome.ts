/** Localized welcome copy, the opening notice, the sign-in actions, and sign-in progress. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi, type WelcomeSignInState } from './welcome-api.ts'

const argument = (prefix: string): string | undefined => process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
const locale = argument('--ahel-welcome-locale=')
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  notice: argument('--ahel-welcome-notice=') === 'session-ended' ? 'session-ended' : null,
  signIn: () => ipcRenderer.invoke(WELCOME_IPC.signIn) as Promise<void>,
  cancelSignIn: () => ipcRenderer.invoke(WELCOME_IPC.cancelSignIn) as Promise<void>,
  onSignInState: (listener) => {
    const handler = (_event: unknown, state: WelcomeSignInState): void => { listener(state) }
    ipcRenderer.on(WELCOME_IPC.signInState, handler)
    return () => { ipcRenderer.removeListener(WELCOME_IPC.signInState, handler) }
  },
}
contextBridge.exposeInMainWorld('ahelWelcome', api)
