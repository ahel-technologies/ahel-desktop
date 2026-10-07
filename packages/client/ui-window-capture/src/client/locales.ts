/** Locale-owned copy for the composer capture button, its notices and the shortcut row in Settings > General. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'window-capture'

/** English dictionary and key source. */
export const en = {
  button: 'Attach a window',
  capturing: 'Capturing the window…',
  permission: 'Turn on Ahel Desktop in System Settings > Privacy & Security > Screen Recording, then press the shortcut again.',
  noWindow: 'No other window is open to capture.',
  unsupported: 'Window capture is not available on this computer.',
  failed: 'Could not capture the window. {message}',
  busy: 'Wait until the message is sent, then try again.',
  unavailable: 'Open a chat first, then try again.',
  title: 'Window capture shortcut',
  description: 'Press it in any app to attach a screenshot of that window to your chat.',
  macOnly: 'macOS only.',
  off: 'Off',
  taken: 'Another app uses this shortcut. Pick a different one.',
  invalid: 'This shortcut cannot be used. Pick a different one.',
  needsModifier: 'Use Cmd, Ctrl or Option with a key.',
  recording: 'Press the new shortcut…',
  change: 'Change',
  cancel: 'Cancel',
  turnOff: 'Turn off',
  reset: 'Use {keys}',
}

/** Dictionary keys. */
export type WindowCaptureKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<WindowCaptureKey, string> = {
  button: '附加窗口',
  capturing: '正在截取窗口…',
  permission: '请在 系统设置 > 隐私与安全性 > 录屏与系统录音 中开启 Ahel Desktop，然后再按一次快捷键。',
  noWindow: '没有其他可截取的窗口。',
  unsupported: '这台电脑不支持截取窗口。',
  failed: '无法截取窗口。{message}',
  busy: '请等消息发送完成后再试。',
  unavailable: '请先打开一个对话，然后再试。',
  title: '截取窗口快捷键',
  description: '在任意应用中按下它，即可把该窗口的截图附加到对话。',
  macOnly: '仅支持 macOS。',
  off: '已关闭',
  taken: '其他应用正在使用这个快捷键，请换一个。',
  invalid: '这个快捷键无法使用，请换一个。',
  needsModifier: '请把 Cmd、Ctrl 或 Option 与一个按键组合使用。',
  recording: '请按下新的快捷键…',
  change: '更改',
  cancel: '取消',
  turnOff: '关闭',
  reset: '使用 {keys}',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Window capture copy. */
    'window-capture': WindowCaptureKey
  }
}
