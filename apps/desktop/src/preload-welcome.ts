/** Localized welcome copy and the continue action. */

import { contextBridge, ipcRenderer } from 'electron'
import { resolveDesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeApi } from './welcome-api.ts'

const prefix = '--ahel-welcome-locale='
const locale = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (locale === undefined) throw new Error('desktop welcome: missing window locale')
const api: WelcomeApi = {
  ...resolveDesktopLocale(locale),
  continue: () => ipcRenderer.invoke(WELCOME_IPC.continue) as Promise<void>,
}
contextBridge.exposeInMainWorld('ahelWelcome', api)
