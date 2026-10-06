/** Copy for the Computer use (beta) row in Settings > General. */
export const en = {
  title: 'Computer use (beta)',
  switchLabel: 'Computer use',
  description: 'Let your AI see and use the apps on this computer. It asks you before every click or keystroke.',
  phaseOff: 'Off',
  phaseStarting: 'Starting…',
  phaseReady: 'On',
  phaseUnavailable: 'This installation has no computer-use driver.',
  phaseUnsupported: 'Not available on this system yet.',
  phaseError: 'Computer use stopped working.',
  needAccessibility: 'Allow Ahel Desktop in Accessibility, then click Check again.',
  needScreenRecording: 'Allow Ahel Desktop in Screen Recording, then click Check again.',
  needBoth: 'Allow Ahel Desktop in Accessibility and Screen Recording, then click Check again.',
  openSettings: 'Open System Settings',
  recheck: 'Check again',
  failed: 'Could not change the setting. Try again.',
}

/** Chinese copy. */
export const zh: Record<keyof typeof en, string> = {
  title: '电脑操作（测试版）',
  switchLabel: '电脑操作',
  description: '让你的 AI 查看并使用这台电脑上的应用。每次点击或按键前都会先征求你的同意。',
  phaseOff: '已关闭',
  phaseStarting: '正在启动…',
  phaseReady: '已开启',
  phaseUnavailable: '此安装不包含电脑操作驱动。',
  phaseUnsupported: '此系统暂不支持。',
  phaseError: '电脑操作已停止工作。',
  needAccessibility: '请在“辅助功能”中允许 Ahel Desktop，然后点击“重新检查”。',
  needScreenRecording: '请在“屏幕录制”中允许 Ahel Desktop，然后点击“重新检查”。',
  needBoth: '请在“辅助功能”和“屏幕录制”中允许 Ahel Desktop，然后点击“重新检查”。',
  openSettings: '打开系统设置',
  recheck: '重新检查',
  failed: '无法更改此设置，请重试。',
}

/** Locale keys of this row. */
export type ComputerUseSettingsLocaleKey = keyof typeof en
