import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertTransportAllowed, createTransport, McpTransportRefusedError } from '@ahel/dsh-mcp-client/src/transport.ts'
import type { Config } from '@ahel/dsh-mcp-client'

const stdio: Config = {
  transport: 'stdio', serverName: 'local', command: '/bin/sh', args: ['-c', 'exit 0'], env: {}, cwd: '',
  toolCallTimeoutMs: 1000, failOnStartupError: false,
}
const http: Config = {
  transport: 'streamable-http', serverName: 'remote', url: 'https://mcp.example.test/mcp', headers: {},
  toolCallTimeoutMs: 1000, failOnStartupError: false,
}
const REASON = /^mcp-client\(local\): local \(stdio\) MCP servers are off in the hosted chat; add the server by its http\(s\) URL instead\./

afterEach(() => { vi.unstubAllEnvs() })

describe('hosted chat MCP transport policy', () => {
  it('refuses stdio with a one-line reason under DSH_MCP_STDIO=off and keeps http servers', () => {
    const hosted = { DSH_MCP_STDIO: 'off' }
    expect(() => { assertTransportAllowed(stdio, hosted) }).toThrow(REASON)
    expect(() => { assertTransportAllowed(http, hosted) }).not.toThrow()
    expect(() => { assertTransportAllowed(stdio, {}) }).not.toThrow()

    vi.stubEnv('DSH_MCP_STDIO', 'off')
    expect(() => createTransport(stdio)).toThrow(McpTransportRefusedError)
    expect(createTransport(http)).toBeDefined()
  })
})
