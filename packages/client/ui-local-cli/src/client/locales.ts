/** Locale-owned copy for the Detected-on-this-computer rows in Settings > Models. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'local-cli'

/** English dictionary and key source. */
export const en = {
  headingMac: 'Detected on this Mac',
  headingOther: 'Detected on this computer',
  refresh: 'Refresh',
  refreshing: 'Looking for installed tools…',
  looking: 'Looking for Claude Code, Codex and Gemini CLI…',
  signedIn: 'v{version} · Signed in',
  versionOnly: 'v{version}',
  signedOut: 'Not signed in — {hint}',
  tooOld: 'Version too old (need {min}+)',
  noVersion: 'Installed, but it did not report a version',
  notFound: 'Not found on this computer any more',
  comingSoon: 'Support for this tool is coming soon',
  enable: 'Enable',
  disable: 'Disable',
  enableSignedOut: 'Sign in first. {hint}',
  enableTooOld: 'Update to version {min} or newer first',
  enabled: '{name} is now your default model',
  enabledNoDefault: '{name} is turned on',
  enableFailed: 'Could not turn on {name}. {message}',
  disableFailed: 'Could not turn off {name}. {message}',
  refreshFailed: 'Could not look for installed tools. {message}',
  empty: 'No Claude Code, Codex or Gemini CLI found.',
  installClaude: 'Install Claude Code',
  installCodex: 'Install Codex',
  installGemini: 'Install Gemini CLI',
  caption: 'Runs the tool you already signed into. Usage is billed by that vendor to your account. On these models Ahel tools run inside the tool and show as text.',
}

/** Dictionary keys. */
export type LocalCliKey = keyof typeof en

/** Chinese dictionary; mirrors English until translated. */
export const zh: Record<LocalCliKey, string> = { ...en }

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Detected-on-this-computer rows copy. */
    'local-cli': LocalCliKey
  }
}
