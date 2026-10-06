// N people open https://<origin>/chat/ at once, each in its own browser
// context (own cookie jar) of one headless Chromium, then each sends T turns
// to the mock model. Reports cold start (navigation to a usable composer,
// including the gateway's "Starting your chat" page and the pod boot), turn
// times, console errors and failed requests.
// Usage: node load.mjs <origin> <users> <turns> [chrome binary]
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [origin = 'https://localhost:8443', usersArg = '20', turnsArg = '3', chromeArg] = process.argv.slice(2)
const USERS = Number(usersArg)
const TURNS = Number(turnsArg)
const chromePath = chromeArg ?? process.env.CHROME ?? join(process.env.HOME, 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell')
const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(chromePath, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-load-'))}`, '--ignore-certificate-errors', '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' })
let version
for (let i = 0; i < 50 && !version; i++) { await sleep(200); try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { /* not up yet */ } }

/** One CDP connection; flat sessions for every page. */
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let nextId = 0
const pending = new Map()
const listeners = new Map() // sessionId -> fn(event)
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) }
  else if (m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId)(m)
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} })) })

async function person(i) {
  const user = `u${String(i).padStart(2, '0')}`
  const out = { user, coldStartMs: null, pageMs: null, turns: [], consoleErrors: [], failed: [], startingPages: 0, signedIn: false }
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  listeners.set(sessionId, (m) => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') out.consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200))
    if (m.method === 'Network.responseReceived') {
      const { status, url } = m.params.response
      if (status === 200 && url === `${origin}/chat/` && out.pageMs === null) out.pageMs = Date.now() - t0
      if (status === 503 && url.endsWith('/chat/')) out.startingPages++
      else if (status >= 400) out.failed.push(`${status} ${url.replace(origin, '')}`)
    }
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) out.failed.push(`ERR ${m.params.errorText}`)
  })
  let t0 = Date.now()
  const s = (method, params) => send(method, params, sessionId)
  const ev = async (expression) => (await s('Runtime.evaluate', { expression, returnByValue: true })).result?.value
  await s('Network.enable'); await s('Runtime.enable'); await s('Page.enable')
  await s('Network.setCookie', { name: 'better-auth.session_token', value: `${user}.sig`, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })
  t0 = Date.now()
  await s('Page.navigate', { url: `${origin}/chat/` })
  for (let k = 0; k < 600; k++) {
    await sleep(100)
    if (await ev(`!!document.querySelector('textarea, [contenteditable="true"]')`).catch(() => false)) { out.coldStartMs = Date.now() - t0; break }
  }
  if (out.coldStartMs === null) return out
  // Signed in through the launch grant: the Ahel model list arrives.
  for (let k = 0; k < 100 && !out.signedIn; k++) { await sleep(100); out.signedIn = (await ev(`document.body.innerText.includes('Mock 1')`)) === true }
  await sleep(500)
  const count = () => ev(`(document.body.innerText.match(/consectetur/g)||[]).length`)
  for (let k = 1; k <= TURNS; k++) {
    const before = await count()
    await ev(`(()=>{const el=document.querySelector('textarea,[contenteditable="true"]'); el.focus(); return true})()`)
    await s('Input.insertText', { text: `turn ${k} from ${user}: write a long answer` })
    await sleep(150)
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    const t = Date.now(); let last = -1; let stable = 0; let done = false
    while (Date.now() - t < 60_000) {
      await sleep(250)
      const c = await count()
      if (c > before && c === last) { if (++stable >= 6) { done = true; break } } else stable = 0
      last = c
    }
    out.turns.push(done ? Date.now() - t - 1500 : null)
  }
  return out
}

const started = Date.now()
const results = await Promise.all(Array.from({ length: USERS }, (_, i) => person(i + 1).catch((e) => ({ user: `u${i + 1}`, error: String(e) }))))
const cold = results.map((r) => r.coldStartMs).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)
const page = results.map((r) => r.pageMs).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)
const turns = results.flatMap((r) => r.turns ?? []).filter((v) => v !== null).sort((a, b) => a - b)
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null
console.log(JSON.stringify({
  users: USERS, turnsEach: TURNS, wallMs: Date.now() - started,
  composerReady: `${cold.length}/${USERS}`, signedIn: `${results.filter((r) => r.signedIn).length}/${USERS}`,
  coldStartMs: { min: cold[0] ?? null, p50: pct(cold, 0.5), p90: pct(cold, 0.9), max: cold.at(-1) ?? null },
  hostPageMs: { min: page[0] ?? null, p50: pct(page, 0.5), p90: pct(page, 0.9), max: page.at(-1) ?? null },
  turnsDone: `${turns.length}/${USERS * TURNS}`,
  turnMs: { p50: pct(turns, 0.5), p90: pct(turns, 0.9), max: turns.at(-1) ?? null },
  startingPagesSeen: results.reduce((n, r) => n + (r.startingPages ?? 0), 0),
  errors: results.filter((r) => r.error).map((r) => `${r.user}: ${r.error}`),
  failedRequests: [...new Set(results.flatMap((r) => r.failed ?? []))].slice(0, 20),
  consoleErrors: [...new Set(results.flatMap((r) => r.consoleErrors ?? []))].slice(0, 10),
}, null, 2))
ws.close(); chrome.kill()
process.exit(0)
