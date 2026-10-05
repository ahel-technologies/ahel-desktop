/**
 * Host half of the card integration spec, kept outside the Client type
 * program: a fixture MCP server (card tool, app-callable confirm tool,
 * model-only tool, `ui://` card) over an in-memory transport, the real
 * mcp-client connection, resource runtime, tool registry, and the
 * `mcpApps` Host controller. Types: card-host.d.mts.
 */
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { resolveReconnectPolicy, startConnection } from '@deepseek-ai/dsh-mcp-client/src/connection.ts'
import McpAppsController from '../../src/index.ts'

/** @param uri @param html */
function cardServer(uri, html) {
  const server = new McpServer({ name: 'cards', version: '1' })
  const appMeta = { ui: { resourceUri: uri, visibility: ['model', 'app'] } }
  server.registerTool('show', { inputSchema: z.object({ id: z.string() }), _meta: appMeta }, async args => ({
    content: [{ type: 'text', text: `card ${args.id}` }],
    structuredContent: { view: 'question', id: args.id },
    _meta: { 'ai.ahel/pressToken': `token-${args.id}` },
  }))
  server.registerTool('confirm', { inputSchema: z.object({ press_token: z.string() }), _meta: appMeta }, async args => ({
    content: [{ type: 'text', text: `confirmed ${args.press_token}` }],
    structuredContent: { view: 'execution', status: 'done' },
  }))
  server.registerTool('search', {
    inputSchema: z.object({}), _meta: { ui: { resourceUri: uri, visibility: ['model'] } },
  }, async () => ({ content: [{ type: 'text', text: 'results' }] }))
  server.registerResource('card', uri, { mimeType: 'text/html;profile=mcp-app' }, async resource => ({
    contents: [{
      uri: resource.href, mimeType: 'text/html;profile=mcp-app', text: html,
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    }],
  }))
  return server
}

/** @type {import('./card-host.d.mts').startCardHost} */
export async function startCardHost({ uri, html, transport }) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpResources)
  await ctx.plugin(McpAppsController)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const serving = serveStdio(() => cardServer(uri, html), { transport: serverTransport })
  transport.mockReturnValue(clientTransport)
  const config = {
    transport: 'stdio', serverName: 'cards', command: 'fixture', args: [], env: {}, cwd: '',
    toolCallTimeoutMs: 60_000, failOnStartupError: true,
  }
  const connection = startConnection(ctx, config, resolveReconnectPolicy({ enabled: false }, 'cards'))
  const outcome = await connection.ready
  if (outcome.error !== undefined) throw outcome.error
  ctx.mcpResources.register('cards', connection.resources)
  // The Host methods take an Agent lookup; this fixture registers every tool globally.
  const agent = undefined
  return {
    execute: (name, args) => ctx.tools.execute({ name, arguments: args, callId: ToolCallId(`call-${name}`), signal: new AbortController().signal }),
    resultMeta: callId => ctx.mcpApps.resultMeta(agent, callId),
    readResource: (server, resourceUri, signal) => ctx.mcpApps.readResource(agent, server, resourceUri, signal),
    callTool: (server, tool, args, signal) => ctx.mcpApps.callTool(agent, server, tool, args, signal),
    denyAll: (reason) => {
      const seen = []
      ctx.on('tools/pre-execute', async (exec) => {
        seen.push(exec.name)
        return { kind: 'deny', reason }
      })
      return seen
    },
    errorCode: failure => remoteErrorOf(failure)?.code,
    dispose: async () => {
      await connection.dispose()
      await serving.close()
      await ctx.fiber.dispose()
    },
  }
}
