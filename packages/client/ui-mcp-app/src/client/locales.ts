/** Locale-owned copy for MCP Apps cards. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace for MCP Apps cards. */
export const NS = 'mcp-app'

/** Chinese dictionary and key source. */
export const zh = {
  frame: '{tool} 卡片',
  loading: '正在加载卡片',
  failed: '无法显示卡片，已改为显示文本结果',
  tooLarge: '结果过大，无法显示卡片，已改为显示文本结果',
  navigated: '卡片已离开其页面，已停止与其通信',
  structured: '结构化结果',
}

/** Dictionary keys. */
export type McpAppKey = keyof typeof zh

/** English dictionary. */
export const en: Record<McpAppKey, string> = {
  frame: '{tool} card',
  loading: 'Loading card',
  failed: 'The card could not be shown, so the text result is shown instead.',
  tooLarge: 'The result is too large for a card, so the text result is shown instead.',
  navigated: 'The card left its page, so the host stopped talking to it.',
  structured: 'Structured result',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP Apps card frame, loading, and fallback copy. */
    'mcp-app': McpAppKey
  }
}
