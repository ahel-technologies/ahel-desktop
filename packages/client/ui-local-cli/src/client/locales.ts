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

/** Chinese dictionary. */
export const zh: Record<LocalCliKey, string> = {
  headingMac: '在这台 Mac 上找到',
  headingOther: '在这台电脑上找到',
  refresh: '刷新',
  refreshing: '正在查找已安装的工具…',
  looking: '正在查找 Claude Code、Codex 和 Gemini CLI…',
  signedIn: 'v{version} · 已登录',
  versionOnly: 'v{version}',
  signedOut: '未登录 — {hint}',
  tooOld: '版本过旧（需要 {min} 或更高）',
  noVersion: '已安装，但未报告版本',
  notFound: '这台电脑上已找不到',
  comingSoon: '即将支持此工具',
  enable: '启用',
  disable: '停用',
  enableSignedOut: '请先登录。{hint}',
  enableTooOld: '请先更新到 {min} 或更高版本',
  enabled: '{name} 已设为默认模型',
  enabledNoDefault: '{name} 已启用',
  enableFailed: '无法启用 {name}。{message}',
  disableFailed: '无法停用 {name}。{message}',
  refreshFailed: '无法查找已安装的工具。{message}',
  empty: '未找到 Claude Code、Codex 或 Gemini CLI。',
  installClaude: '安装 Claude Code',
  installCodex: '安装 Codex',
  installGemini: '安装 Gemini CLI',
  caption: '运行你已登录的工具。用量由该厂商计入你的账户。在这些模型上，Ahel 工具在该工具内运行并以文本显示。',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Detected-on-this-computer rows copy. */
    'local-cli': LocalCliKey
  }
}
