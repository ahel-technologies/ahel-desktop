/** `notifications` namespace dictionaries: notification copy and the Settings row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'notifications'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'note.replyReady': '回复已就绪',
  'note.failed': '已停止：{reason}',
  'note.approval': '需要你的批准：{summary}',
  'note.approvalPlain': '需要你的批准',
  'note.question': '需要你的回答：{question}',
  'note.questionPlain': '需要你的回答',
  'note.handoff': '{from} 转交给你一个对话',
  'note.runStarted': '已开始运行：{key} {title}',
  'note.someone': '队友',
  'note.untitled': '新对话',
  'settings.title': '通知',
  'settings.description': 'Ahel 在后台时，回复就绪或对话需要你时通知你。',
} satisfies Record<string, string>

/** The notifications namespace key union. */
export type NotificationsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'note.replyReady': 'Reply ready',
  'note.failed': 'Stopped: {reason}',
  'note.approval': 'Needs your approval: {summary}',
  'note.approvalPlain': 'Needs your approval',
  'note.question': 'Needs your answer: {question}',
  'note.questionPlain': 'Needs your answer',
  'note.handoff': '{from} handed you a chat',
  'note.runStarted': 'Run started: {key} {title}',
  'note.someone': 'A teammate',
  'note.untitled': 'New chat',
  'settings.title': 'Notifications',
  'settings.description': 'When a reply is ready or a chat needs you, while Ahel is in the background.',
} satisfies Record<NotificationsKey, string>
