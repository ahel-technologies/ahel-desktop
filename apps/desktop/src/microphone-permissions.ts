/** Web permissions of the application session: deny by default, allow clipboard writes and microphone to the owned application frame. */
import { systemPreferences, type Session, type WebContents } from 'electron'

/** Permissions the application frame holds without asking: copy controls write text through the async Clipboard API. */
const APPLICATION_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

function applicationFrame(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'ahel-app:' && parsed.hostname === 'app'
  } catch (_error) { return false /* Invalid frame URLs hold no permission. */ }
}

/**
 * Handle permission checks and requests for the application session. Every permission is denied unless the
 * primary window's main application frame asks: it may write the clipboard, and it may use the microphone
 * for audio-only capture once the operating system grants it. Subframes, including MCP app cards, and
 * every other page hold no permission.
 * @param session - application's browser session.
 * @param primary - current primary window contents, absent while no window is open.
 */
export function installMicrophonePermissions(session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>, primary: () => WebContents | undefined): void {
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    const owned = contents != null && contents === primary() && details.isMainFrame && applicationFrame(origin)
    if (permission !== 'media') return owned && APPLICATION_PERMISSIONS.has(permission)
    return owned && details.mediaType === 'audio'
      && (process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('microphone') === 'granted')
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const owned = contents === primary() && details.isMainFrame && applicationFrame(details.requestingUrl)
    if (permission !== 'media') { callback(owned && APPLICATION_PERMISSIONS.has(permission)); return }
    const allowed = owned && 'mediaTypes' in details && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio'
    if (!allowed) { callback(false); return }
    if (process.platform !== 'darwin') { callback(true); return }
    void systemPreferences.askForMediaAccess('microphone').then(callback, () => { callback(false) })
  })
}
