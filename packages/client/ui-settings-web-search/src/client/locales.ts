/** Copy for the Web search row in Settings > General. */
export const en = {
  title: 'Web search',
  on: 'Ahel Web Search (on)',
  off: 'Ahel Web Search (off in this workspace)',
  signedOut: 'Ahel Web Search',
  checking: 'Ahel Web Search',
  descriptionOn: 'Your AI can search the web and read pages. Each search or page read costs 1 cent from your Ahel balance.',
  descriptionOff: 'Turn it on so your AI can search the web and read pages. Each search or page read costs 1 cent from your Ahel balance.',
  descriptionSignedOut: 'Sign in to Ahel to let your AI search the web.',
  descriptionChecking: 'Checking this workspace…',
  descriptionUnreachable: 'ahel.ai did not answer. Web search is used whenever it is on in your workspace.',
  turnOn: 'Turn on',
  turningOn: 'Turning on…',
  failed: 'Could not turn it on. Try again, or turn it on at ahel.ai/app/apps.',
}

/** Chinese copy. */
export const zh: Record<keyof typeof en, string> = {
  title: '网页搜索',
  on: 'Ahel 网页搜索（已开启）',
  off: 'Ahel 网页搜索（此工作区未开启）',
  signedOut: 'Ahel 网页搜索',
  checking: 'Ahel 网页搜索',
  descriptionOn: '你的 AI 可以搜索网页并阅读页面。每次搜索或读取页面从你的 Ahel 余额扣除 1 美分。',
  descriptionOff: '开启后你的 AI 可以搜索网页并阅读页面。每次搜索或读取页面从你的 Ahel 余额扣除 1 美分。',
  descriptionSignedOut: '登录 Ahel 后，你的 AI 即可搜索网页。',
  descriptionChecking: '正在检查此工作区…',
  descriptionUnreachable: 'ahel.ai 没有响应。工作区开启网页搜索时即会使用。',
  turnOn: '开启',
  turningOn: '正在开启…',
  failed: '无法开启。请重试，或在 ahel.ai/app/apps 开启。',
}

/** Locale keys of this row. */
export type WebSearchSettingsLocaleKey = keyof typeof en
