/** Locale-owned copy for computer use. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'computer-use'

/** Chinese dictionary and key source. */
export const zh = {
  'approval.strip': '电脑操作 · 等待你的批准',
  'approval.aria': '电脑操作审批',
  'approval.app': '应用',
  'approval.window': '窗口',
  'approval.element': '元素',
  'approval.text': '将输入的文字',
  'approval.keys': '将按下的按键',
  'approval.point': '位置',
  'approval.crop': '目标在最新截图中的位置',
  'approval.details': '完整参数',
  'approval.loading': '正在读取操作详情',
  'approval.noDetails': '无法读取此操作的详情，因此不能批准。',
  'approval.clickOnly': '只能用鼠标点击批准。',
  approve: '批准',
  deny: '拒绝',
  stop: '停止电脑操作',
  'dock.on': '电脑操作已开启',
  'dock.off': '电脑操作已关闭',
  'dock.running': '正在操作电脑',
  'dock.paused': '电脑操作已在此对话暂停',
  'dock.pause': '在此对话暂停',
  'dock.resume': '继续',
  'dock.activity': '操作记录（{n}）',
  'dock.stopHint': '快捷键 {keys}',
  'status.read': '读取',
  'status.asked': '等待批准',
  'status.approved': '已批准',
  'status.done': '完成',
  'status.failed': '失败',
  'status.rejected': '已拒绝',
  'status.denied': '未允许',
  'status.blocked': '已阻止',
  'settings.blocked': '电脑操作：禁止的应用',
  'settings.description': 'AI 永远不会操作这些应用，也不会在密码框中输入。',
  'settings.builtIn': '始终禁止：{apps}',
  'settings.placeholder': '每行一个应用名称或 Bundle ID',
  'settings.save': '保存',
  'settings.saving': '正在保存',
  'settings.failed': '无法保存，请重试。',
  'shortcut.stop': '停止电脑操作',
} satisfies Record<string, string>

/** Dictionary keys. */
export type ComputerUseKey = keyof typeof zh

/** English dictionary. */
export const en: Record<ComputerUseKey, string> = {
  'approval.strip': 'Computer use · Waiting for your approval',
  'approval.aria': 'Computer use approval',
  'approval.app': 'App',
  'approval.window': 'Window',
  'approval.element': 'Element',
  'approval.text': 'Text it will type',
  'approval.keys': 'Keys it will press',
  'approval.point': 'Point',
  'approval.crop': 'The target in the latest screenshot',
  'approval.details': 'All arguments',
  'approval.loading': 'Reading the action details',
  'approval.noDetails': 'The details of this action could not be read, so it cannot be approved.',
  'approval.clickOnly': 'Approve with a mouse click only.',
  approve: 'Approve',
  deny: 'Deny',
  stop: 'Stop computer use',
  'dock.on': 'Computer use is on',
  'dock.off': 'Computer use is off',
  'dock.running': 'Using your computer',
  'dock.paused': 'Computer use is paused in this chat',
  'dock.pause': 'Pause in this chat',
  'dock.resume': 'Resume',
  'dock.activity': 'Activity ({n})',
  'dock.stopHint': 'Shortcut {keys}',
  'status.read': 'Read',
  'status.asked': 'Waiting',
  'status.approved': 'Approved',
  'status.done': 'Done',
  'status.failed': 'Failed',
  'status.rejected': 'Denied by you',
  'status.denied': 'Not allowed',
  'status.blocked': 'Blocked',
  'settings.blocked': 'Computer use: blocked apps',
  'settings.description': 'The AI never drives these apps and never types into password fields.',
  'settings.builtIn': 'Always blocked: {apps}',
  'settings.placeholder': 'One app name or bundle id per line',
  'settings.save': 'Save',
  'settings.saving': 'Saving',
  'settings.failed': 'Could not save. Try again.',
  'shortcut.stop': 'Stop computer use',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Computer-use approval card, composer dock and Settings row. */
    'computer-use': ComputerUseKey
  }
}
