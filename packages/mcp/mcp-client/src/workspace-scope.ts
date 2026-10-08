/**
 * Per-call workspace of a grant-authenticated Streamable HTTP server. A tool
 * call made for an Agent asks `mcp-client/workspace` (declared in `./index.ts`) which workspace that
 * Agent's Session acts in; every HTTP request the call sends then carries it
 * as the configured `auth.workspaceParam` query parameter in place of the
 * grant's selected workspace. Calls with no answer keep the connection URL.
 *
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { FetchLike } from '@modelcontextprotocol/client'

const callWorkspace = new AsyncLocalStorage<string>()

/**
 * Run one call with its workspace; HTTP requests it sends through {@link workspaceFetch} carry it.
 * @param workspace - the call's workspace, or undefined to send the connection URL unchanged.
 * @param run - the call.
 * @returns what `run` returns.
 */
export function inWorkspace<T>(workspace: string | undefined, run: () => Promise<T>): Promise<T> {
  return workspace === undefined ? run() : callWorkspace.run(workspace, run)
}

/**
 * The transport fetch that replaces `param` with the running call's workspace.
 * @param param - query parameter that names the workspace.
 * @param base - the fetch to wrap.
 * @returns the wrapping fetch.
 */
export function workspaceFetch(param: string, base: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const workspace = callWorkspace.getStore()
    if (workspace === undefined) return await base(input, init)
    const url = new URL(input instanceof URL ? input.href : input)
    url.searchParams.set(param, workspace)
    return await base(url, init)
  }
}
