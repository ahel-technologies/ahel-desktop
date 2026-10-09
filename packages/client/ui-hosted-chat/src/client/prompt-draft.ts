/**
 * The `?prompt=` text ahel.ai's starters open the chat with. On load the
 * text leaves the address bar and waits in this tab's sessionStorage, so it
 * survives Sign in (`/chat/?signin=1` restarts the Host and reloads the page)
 * and a reload; the Chats list scope (./scope.ts) takes it once, into the
 * composer of a blank chat. It is never sent.
 */

/** Query parameter ahel.ai's starters put the prompt text in. */
export const PROMPT_PARAM = 'prompt'

/** sessionStorage key holding the prompt text until a chat takes it. */
export const PROMPT_DRAFT_KEY = 'ahel.chat.promptDraft'

/** Longest prompt text adopted, in UTF-16 code units; longer text is cut, never inside a surrogate pair. */
export const MAX_PROMPT_DRAFT = 4000

/** What one page address carries for the composer. */
export interface PromptParam {
  /** The trimmed, length-capped text, or null when the parameter is absent or blank. */
  readonly prompt: string | null
  /** The address without the parameter (path, other parameters, hash), or null when it had none. */
  readonly stripped: string | null
}

/**
 * Read the prompt parameter of a page address.
 * @param href - the absolute page address.
 * @returns the text and the address to replace the current one with.
 */
export function readPromptParam(href: string): PromptParam {
  const url = new URL(href)
  const raw = url.searchParams.get(PROMPT_PARAM)
  if (raw === null) return { prompt: null, stripped: null }
  let text = raw.trim()
  if (text.length > MAX_PROMPT_DRAFT) {
    const cut = text.slice(0, MAX_PROMPT_DRAFT)
    text = (/[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut).trim()
  }
  url.searchParams.delete(PROMPT_PARAM)
  return { prompt: text === '' ? null : text, stripped: `${url.pathname}${url.search}${url.hash}` }
}

/** The page faces the capture reads and writes; `window` in the browser. */
export interface PromptPage {
  readonly location: Pick<Location, 'href'>
  readonly history: Pick<History, 'replaceState' | 'state'>
  readonly sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

/**
 * Move a `?prompt=` text from the address bar into this tab's stash: the parameter leaves the address
 * (history entry replaced, other parameters kept) and its text replaces any stashed text; a blank one
 * clears the stash. An address without the parameter keeps the stash, which is how the text comes back
 * after Sign in.
 * @param page - the page.
 */
export function capturePromptDraft(page: PromptPage): void {
  const { prompt, stripped } = readPromptParam(page.location.href)
  if (stripped === null) return
  page.history.replaceState(page.history.state, '', stripped)
  try {
    if (prompt === null) page.sessionStorage.removeItem(PROMPT_DRAFT_KEY)
    else page.sessionStorage.setItem(PROMPT_DRAFT_KEY, prompt)
  } catch (_blocked) {
    // Storage blocked (sandboxed frame, private mode): the text is dropped, never sent.
  }
}

/**
 * Take the stashed prompt text, once: the stash is empty afterwards.
 * @param page - the page.
 * @returns the text, or null when none waits.
 */
export function takePromptDraft(page: Pick<PromptPage, 'sessionStorage'>): string | null {
  let text: string | null
  try {
    text = page.sessionStorage.getItem(PROMPT_DRAFT_KEY)
  } catch (_blocked) {
    // Storage blocked: nothing could have been stashed.
    return null
  }
  if (text === null) return null
  try {
    page.sessionStorage.removeItem(PROMPT_DRAFT_KEY)
  } catch (_blocked) {
    // Storage blocked after the read: the text is still used once on this load.
  }
  return text
}
