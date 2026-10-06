// Load the hosted chat under /chat/ in headless Chromium and report what the client did.
// Usage: node cdp.mjs <host log> <proxy origin> <out png>   (CHROME: a Chromium binary)
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [hostLog, origin, png] = process.argv.slice(2)
const token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(hostLog, 'utf8'))[1]
const chrome = spawn(process.env.CHROME ?? join(process.env.HOME, 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  ['--remote-debugging-port=9333', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let target
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page') } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const requests = []; const failures = []; const console_ = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Network.responseReceived') requests.push(`${m.params.response.status} ${m.params.response.url.replace(/token=[^&]+/, 'token=REDACTED')}`)
  if (m.method === 'Network.webSocketCreated') requests.push(`WS ${m.params.url}`)
  if (m.method === 'Network.loadingFailed') failures.push(m.params.errorText)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console_.push(m.params.args.map(a => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable')
const t0 = Date.now()
await send('Page.navigate', { url: `${origin}/?token=${token}` })
let ready = false
for (let i = 0; i < 100 && !ready; i++) {
  await sleep(100)
  const r = await send('Runtime.evaluate', { expression: `!!document.querySelector('textarea, [contenteditable="true"]')`, returnByValue: true })
  ready = r.result?.result?.value === true
}
const ms = Date.now() - t0
await sleep(2500)
const info = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ href: location.href, cookie: document.cookie, text: document.body.innerText.slice(0, 600) })` })
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(png, Buffer.from(shot.result.data, 'base64'))
console.log(JSON.stringify({ composerReadyMs: ready ? ms : null, page: JSON.parse(info.result.result.value), requests: requests.slice(0, 60), failures, consoleErrors: console_.slice(0, 10) }, null, 2))
ws.close(); chrome.kill()
process.exit(0)
