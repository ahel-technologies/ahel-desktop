/** Types of the Host half of the card integration spec (card-host.mjs). */
import type { Mock } from 'vitest'
import type { JsonValue } from '@ahel/dsh-util-values'
import type { McpAppCallResult, McpAppJsonObject } from '../../src/types.ts'

/** Settled registry result fields the spec reads. */
export interface CardHostResult {
  readonly isError: boolean
  readonly meta?: JsonValue
}

/** Running fixture Host. */
export interface CardHost {
  execute(name: string, args: McpAppJsonObject): Promise<CardHostResult>
  resultMeta(callId: string): McpAppJsonObject | null
  readResource(server: string, uri: string, signal: AbortSignal): Promise<JsonValue>
  callTool(server: string, tool: string, args: McpAppJsonObject, signal: AbortSignal): Promise<McpAppCallResult>
  /** Deny every later tool call in pre-execute; returns the names it saw. */
  denyAll(reason: string): string[]
  errorCode(failure: unknown): string | undefined
  dispose(): Promise<void>
}

/** Start the fixture Host; `transport` is the spec's hoisted transport factory mock. */
export function startCardHost(options: { uri: string; html: string; transport: Mock<() => unknown> }): Promise<CardHost>
