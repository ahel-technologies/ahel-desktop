/** Localized welcome copy, the continue and sign-in actions, and sign-in progress. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi, type WelcomeSignInState } from './welcome-api.ts'

const prefix = '--ahel-welcome-locale='
const locale = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  continue: () => ipcRenderer.invoke(WELCOME_IPC.continue) as Promise<void>,
  signIn: () => ipcRenderer.invoke(WELCOME_IPC.signIn) as Promise<void>,
  cancelSignIn: () => ipcRenderer.invoke(WELCOME_IPC.cancelSignIn) as Promise<void>,
  onSignInState: (listener) => {
    const handler = (_event: unknown, state: WelcomeSignInState): void => { listener(state) }
    ipcRenderer.on(WELCOME_IPC.signInState, handler)
    return () => { ipcRenderer.removeListener(WELCOME_IPC.signInState, handler) }
  },
}
contextBridge.exposeInMainWorld('ahelWelcome', api)
