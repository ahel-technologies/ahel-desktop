/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL. A Host started with
 * `DSH_MCP_STDIO=off` (the hosted chat image) refuses stdio servers.
 *
 * @module
 */

import type { AuthProvider, Transport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { scrubbedParentEnv } from '@ahel/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/** Environment switch that refuses stdio servers when set to `off`. */
export const STDIO_POLICY_ENV = 'DSH_MCP_STDIO'

/** A transport this Host does not run, with the one-line reason shown to the person. */
export class McpTransportRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpTransportRefusedError'
  }
}

/**
 * Refuse a stdio server when the Host runs with `DSH_MCP_STDIO=off`: the
 * hosted chat runs no program the person names, so only http(s) MCP servers
 * connect there. The image sets the variable in its entrypoint, outside
 * anything the person's own settings can change.
 * @param config - resolved plugin config.
 * @param env - process environment to read the switch from.
 */
export function assertTransportAllowed(config: Pick<Config, 'transport' | 'serverName'>, env: NodeJS.ProcessEnv = process.env): void {
  if (config.transport === 'stdio' && env[STDIO_POLICY_ENV] === 'off') {
    throw new McpTransportRefusedError(`mcp-client(${config.serverName}): local (stdio) MCP servers are off in the hosted chat; add the server by its http(s) URL instead.`)
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @param authProvider - bearer source for Streamable HTTP servers configured with `auth`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 * @throws McpTransportRefusedError for stdio when `DSH_MCP_STDIO=off`.
 */
export function createTransport(config: Config, authProvider?: AuthProvider): Transport {
  switch (config.transport) {
    case 'stdio':
      assertTransportAllowed(config)
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        {
          requestInit: { headers: config.headers },
          ...authProvider === undefined ? {} : { authProvider },
        },
      )
  }
}
