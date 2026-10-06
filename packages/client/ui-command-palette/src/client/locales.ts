/** Locale-owned copy for the command palette and its keyboard commands. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'command-palette'

/** English dictionary and key source. */
export const en = {
  dialog: 'Command palette',
  placeholder: 'Search chats, apps and commands…',
  empty: 'No matches',
  hintMove: 'move',
  hintRun: 'open',
  hintClose: 'close',
  keyEscape: 'esc',
  current: 'Current',
  groupRecent: 'Recent',
  groupActions: 'Actions',
  groupGoTo: 'Go to',
  groupChats: 'Chats',
  groupApps: 'Your apps',
  groupModels: 'Model',
  groupSettings: 'Settings',
  groupAccount: 'Account',
  newChat: 'New chat',
  untitledChat: 'Untitled chat',
  useApp: 'Use {name}',
  useAppPrompt: 'Use {name} to ',
  model: 'Model: {name}',
  settingsPage: 'Settings: {name}',
  themeLight: 'Theme: Light',
  themeDark: 'Theme: Dark',
  themeSystem: 'Theme: Match system',
  signIn: 'Sign in',
  signOut: 'Sign out',
  justNow: 'just now',
  minutesAgo: '{n} min ago',
  hoursAgo: '{n} h ago',
  daysAgo: '{n} d ago',
  shortcutOpen: 'Open command palette',
  shortcutChat: 'Open chat {n} in the sidebar',
  shortcutApprovals: 'Open Approvals',
  shortcutInbox: 'Open Inbox',
  noChatAt: 'No chat at position {n}',
  panelUnavailable: 'Not available for this account',
}

/** Dictionary keys. */
export type CommandPaletteKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<CommandPaletteKey, string> = {
  dialog: '命令面板',
  placeholder: '搜索对话、应用和命令…',
  empty: '没有匹配项',
  hintMove: '移动',
  hintRun: '打开',
  hintClose: '关闭',
  keyEscape: 'esc',
  current: '当前',
  groupRecent: '最近',
  groupActions: '操作',
  groupGoTo: '前往',
  groupChats: '对话',
  groupApps: '你的应用',
  groupModels: '模型',
  groupSettings: '设置',
  groupAccount: '账户',
  newChat: '新对话',
  untitledChat: '未命名对话',
  useApp: '使用 {name}',
  useAppPrompt: '使用 {name} 来',
  model: '模型：{name}',
  settingsPage: '设置：{name}',
  themeLight: '主题：浅色',
  themeDark: '主题：深色',
  themeSystem: '主题：跟随系统',
  signIn: '登录',
  signOut: '退出登录',
  justNow: '刚刚',
  minutesAgo: '{n} 分钟前',
  hoursAgo: '{n} 小时前',
  daysAgo: '{n} 天前',
  shortcutOpen: '打开命令面板',
  shortcutChat: '打开侧边栏中的第 {n} 个对话',
  shortcutApprovals: '打开审批',
  shortcutInbox: '打开收件箱',
  noChatAt: '第 {n} 个位置没有对话',
  panelUnavailable: '此账户不可用',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Command palette copy. */
    'command-palette': CommandPaletteKey
  }
}
