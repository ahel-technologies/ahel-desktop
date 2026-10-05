/** Prop and injected-face types of the MCP Apps card registration. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { McpAppCallResult, McpAppJsonObject } from '../types.ts'
import type {} from './locales.ts'

/** Session-bound server access and host facts injected into one card. */
export interface McpAppInjected {
  /**
   * Read a resource from a server in this card's Session.
   * @param server - configured MCP server name.
   * @param uri - resource URI.
   * @param signal - cancellation for this read.
   * @returns the `resources/read` result.
   */
  readResource(server: string, uri: string, signal: AbortSignal): Promise<JsonValue>
  /**
   * Run a host-proxied tool call through the Session's tool pipeline.
   * @param server - the card's MCP server.
   * @param tool - raw MCP tool name.
   * @param args - tool arguments.
   * @param signal - cancellation for this call.
   * @returns MCP `CallToolResult` fields.
   */
  callTool(server: string, tool: string, args: McpAppJsonObject, signal: AbortSignal): Promise<McpAppCallResult>
  /**
   * Read a call's live result `_meta` from Host memory.
   * @param callId - the settled call the card renders.
   * @returns the `_meta`, or `null` after a Host restart.
   */
  resultMeta(callId: string): Promise<McpAppJsonObject | null>
  /**
   * Report a card's `ui/update-model-context` payload for the next model turn.
   * @param server - the card's MCP server.
   * @param update - the payload.
   */
  updateModelContext(server: string, update: McpAppJsonObject): void
  /**
   * Open an `http:` or `https:` URL outside the card.
   * @param url - absolute URL.
   */
  openLink(url: string): void
  /** Largest frame height in CSS pixels; taller content scrolls inside the frame. */
  maxHeight: number
  /** Host platform reported to the app. */
  platform: 'web' | 'desktop'
  hooks: {
    /** The app theme's resolved color scheme. */
    colorScheme: HostObservable<'light' | 'dark'>
  }
}

/** Full props of the registered card. */
export type McpAppCardProps = PropsRuntime<'tool.call.app'> & InjectFace<McpAppInjected> & PropsLocale<'mcp-app'>
