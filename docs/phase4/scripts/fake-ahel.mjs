// A stand-in for ahel.ai in the hosted-chat end-to-end run (run-e2e.sh). It
// speaks the same contracts as the real app, so the gateway and the Host image
// run unchanged:
//   HTTP  (the gateway's AHEL_APP_URL, the in-cluster app):
//     GET  /api/auth/get-session        better-auth cookie "better-auth.session_token=<user>.<sig>"
//     POST /api/internal/chat/grant     only on its own host name, X-Chat-Gateway-Secret, {user_id, tenant_id?}
//     GET  /stats                       counters for the report
//   HTTPS (the Hosts' appOrigin, ahel.ai and its model proxy):
//     GET  /.well-known/oauth-authorization-server
//     POST /api/auth/mcp/token          refresh_token grant, client ahel-web-chat, rotation (reuse refused)
//     GET  /api/mcp/profile
//     GET  /api/llm/v1/models, POST /api/llm/v1/chat/completions (400 streamed chunks, like mock.mjs)
// Usage: startFakeAhel({ httpPort, httpsPort, grantHost, publicHost, appOrigin, secret, tls })
import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'

const CLIENT_ID = 'ahel-web-chat'
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.split(' ')

export function startFakeAhel({ httpPort, httpsPort, grantHost, publicHost, appOrigin, secret, tls }) {
  const refresh = new Map() // refresh token -> { user, used }
  const access = new Map() // access token -> user
  const stats = { sessionReads: 0, grants: 0, grantRefusals: 0, refreshes: 0, refreshRefusals: 0, profiles: 0, completions: 0, completionRefusals: 0, activeStreams: 0, peakStreams: 0, unanswered: {} }
  const token = (p) => `${p}${randomBytes(16).toString('hex')}`
  const miss = (req) => { const k = `${req.method} ${new URL(req.url, 'http://x').pathname}`; stats.unanswered[k] = (stats.unanswered[k] ?? 0) + 1 }
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
  const body = async (req) => { let raw = ''; for await (const c of req) raw += c; return raw }
  const bearerUser = (req) => access.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))

  const internal = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/stats') return json(res, 200, stats)
    if (url.pathname === '/api/auth/get-session') {
      stats.sessionReads++
      if (req.headers.host !== publicHost) return json(res, 400, { error: 'wrong_host', host: req.headers.host })
      const m = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([a-z0-9-]+)\./i.exec(req.headers.cookie ?? '')
      return m ? json(res, 200, { user: { id: m[1], kind: 'HUMAN', email: `${m[1]}@example.test` }, session: { userId: m[1] } }) : json(res, 200, null)
    }
    if (url.pathname === '/api/internal/chat/grant' && req.method === 'POST') {
      const raw = await body(req)
      // The real route: 404 off its Service host, 401 on a wrong secret.
      if ((req.headers.host ?? '').split(':')[0] !== grantHost) { stats.grantRefusals++; return json(res, 404, { error: 'not_found' }) }
      if (req.headers['x-chat-gateway-secret'] !== secret) { stats.grantRefusals++; return json(res, 401, { error: 'unauthorized' }) }
      let parsed
      try { parsed = JSON.parse(raw) } catch { return json(res, 400, { error: 'invalid_request' }) }
      if (typeof parsed.user_id !== 'string') { stats.grantRefusals++; return json(res, 400, { error: 'invalid_request' }) }
      stats.grants++
      const rt = token('rt-'); const at = token('at-')
      refresh.set(rt, { user: parsed.user_id, used: false }); access.set(at, parsed.user_id)
      return json(res, 200, {
        issuer: appOrigin, token_endpoint: `${appOrigin}/api/auth/mcp/token`, client_id: CLIENT_ID,
        access_token: at, token_type: 'Bearer', expires_in: 3600, expires_at: Date.now() + 3_600_000,
        refresh_token: rt, scope: 'openid profile email offline_access', resource: 'https://mcp.ahel.ai',
        user_id: parsed.user_id, workspace: `ws-${parsed.user_id}`,
      })
    }
    json(res, 404, { error: 'not_found' })
  })

  const external = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url, appOrigin)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, { issuer: appOrigin, authorization_endpoint: `${appOrigin}/api/auth/mcp/authorize`, token_endpoint: `${appOrigin}/api/auth/mcp/token`, registration_endpoint: `${appOrigin}/api/auth/mcp/register` })
    }
    if (url.pathname === '/api/auth/mcp/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req))
      const row = refresh.get(form.get('refresh_token') ?? '')
      if (form.get('grant_type') !== 'refresh_token' || form.get('client_id') !== CLIENT_ID || !row || row.used) {
        stats.refreshRefusals++
        return json(res, 400, { error: 'invalid_grant' })
      }
      row.used = true; stats.refreshes++
      const rt = token('rt-'); const at = token('at-')
      refresh.set(rt, { user: row.user, used: false }); access.set(at, row.user)
      return json(res, 200, { access_token: at, refresh_token: rt, token_type: 'Bearer', expires_in: 3600 })
    }
    const user = bearerUser(req)
    if (url.pathname === '/api/mcp/profile') {
      if (!user) return json(res, 401, { error: 'unauthorized' })
      stats.profiles++
      return json(res, 200, { user: { email: `${user}@example.test`, name: `Person ${user}` }, memberships: [{ id: `ws-${user}`, name: 'Team', slug: 'team', role: 'OWNER' }] })
    }
    if (url.pathname === '/api/llm/v1/models') {
      if (!user) { miss(req); return json(res, 401, { error: 'unauthorized' }) }
      return json(res, 200, { data: [{ id: 'mock/mock-1', name: 'Mock 1', context_length: 128000, max_output_tokens: 8192 }] })
    }
    if (url.pathname === '/api/llm/v1/chat/completions' && req.method === 'POST') {
      await body(req)
      if (!user) { stats.completionRefusals++; return json(res, 401, { error: 'unauthorized' }) }
      stats.completions++; stats.activeStreams++; stats.peakStreams = Math.max(stats.peakStreams, stats.activeStreams)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const id = `c${Date.now()}`
      try {
        for (let i = 0; i < 400; i++) {
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'mock/mock-1', choices: [{ index: 0, delta: { content: `${WORDS[i % WORDS.length]} ` } }] })}\n\n`)
          if (i % 20 === 0) await new Promise((r) => setTimeout(r, 20))
        }
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'mock/mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 400, total_tokens: 1400 } })}\n\n`)
        res.end('data: [DONE]\n\n')
      } finally { stats.activeStreams-- }
      return
    }
    miss(req)
    json(res, 404, { error: 'not_found' })
  })

  internal.listen(httpPort, '0.0.0.0')
  external.listen(httpsPort, '0.0.0.0')
  return { stats, close() { internal.close(); external.close() } }
}
