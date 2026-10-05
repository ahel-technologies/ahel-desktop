/**
 * Host face of the MCP Apps card host: Remote access from a card's Client
 * bridge to the MCP server that produced the card. Resources are read through
 * `ctx.mcpResources`; host-proxied tool calls run through the full
 * `ctx.tools` pipeline (pre-execute policy, guards, approval, post-execute)
 * on behalf of the Session's Agent.
 *
 * @module @deepseek-ai/dsh-client-ui-mcp-app
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { publicToolName } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { callResultOf } from './call-result.ts'
import type { McpAppCallResult, McpAppJsonObject } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote access for MCP Apps cards to their own MCP server. */
    mcpApps: McpAppsController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The named tool is not an MCP tool of that server in the Agent's scope. */
    'mcp-app/unknown-tool': { readonly server: string; readonly tool: string }
    /** The tool's MCP Apps visibility does not admit calls from an app. */
    'mcp-app/tool-not-app-visible': { readonly server: string; readonly tool: string }
  }
}

/** Remote namespace `mcpApps`: resource reads and host-proxied tool calls for MCP Apps cards. */
export default class McpAppsController extends TypertRemoteService {
  static inject = ['tools', 'mcpResources']

  /** @param ctx - Host context carrying the tool registry and MCP resource runtime. */
  constructor(ctx: Context) {
    super(ctx, 'mcpApps')
  }

  /**
   * Read one resource from a server visible to the Session's Agent. `ui://`
   * reads are cached by the resource runtime.
   * @param agent - lookup parameter resolved from the Session identity.
   * @param server - configured MCP server name.
   * @param uri - resource URI.
   * @param signal - carrier cancellation.
   * @returns the MCP `resources/read` result.
   */
  @Remote('readResource')
  async readResource(agent: Agent, server: string, uri: string, signal: AbortSignal): Promise<JsonValue> {
    return await this.ctx.mcpResources.readAppResource(agent, server, uri, signal)
  }

  /**
   * Run one MCP tool for a card, through the same registry pipeline and
   * approval seam as a model call. The tool must belong to `server` and its
   * MCP Apps visibility must include `app`.
   * @param agent - lookup parameter resolved from the Session identity.
   * @param server - the card's MCP server; calls to other servers are refused.
   * @param tool - raw MCP tool name.
   * @param args - tool arguments from the card.
   * @param signal - carrier cancellation.
   * @returns MCP `CallToolResult` fields; failures arrive with `isError: true`.
   */
  @Remote('callTool')
  async callTool(agent: Agent, server: string, tool: string, args: McpAppJsonObject, signal: AbortSignal): Promise<McpAppCallResult> {
    const name = publicToolName(server, tool)
    const definition = this.ctx.tools.get(name, agent)
    if (definition?.mcp?.server !== server || definition.mcp.rawName !== tool) {
      throw new RemoteError('mcp-app/unknown-tool', `MCP server "${server}" has no tool "${tool}" in this session`, { server, tool })
    }
    if (!definition.mcp.ui.visibility.includes('app')) {
      throw new RemoteError('mcp-app/tool-not-app-visible', `MCP tool "${tool}" is not callable from an app`, { server, tool })
    }
    const result = await this.ctx.tools.execute({
      callId: ToolCallId(`mcp-app-${randomUUID()}`),
      name,
      arguments: args,
      agent,
      signal,
    })
    return callResultOf(result)
  }
}
