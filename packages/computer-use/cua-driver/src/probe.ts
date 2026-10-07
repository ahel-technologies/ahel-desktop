/**
 * One-shot MCP stdio client for Host-owned driver reads (the permission
 * status). It opens its own short-lived `cua-driver mcp` proxy, so these reads
 * never pass through the model's tool pipeline or its approval gate.
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/** The parts of an MCP `tools/call` result the Host reads. */
export interface ProbeResult {
  readonly isError?: boolean
  readonly content?: readonly { type: string; text?: string }[]
  readonly structuredContent?: Record<string, unknown>
}

/** Options of {@link probeTool}. */
export interface ProbeOptions {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

/** MCP protocol revision this client offers; the driver answers 2025-06-18. */
const PROTOCOL_VERSION = '2025-06-18'

/**
 * Initialize an MCP stdio server, call one tool, and close the server.
 * @param options - server process and time budget.
 * @param name - tool name as the server lists it.
 * @param args - tool arguments.
 * @returns the tool result.
 */
export async function probeTool(options: ProbeOptions, name: string, args: Record<string, unknown>): Promise<ProbeResult> {
  const child = spawn(options.command, [...options.args], {
    env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-2048) })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const failAll = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }
  child.once('error', (error) => { failAll(error) })
  child.once('exit', (code) => {
    failAll(new Error(`computer use: the driver probe exited with ${String(code)}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}`))
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
    try { message = JSON.parse(line) as typeof message } catch { return }
    if (typeof message.id !== 'number') return
    const waiter = pending.get(message.id)
    if (waiter === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) {
      const reason = typeof message.error.message === 'string' ? message.error.message : 'driver error'
      waiter.reject(new Error(`computer use: ${reason}`))
    }
    else waiter.resolve(message.result)
  })
  let next = 0
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  const timer = setTimeout(() => { failAll(new Error(`computer use: the driver did not answer within ${String(options.timeoutMs)} ms`)) }, options.timeoutMs)
  try {
    await request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'ahel-desktop-probe', version: '1' } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    return await request('tools/call', { name, arguments: args }) as ProbeResult
  } finally {
    clearTimeout(timer)
    lines.close()
    child.stdin.end()
    if (child.exitCode === null) child.kill('SIGTERM')
  }
}
