/** Locale-owned copy for the hosted chat's app rail, chat column and greeting. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'hosted-chat'

/** English dictionary and key source. */
export const en = {
  openWorkspace: 'Open your workspace',
  navLabel: 'Main navigation',
  footLabel: 'Account and help',
  home: 'Home',
  chat: 'Chat',
  apps: 'Apps',
  discover: 'Discover',
  inbox: 'Inbox',
  inboxUnread: 'Inbox, {count} unread',
  team: 'Team',
  settings: 'Settings',
  help: 'Help',
  logOut: 'Log out',
  account: 'Account',
  accountLoading: 'Loading your account',
  accountMenu: 'Account menu',
  chatSettings: 'Chat settings',
  balanceToday: 'Balance {amount} · Today {spent}',
  balanceLow: 'Balance is low',
  topUp: 'Top up',
  askOwnerTopUp: 'Ask the owner to top up',
  'theme.system': 'Theme: System',
  'theme.light': 'Theme: Light',
  'theme.dark': 'Theme: Dark',
  switchWorkspace: 'Switch workspace',
  workspaces: 'Workspaces',
  newChat: 'New chat',
  chatsLabel: 'Chats',
  waiting: 'Waiting on you',
  waitingApproval: 'Approve: {what}',
  waitingApprovalFrom: 'from {requester}',
  waitingInput: 'Needs your answer',
  waitingRunApproval: 'Needs your approval',
  eyebrow: 'Chat',
  subtitle: '{count} apps ready. Ask anything, or run one of them.',
  subtitleOne: '1 app ready. Ask anything, or run it.',
  subtitleNone: 'Ask anything.',
}

/** Keys of the hosted chat dictionary. */
export type HostedChatKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<HostedChatKey, string> = {
  openWorkspace: '打开你的工作区',
  navLabel: '主导航',
  footLabel: '账户与帮助',
  home: '首页',
  chat: '对话',
  apps: '应用',
  discover: 'Discover',
  inbox: '收件箱',
  inboxUnread: '收件箱，{count} 条未读',
  team: '团队',
  settings: '设置',
  help: '帮助',
  logOut: '退出登录',
  account: '账户',
  accountLoading: '正在加载你的账户',
  accountMenu: '账户菜单',
  chatSettings: '对话设置',
  balanceToday: '余额 {amount} · 今日 {spent}',
  balanceLow: '余额不足',
  topUp: '充值',
  askOwnerTopUp: '请让所有者充值',
  'theme.system': '主题：跟随系统',
  'theme.light': '主题：浅色',
  'theme.dark': '主题：深色',
  switchWorkspace: '切换工作区',
  workspaces: '工作区',
  newChat: '新对话',
  chatsLabel: '对话',
  waiting: '等你处理',
  waitingApproval: '审批：{what}',
  waitingApprovalFrom: '来自 {requester}',
  waitingInput: '等你回答',
  waitingRunApproval: '等你批准',
  eyebrow: '对话',
  subtitle: '{count} 个应用已就绪。随便问，或运行其中一个。',
  subtitleOne: '1 个应用已就绪。随便问，或运行它。',
  subtitleNone: '随便问。',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Hosted chat rail, chat column and greeting copy. */
    'hosted-chat': HostedChatKey
  }
}
