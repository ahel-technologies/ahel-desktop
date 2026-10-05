/**
 * Stdio MCP fixture server for the MCP Apps card host: one card tool, one
 * app-callable confirm tool, and the `ui://` card resource. The card is a
 * dependency-free MCP Apps view that speaks the same JSON-RPC messages as
 * `@modelcontextprotocol/ext-apps`' App class.
 *
 * Run: node cards-server.mjs
 */
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

const CARD_URI = 'ui://cards/fixture-card-v1.html'
const MIME = 'text/html;profile=mcp-app'

const CARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture card</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2933; --muted: #5b6875; --line: #dfe3e8; --accent: #2f6fed; }
  :root[data-theme="dark"] { --bg: #16191d; --fg: #e6e9ec; --muted: #9aa5b1; --line: #2c3239; --accent: #6b9bff; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 var(--font-sans, -apple-system, system-ui, sans-serif); }
  main { padding: 14px 16px; display: grid; gap: 10px; }
  header { display: flex; align-items: center; gap: 10px; }
  .tile { width: 28px; height: 28px; border-radius: 7px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 600; }
  h1 { font-size: 15px; margin: 0; font-weight: 500; }
  .sub { color: var(--muted); font-size: 12px; }
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
  dt { color: var(--muted); } dd { margin: 0; }
  .row { display: flex; gap: 8px; }
  button { font: inherit; border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  #status { color: var(--muted); font-size: 12px; min-height: 1em; }
</style></head>
<body><main>
  <header><div class="tile">A</div><div><h1 id="title">Waiting for result</h1><div class="sub" id="subtitle">MCP Apps fixture card</div></div></header>
  <dl id="facts"></dl>
  <div class="row"><button class="primary" id="confirm" disabled>Confirm</button><button id="link">Open ahel.ai</button></div>
  <div id="status"></div>
</main>
<script>
(() => {
  let nextId = 1
  const pending = new Map()
  let token
  const post = (message) => window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, message), '*')
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    post({ id, method, params })
  })
  const notify = (method, params) => post({ method, params })
  const $ = (id) => document.getElementById(id)
  const applyContext = (context) => {
    if (!context) return
    if (context.theme) document.documentElement.dataset.theme = context.theme
    const variables = context.styles && context.styles.variables
    if (variables) for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty(name, value)
  }
  const render = (result) => {
    const data = result.structuredContent || {}
    token = result._meta && result._meta['ai.ahel/pressToken']
    $('title').textContent = data.title || 'Card'
    $('subtitle').textContent = data.subtitle || ''
    $('facts').replaceChildren(...Object.entries(data.facts || {}).flatMap(([key, value]) => {
      const dt = document.createElement('dt'); dt.textContent = key
      const dd = document.createElement('dd'); dd.textContent = String(value)
      return [dt, dd]
    }))
    $('confirm').disabled = data.status === 'done' || !token
    $('status').textContent = data.status === 'done' ? 'Confirmed.' : ''
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (!message || message.jsonrpc !== '2.0') return
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
      return
    }
    switch (message.method) {
      case 'ui/notifications/tool-input':
        $('status').textContent = 'Input: ' + JSON.stringify(message.params.arguments)
        break
      case 'ui/notifications/tool-result':
        render(message.params)
        break
      case 'ui/notifications/host-context-changed':
        applyContext(message.params)
        break
      case 'ui/resource-teardown':
        post({ id: message.id, result: {} })
        break
    }
  })
  $('confirm').addEventListener('click', async () => {
    $('status').textContent = 'Confirming…'
    try {
      const result = await request('tools/call', { name: 'confirm_card', arguments: { press_token: token } })
      if (result.isError) $('status').textContent = 'Refused: ' + ((result.content[0] || {}).text || '')
      else render(result)
    } catch (error) {
      $('status').textContent = 'Refused: ' + error.message
    }
  })
  $('link').addEventListener('click', () => { void request('ui/open-link', { url: 'https://ahel.ai/' }) })
  const sendSize = () => notify('ui/notifications/size-changed', {
    width: Math.ceil(window.innerWidth), height: Math.ceil(document.documentElement.getBoundingClientRect().height),
  })
  request('ui/initialize', {
    appInfo: { name: 'fixture-card', version: '1' }, appCapabilities: {}, protocolVersion: '2026-01-26',
  }).then((result) => {
    applyContext(result.hostContext)
    notify('ui/notifications/initialized', {})
    sendSize()
    new ResizeObserver(sendSize).observe(document.body)
  })
})()
</script></body></html>`

serveStdio(() => {
  const server = new McpServer({ name: 'cards-fixture', version: '1.0.0' })
  const appMeta = { ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] }, 'ui/resourceUri': CARD_URI }
  server.registerTool('show_card', {
    description: 'Show the fixture card for an order.',
    inputSchema: z.object({ id: z.string().describe('Order id') }),
    _meta: appMeta,
  }, async args => ({
    content: [{ type: 'text', text: `Order ${args.id} is ready to confirm.` }],
    structuredContent: {
      view: 'question', status: 'pending', title: `Order ${args.id}`, subtitle: 'Fixture MCP server',
      facts: { Items: 3, Total: '42.00 EUR', Delivery: 'Tomorrow' },
    },
    _meta: { 'ai.ahel/pressToken': `press-${args.id}` },
  }))
  server.registerTool('confirm_card', {
    description: 'Confirm a fixture card. Requires the press token from the card.',
    inputSchema: z.object({ press_token: z.string() }),
    _meta: appMeta,
  }, async args => ({
    content: [{ type: 'text', text: `Confirmed with ${args.press_token}.` }],
    structuredContent: {
      view: 'execution', status: 'done', title: 'Order confirmed', subtitle: 'Fixture MCP server',
      facts: { Receipt: args.press_token.replace('press-', 'rcpt-') },
    },
  }))
  server.registerResource('fixture-card', CARD_URI, { mimeType: MIME, description: 'Fixture MCP Apps card' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: MIME, text: CARD_HTML, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } } }],
  }))
  return server
})
