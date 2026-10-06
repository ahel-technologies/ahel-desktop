/** Source-safe lifecycle for the optional speech Remote and browser UI. */
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-api-remotes/client'
import type {} from '@ahel/dsh-experimental-api-speech-to-text/remote'
import type {} from '@ahel/dsh-client-locale/client'
import type {} from '@ahel/dsh-client-ui-renderer/client'
import type {} from '@ahel/dsh-client-ui-conversation/client'
import type {} from '@ahel/dsh-client-ui-settings/client'
import type { TypertRemoteContribution } from '@ahel/dsh-typert-protocol'
import { VoiceInput, type VoiceInputInjected } from './VoiceInput.tsx'
import { Recording } from './audio.ts'
import { en, NS, zh } from './locales.ts'
import type {} from '@ahel/dsh-client-ui-plugin-manager/client'
import { observeReadiness } from './readiness.ts'
import { VoicePreparation } from './PreparationCard.tsx'
import { VoiceSetupPrompt } from './VoiceSetupPrompt.tsx'
import { DictationRow, type DictationRowInjected } from './DictationRow.tsx'
import { DictationToggles, desktopDictation, type DesktopDictationBridge } from './hotkey.ts'

export const inject = ['remote', 'slots', 'locale']

/** Bundle key of the optional local engine, whose details page hosts its preparation cards. */
const LOCAL_ENGINE_BUNDLE = '@ahel/dsh-experimental-voice-input-bundle'

function registerUi(ctx: Context, bridge: DesktopDictationBridge | undefined): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const recordings = new Set<Recording>()
  const readiness = observeReadiness(ctx)
  ctx.effect(() => readiness.dispose)
  ctx.effect(() => async () => { await Promise.all([...recordings].map(recording => recording.dispose())) })
  const toggles = new DictationToggles()
  if (bridge !== undefined) ctx.effect(() => bridge.onToggle(() => { toggles.press() }))
  const actions: VoiceInputInjected & DictationRowInjected = {
    openSettings: () => { ctx.emit('settings/open-section', 'general') },
    hooks: { speechReadiness: readiness.state },
    toggles,
    hotkey: bridge,
    createRecording: () => {
      const recording = new Recording(() => { recordings.delete(recording) })
      recordings.add(recording)
      return recording
    },
    transcribe: async (request, signal) => await ctx.remote.speech.transcribe(request, signal),
    configure: async (patch) => { const result = await ctx.remote.speech.configure(patch); if (!result.ok) throw result.error },
    prepare: async (providerId, options) => {
      const result = await ctx.remote.speech.prepare(providerId, options); if (!result.ok) throw result.error
    },
    cancelPreparation: async (providerId) => {
      const result = await ctx.remote.speech.cancelPreparation(providerId); if (!result.ok) throw result.error
    },
  }
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity', locale: NS, inject: () => actions,
  }, VoiceInput))
  // Settings > General > Dictation: recognizer, language and, in Ahel Desktop, the push-to-talk shortcut.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'dictation', order: 55, locale: NS, inject: () => actions,
  }, DictationRow))
  // The optional local engine's plugin details (Developer tools): download and preparation cards.
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: LOCAL_ENGINE_BUNDLE, locale: NS, inject: () => actions,
  }, VoicePreparation))
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation',
    key: LOCAL_ENGINE_BUNDLE, locale: NS, inject: () => actions,
  }, VoiceSetupPrompt))
}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries and slots.
 * @param contribution - generated speech Remote definitions.
 * @param bridge - the desktop shell's push-to-talk bridge; absent in a browser.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountVoiceInput(ctx: Context, contribution: TypertRemoteContribution,
  bridge: DesktopDictationBridge | undefined = desktopDictation()): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.speech', 'slots', 'locale'], (inner) => { registerUi(inner, bridge) })
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
