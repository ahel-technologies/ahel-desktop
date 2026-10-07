#!/usr/bin/env node
/**
 * Fake `cua-driver` for tests; it never reads or controls the desktop.
 * `serve --embedded --socket <path>` listens on the socket until SIGTERM.
 * `mcp --embedded --socket <path>` speaks line-delimited MCP on stdio and
 * answers from canned data that mirror the real driver's result shapes.
 * FAKE_CUA_LOG appends one JSON line per event; FAKE_CUA_MODE=fail-serve
 * makes the daemon exit before it opens its socket.
 */
import { appendFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'

const [command, ...rest] = process.argv.slice(2)
const socket = rest[rest.indexOf('--socket') + 1]
const log = (event, data = {}) => {
  if (process.env.FAKE_CUA_LOG) appendFileSync(process.env.FAKE_CUA_LOG, JSON.stringify({ event, command, pid: process.pid, ...data }) + '\n')
}
log('start', {
  args: rest,
  env: Object.fromEntries(['CUA_DRIVER_EMBEDDED', 'CUA_DRIVER_HOST_BUNDLE_ID', 'CUA_DRIVER_RS_HOME', 'DO_NOT_TRACK', 'CUA_TELEMETRY',
    'CUA_DRIVER_RS_TELEMETRY_ENABLED', 'CUA_DRIVER_RS_UPDATE_CHECK', 'ELECTRON_RUN_AS_NODE'].map(key => [key, process.env[key] ?? null])),
})

if (command === 'serve') {
  if (process.env.FAKE_CUA_MODE === 'fail-serve') {
    process.stderr.write('fake daemon refused to start\n')
    process.exit(3)
  }
  const server = createServer(connection => connection.end())
  server.listen(socket, () => log('listening'))
  const stop = () => { server.close(); rmSync(socket, { force: true }); log('stop'); process.exit(0) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else if (command === 'mcp') {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
  const tools = [
    { name: 'check_permissions', description: 'Report TCC permission status.', inputSchema: { type: 'object', properties: { prompt: { type: 'boolean' } } }, annotations: { readOnlyHint: false } },
    { name: 'list_windows', description: 'List windows.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'get_window_state', description: 'Walk one window.', inputSchema: { type: 'object', properties: { pid: { type: 'integer' }, window_id: { type: 'integer' }, query: { type: 'string' } }, required: ['pid', 'window_id'] }, annotations: { readOnlyHint: true } },
    { name: 'get_desktop_state', description: 'Capture the display.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'click', description: 'Click.', inputSchema: { type: 'object', properties: { element_token: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: 'install_extension', description: 'Install an extension.', inputSchema: { type: 'object', properties: { name: { type: 'string' } } }, annotations: { readOnlyHint: false } },
  ]
  const result = (name, args) => {
    switch (name) {
      case 'check_permissions':
        return { content: [{ type: 'text', text: '✅ Accessibility: granted.\n❌ Screen Recording: NOT granted.' }],
          structuredContent: { accessibility: true, screen_recording: false, source: { attribution: 'host', embedded: true, host_bundle_id: process.env.CUA_DRIVER_HOST_BUNDLE_ID } } }
      case 'list_windows':
        return { content: [{ type: 'text', text: 'Found 1 window(s).' }], structuredContent: { windows: [{ app_name: 'TextEdit', pid: 4242, window_id: 77 }] } }
      case 'get_window_state':
        return { content: [{ type: 'text', text: `- [element_index 0] AXButton "Save" (query ${args.query ?? ''})` }],
          structuredContent: { pid: args.pid, window_id: args.window_id, app_name: 'TextEdit', window_title: 'Untitled',
            elements: [{ element_index: 0, element_token: 'tok-save-1', role: 'AXButton', label: 'Save' }], snapshot_id: 'snap-1', tree_markdown: `- [element_index 0] AXButton "Save" (query ${args.query ?? ''})` } }
      case 'get_desktop_state':
        return { content: [{ type: 'text', text: 'Captured display 1x1.' }, { type: 'image', mimeType: 'image/png', data: png }], structuredContent: { width: 1, height: 1, scale: 1 } }
      default:
        return { content: [{ type: 'text', text: `${name} ran` }] }
    }
  }
  const lines = createInterface({ input: process.stdin })
  lines.once('close', () => { log('exit'); process.exit(0) })
  lines.on('line', (line) => {
    const request = JSON.parse(line)
    if (request.id === undefined) return
    let response
    if (request.method === 'initialize') {
      response = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'cua-driver', version: '0.34.0' } }
    } else if (request.method === 'tools/list') {
      response = { tools }
    } else if (request.method === 'tools/call') {
      log('call', { name: request.params.name, arguments: request.params.arguments })
      response = result(request.params.name, request.params.arguments ?? {})
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n')
      return
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: response }) + '\n')
  })
} else {
  process.stderr.write(`fake cua-driver: unsupported command ${command}\n`)
  process.exit(2)
}
