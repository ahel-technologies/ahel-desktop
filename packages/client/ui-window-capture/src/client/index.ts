/**
 * Browser face of window capture in Ahel Desktop. Reads the preload bridge
 * `window.__DSH_WINDOW_CAPTURE__` (absent on the served Web page, where the
 * plugin registers nothing), puts a capture button in the composer, a notice
 * toast in `shell.overlay` and the global-shortcut row in Settings > General.
 * A shortcut capture lands in the visible composer, or in a new chat when no
 * composer is on screen.
 * A capture reaches the model through the composer's own attachment path: the
 * conversation service's `createDrafts` (image draft for the PNG, uploaded
 * file draft for the text) and the session's `addAttachments`, as + > File does.
 */
import type { Context } from '@ahel/cordis'
import type { ConversationController } from '@ahel/dsh-client-ui-conversation/client'
import type { HostObservable } from '@ahel/dsh-client-ui-slots'
import type { WindowCaptureBridge, WindowCaptureShortcut } from '@ahel/dsh-window-capture/protocol'
import { windowCaptureFiles } from './files.ts'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-workspace/client'
import { WindowCaptureChip, WindowCaptureSettingsRow, WindowCaptureToast } from './WindowCapture.tsx'
import type { WindowCaptureInjected, WindowCaptureNotice } from './WindowCapture.tsx'
import { en, NS, zh } from './locales.ts'

export type {
  WindowCaptureChipProps, WindowCaptureInjected, WindowCaptureNotice, WindowCaptureSettingsRowProps, WindowCaptureToastProps,
} from './WindowCapture.tsx'
export type { WindowCaptureKey } from './locales.ts'
export { acceleratorFromKey, acceleratorKeys } from './accelerator.ts'

declare global {
  interface Window {
    /** Desktop preload bridge; absent on the served Web page. */
    __DSH_WINDOW_CAPTURE__?: WindowCaptureBridge
  }
}

/** Required services: slots and dictionaries. */
export const inject = ['slots', 'locale']

function cell<T>(initial: T): { observable: HostObservable<T>; get: () => T; set: (next: T) => void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    observable: {
      getSnapshot: () => value,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    get: () => value,
    set: (next) => { value = next; for (const listener of listeners) listener() },
  }
}

/**
 * Register the dictionaries, the bridge subscription and the three slot occupants.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const bridge = typeof window === 'undefined' ? undefined : window.__DSH_WINDOW_CAPTURE__
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-window-capture: dictionaries')
  const captured = cell(0)
  const shortcut = cell<WindowCaptureShortcut | null>(null)
  const notice = cell<WindowCaptureNotice | null>(null)
  let seq = 0
  const composers = new Set<HTMLElement>()
  ctx.effect(() => bridge.onCaptured(() => {
    captured.set(captured.get() + 1)
    // A visible composer takes the capture in its effect; without one, a new chat's composer takes it when it mounts.
    if ([...composers].some(element => element.offsetParent !== null)) return
    ctx.get('uiWorkspace')?.startSession()
  }), 'ui-window-capture: shortcut captures')
  void bridge.shortcut().then(shortcut.set, () => undefined)

  const injected: WindowCaptureInjected = {
    hooks: { captured: captured.observable, shortcut: shortcut.observable, notice: notice.observable },
    capture: () => bridge.capture(),
    take: () => bridge.take(),
    track: (element) => {
      composers.add(element)
      return () => { composers.delete(element) }
    },
    attach: (sessionId, inputActions, capture) => {
      // The concrete controller owns draft creation; the outward IConversation face does not carry it.
      const conversation = ctx.get('conversation') as ConversationController | undefined
      if (conversation === undefined) return 'unavailable'
      const { files, caption } = windowCaptureFiles(capture, new Date())
      const drafts = conversation.createDrafts(sessionId, files)
      if (!inputActions.addAttachments(drafts.map(draft => draft.id))) {
        conversation.releaseDraftAttachments(drafts)
        return 'busy'
      }
      inputActions.insertText(`${caption}\n`, inputActions.captureInsertion())
      return null
    },
    notify: (key, message) => { seq += 1; notice.set({ seq, key, ...(message === undefined ? {} : { message }) }) },
    dismissNotice: () => { notice.set(null) },
    setShortcut: async (accelerator) => {
      const result = await bridge.setShortcut(accelerator)
      shortcut.set(result.shortcut)
      return result
    },
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'window-capture', locale: NS, inject: () => injected,
  }, WindowCaptureChip))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'window-capture.notice', locale: NS, inject: () => injected,
  }, WindowCaptureToast))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'window-capture', order: 60, locale: NS, inject: () => injected,
  }, WindowCaptureSettingsRow))
}
