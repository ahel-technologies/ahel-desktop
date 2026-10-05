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
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { liveResultMeta, publicToolName } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { callResultOf, cardActionText, cardContextText } from './call-result.ts'
import type { McpAppCallResult, McpAppJsonObject } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote access for MCP Apps cards to their own MCP server. */
    mcpApps: McpAppsController
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Context reported by an MCP Apps card: a card-initiated tool call or `ui/update-model-context`. */
    'mcp-app': { kind: 'mcp-app' }
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
   * MCP Apps visibility must include `app`. Each call is reported to the
   * Agent as logged context for its next model request (tool name and
   * result text; arguments are omitted because they can carry tokens).
   * @param agent - lookup parameter resolved from the Session identity.
   * @param server - the card's MCP server; calls to other servers are refused.
   * @param tool - raw MCP tool name.
   * @param args - tool arguments from the card.
   * @param signal - carrier cancellation.
   * @returns MCP `CallToolResult` fields; failures arrive with `isError: true`.
   */
  /**
   * Read a call's live result `_meta` (for example a one-use press token).
   * It lives only in Host memory, so after a Host restart this returns `null`.
   * @param agent - lookup parameter resolved from the Session identity.
   * @param callId - the settled tool call the card renders.
   * @returns the result `_meta`, or `null`.
   */
  @Remote('resultMeta')
  resultMeta(agent: Agent, callId: string): McpAppJsonObject | null {
    return liveResultMeta(this.ownerOf(agent), callId) ?? null
  }

  /**
   * Record a card's `ui/update-model-context` payload as context for the
   * Agent's next model request (a logged inbox event).
   * @param agent - lookup parameter resolved from the Session identity.
   * @param server - the card's MCP server.
   * @param update - the payload: `content` blocks and optional `structuredContent`.
   */
  @Remote('updateModelContext')
  updateModelContext(agent: Agent, server: string, update: McpAppJsonObject): void {
    this.report(agent, cardContextText(server, update))
  }

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
    const callId = ToolCallId(`mcp-app-${randomUUID()}`)
    const result = await this.ctx.tools.execute({ callId, name, arguments: args, agent, signal })
    const outcome = callResultOf(result, liveResultMeta(this.ownerOf(agent), callId))
    this.report(agent, cardActionText(server, tool, outcome))
    return outcome
  }

  /** The owner mcp-client keyed live result `_meta` by: the Agent, or the root Context for agentless calls. */
  private ownerOf(agent: Agent | undefined): object {
    return agent ?? this.ctx.root
  }

  /** Queue card-reported text as logged context for the Agent's next model request. */
  private report(agent: Agent | undefined, text: string): void {
    agent?.inject(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'mcp-app' } }))
  }
}
