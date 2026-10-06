// Local stand-in for ahel.ai's chat gateway: /chat/ prefix strip, Host kept,
// cookie Path rewrite, WebSocket upgrades forwarded. Usage: node proxy.mjs <listen> <upstream-port>
import http from 'node:http'
import net from 'node:net'
const [listen, upstream] = process.argv.slice(2).map(Number)
const PREFIX = '/chat'
const log = []
const server = http.createServer((req, res) => {
  if (req.url === PREFIX) { res.writeHead(308, { location: PREFIX + '/' }); return res.end() }
  if (!req.url.startsWith(PREFIX + '/')) { res.writeHead(404); return res.end('not under /chat/\n') }
  const path = req.url.slice(PREFIX.length)
  log.push(`${req.method} ${req.url}`)
  const up = http.request({ host: '127.0.0.1', port: upstream, method: req.method, path, headers: req.headers }, (r) => {
    const headers = { ...r.headers }
    if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(c => c.replace(/Path=\//, `Path=${PREFIX}/`))
    res.writeHead(r.statusCode, headers)
    r.pipe(res)
  })
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)) })
  req.pipe(up)
})
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith(PREFIX + '/')) return socket.destroy()
  log.push(`UPGRADE ${req.url}`)
  const up = net.connect(upstream, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url.slice(PREFIX.length)} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    up.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length) up.write(head)
    up.pipe(socket); socket.pipe(up)
  })
  up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy())
})
server.listen(listen, '127.0.0.1', () => console.log(`proxy :${listen}${PREFIX}/ -> 127.0.0.1:${upstream}`))
process.on('SIGUSR2', () => console.log(log.join('\n')))
