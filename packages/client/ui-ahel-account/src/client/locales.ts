/** Locale-owned copy for the Ahel account menu and the Models row. */
import type {} from '@ahel/dsh-client-ui-slots'

/** Dictionary namespace. */
export const NS = 'ahel-account'

/** English dictionary and key source. */
export const en = {
  account: 'Ahel account',
  signIn: 'Sign in with Ahel',
  signingIn: 'Finish signing in in your browser',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  openAhel: 'Open ahel.ai',
  studio: 'Studio',
  discover: 'Discover',
  vault: 'Vault',
  workspace: 'Workspace',
  workspaceDefault: 'ahel.ai picks your default workspace until you choose one.',
  signedOut: 'Not signed in',
  failed: 'Sign-in did not finish. Please try again.',
  modelsTitle: 'Ahel',
  modelsSignedIn: 'Models through your ahel.ai account, paid from your workspace balance. Signed in as {email}.',
  modelsSignedOut: 'Sign in with your ahel.ai account to use Ahel models without your own key.',
  modelsHint: 'Pick an Ahel model in the model menu. Your own keys above keep working.',
  offline: 'Can\'t reach ahel.ai. Retrying…',
  starters: 'Starter prompts',
  starterApps: 'What apps do I have installed?',
  starterDiscover: 'Show me what\'s new on Discover',
  starterConnect: 'Help me connect an app',
  errorCredits: 'You\'re out of Ahel credits for today. Top up on ahel.ai or add your own key in Settings → Models.',
  errorNotEnabled: 'Ahel models aren\'t enabled for your workspace yet.',
  errorSessionEnded: 'Your session ended. Sign in again.',
  openBilling: 'Open ahel.ai',
  openModels: 'Settings → Models',
}

/** Dictionary keys. */
export type AhelAccountKey = keyof typeof en

/** Chinese dictionary. */
export const zh: Record<AhelAccountKey, string> = {
  account: 'Ahel 账户',
  signIn: '使用 Ahel 登录',
  signingIn: '请在浏览器中完成登录',
  signOut: '退出登录',
  signingOut: '正在退出…',
  openAhel: '打开 ahel.ai',
  studio: 'Studio',
  discover: 'Discover',
  vault: 'Vault',
  workspace: '工作区',
  workspaceDefault: '在你选择之前，ahel.ai 使用你的默认工作区。',
  signedOut: '未登录',
  failed: '登录未完成，请重试。',
  modelsTitle: 'Ahel',
  modelsSignedIn: '通过你的 ahel.ai 账户使用模型，费用从工作区余额扣除。已登录：{email}。',
  modelsSignedOut: '使用 ahel.ai 账户登录，无需自己的密钥即可使用 Ahel 模型。',
  modelsHint: '在模型菜单中选择 Ahel 模型。上方你自己的密钥依然可用。',
  offline: '无法连接 ahel.ai，正在重试…',
  starters: '入门提示',
  starterApps: '我安装了哪些应用？',
  starterDiscover: '看看 Discover 上有什么新内容',
  starterConnect: '帮我连接一个应用',
  errorCredits: '今天的 Ahel 额度已用完。请在 ahel.ai 充值，或在“设置 → 模型”中添加自己的密钥',
  errorNotEnabled: '你的工作区尚未开通 Ahel 模型',
  errorSessionEnded: '登录已失效，请重新登录',
  openBilling: '打开 ahel.ai',
  openModels: '设置 → 模型',
}

declare module '@ahel/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Ahel account menu and Models row copy. */
    'ahel-account': AhelAccountKey
  }
}
