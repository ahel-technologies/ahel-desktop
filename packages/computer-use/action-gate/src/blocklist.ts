/**
 * Hard blocks enforced before any approval card: password fields, security
 * and credential apps, terminals, Ahel Desktop itself, and the user's own
 * list. A block is final; the model sees the reason.
 */

/** One always-blocked app. */
export interface BlockedApp {
  /** Display name, also matched against the app name. */
  readonly name: string
  /** Other names the app reports. */
  readonly aliases: readonly string[]
  /** macOS bundle ids. */
  readonly bundleIds: readonly string[]
  /** When set, only windows whose title matches are blocked; an unknown title is blocked too. */
  readonly windows?: RegExp
  /** Why it is blocked, in the model-visible reason. */
  readonly why: string
}

/** System Settings panes under Privacy & Security, and other panes that hold credentials. */
const SECURITY_PANES = new RegExp([
  'privacy', 'security', 'accessibility', 'screen (?:&|and) system audio', 'screen recording', 'full disk', 'input monitoring',
  'automation', 'developer tools', 'app management', 'files and folders', 'location services', 'passwords', 'touch id',
  'login password', 'users (?:&|and) groups',
].join('|'), 'i')

/** Apps that computer use never drives. */
export const BUILT_IN_BLOCKED: readonly BlockedApp[] = [
  { name: 'Keychain Access', aliases: [], bundleIds: ['com.apple.keychainaccess'], why: 'it holds passwords and keys' },
  {
    name: 'System Settings',
    aliases: ['System Preferences'],
    bundleIds: ['com.apple.systempreferences', 'com.apple.Settings'],
    windows: SECURITY_PANES,
    why: 'Privacy & Security controls what apps may do',
  },
  { name: 'Terminal', aliases: [], bundleIds: ['com.apple.Terminal'], why: 'a terminal runs commands' },
  { name: 'iTerm', aliases: ['iTerm2'], bundleIds: ['com.googlecode.iterm2'], why: 'a terminal runs commands' },
  { name: 'Warp', aliases: [], bundleIds: ['dev.warp.Warp-Stable', 'dev.warp.Warp', 'dev.warp.Warp-Preview'], why: 'a terminal runs commands' },
  { name: 'Bitwarden', aliases: [], bundleIds: ['com.bitwarden.desktop'], why: 'it is a password manager' },
  {
    name: '1Password',
    aliases: ['1Password 7', '1Password 8'],
    bundleIds: ['com.1password.1password', 'com.agilebits.onepassword7', 'com.agilebits.onepassword-osx'],
    why: 'it is a password manager',
  },
  { name: 'Passwords', aliases: [], bundleIds: ['com.apple.Passwords'], why: 'it is a password manager' },
  { name: 'Ahel Desktop', aliases: ['Ahel Desktop Helper', 'Ahel'], bundleIds: ['ai.ahel.desktop'], why: 'it would approve its own actions' },
]

/** Element facts the secure-field check reads. */
export interface ElementFacts {
  readonly role: string
  readonly subrole?: string | null
  readonly label: string | null
}

/** What the gate knows about the target of one write. */
export interface BlockTarget {
  readonly app: string | null
  readonly bundleId: string | null
  readonly window: string | null
  readonly element: ElementFacts | null
  /** The latest observation reported a secure field as focused. */
  readonly focusedSecure: boolean
  /** The action puts text into the target. */
  readonly writesText: boolean
  /** URLs a launch would open. */
  readonly urls: readonly string[]
}

/** Launch URLs that open a blocked app or a settings pane. */
const BLOCKED_URL = new RegExp(
  String.raw`^x-apple\.systempreferences:|(?:Keychain Access|Terminal|iTerm|Warp|1Password[^/]*|Bitwarden|Passwords|Ahel Desktop)\.app(?:/|$)`,
  'i',
)

const PASSWORD_LABEL =/password|passcode|passwort|contraseña|mot de passe|密码|パスワード/i

/**
 * Whether an accessibility element is a password field.
 * @param element - role, subrole and label from the latest observation.
 * @returns true for `AXSecureTextField` and text fields labelled as passwords.
 */
export function isSecureField(element: ElementFacts): boolean {
  const role = `${element.role} ${element.subrole ?? ''}`.toLowerCase()
  if (role.includes('securetextfield')) return true
  return role.includes('textfield') && element.label !== null && PASSWORD_LABEL.test(element.label)
}

function same(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The built-in entry that covers an app, by bundle id or name.
 * @param app - app name.
 * @param bundleId - bundle id.
 * @returns the matching entry, or undefined.
 */
export function builtInFor(app: string | null, bundleId: string | null): BlockedApp | undefined {
  return BUILT_IN_BLOCKED.find(entry => entry.bundleIds.some(id => same(bundleId, id))
    || same(app, entry.name) || entry.aliases.some(alias => same(app, alias)))
}

/**
 * Decide whether a write is hard-blocked.
 * @param target - what the gate resolved about the target.
 * @param userBlocked - app names or bundle ids the user added in Settings.
 * @returns the model-visible reason, or null when the write may be asked.
 */
export function blockReason(target: BlockTarget, userBlocked: readonly string[]): string | null {
  if (target.element !== null && isSecureField(target.element)) {
    return 'Blocked: the target is a password field. Computer use never types into or reads password fields. Ask the user to do this step.'
  }
  if (target.writesText && target.element === null && target.focusedSecure) {
    return 'Blocked: a password field has focus. Computer use never types into password fields. Ask the user to do this step.'
  }
  const entry = builtInFor(target.app, target.bundleId)
  if (entry !== undefined && (entry.windows === undefined || target.window === null || entry.windows.test(target.window))) {
    return `Blocked: computer use never controls ${entry.name}${entry.windows === undefined ? '' : ' security panes'}, because ${entry.why}. Ask the user to do this step.`
  }
  if (target.urls.some(url => BLOCKED_URL.test(url))) {
    return 'Blocked: computer use never opens System Settings, terminals or password apps. Ask the user to do this step.'
  }
  const own = userBlocked.find(item => item.trim() !== '' && (same(target.app, item) || same(target.bundleId, item)))
  if (own !== undefined) {
    return `Blocked: the user blocked ${own} for computer use. Ask the user to do this step.`
  }
  return null
}
