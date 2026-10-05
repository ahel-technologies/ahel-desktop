/**
 * The `codex-cli` route: runs the person's own unmodified `codex` binary
 * headless (`codex exec --json`) on the ChatGPT or API-key sign-in they made in
 * Terminal. Nothing here reads Codex's credentials: HOME and CODEX_HOME pass
 * through untouched so the CLI finds its own login. With an ahel.ai sign-in,
 * Ahel's MCP server is added through `-c mcp_servers.ahel.*` overrides whose
 * bearer is read by the CLI from `AHEL_MCP_TOKEN`, so no token reaches argv
 * or disk.
 *
 * Product rule: this route is never gated behind an Ahel paid tier. OpenAI's
 * Sign in with ChatGPT terms ("No charge") require that people can use their
 * ChatGPT plan here without paying Ahel or upgrading.
 */

import { mkdir } from 'node:fs/promises'
import { dshHomePath } from '@ahel/dsh-home-paths'
import type { TokenUsage } from '@ahel/dsh-llm'
import { LocalCliAdapter } from './bridge.ts'
import type { CliEvent, CliInvocation, InvocationRequest, LocalCliModel } from './bridge.ts'
import { AHEL_MCP_URL } from './claude.ts'
import { commandArgv } from './detect.ts'
import type { RenderedPrompt } from './transcript.ts'

/** `codex exec` lists no models, so only the person's configured model is offered; `default` passes no `-m`. */
export const CODEX_MODELS: readonly LocalCliModel[] = [
  { id: 'default', name: 'Default', description: 'The model your Codex is set to' },
]

/** Transient `error` events Codex emits while it retries a connection. */
const RETRY_NOTICE = /^Reconnecting\b/
/** Codex's MCP client logs other servers' 401s on stderr; they say nothing about the Codex sign-in. */
const MCP_LOG_LINE = /\brmcp::/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

/**
 * The prompt Codex receives: it has no system-prompt flag, so the system
 * prompt leads as an `# Instructions` section. A resumed thread already holds
 * the instructions and gets the new message alone.
 * @param prompt - system prompt and rendered transcript.
 * @param resume - whether an existing Codex thread continues.
 * @returns the text written to the CLI's stdin.
 */
export function codexPrompt(prompt: RenderedPrompt, resume: boolean): string {
  if (resume || prompt.system.length === 0) return prompt.prompt
  return `# Instructions\n\n${prompt.system}\n\n# Conversation\n\n${prompt.prompt}`
}

/**
 * Build the `codex` arguments for one run; the prompt is read from stdin (`-`).
 * @param options - working directory, model, thread id to resume and whether to add Ahel's MCP server.
 * @returns the arguments after the executable.
 */
export function codexArgs(options: { cwd: string; model: string; resumeId?: string; ahelMcp: boolean }): string[] {
  // `exec resume` takes neither `--sandbox` nor `-C`; the sandbox is set through config and cwd comes from the spawn.
  const head = options.resumeId === undefined
    ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', options.cwd]
    : ['exec', 'resume', options.resumeId, '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"']
  return [
    ...head,
    ...options.model === 'default' ? [] : ['-m', options.model],
    ...options.ahelMcp
      ? ['-c', `mcp_servers.ahel.url="${AHEL_MCP_URL}"`, '-c', 'mcp_servers.ahel.bearer_token_env_var="AHEL_MCP_TOKEN"']
      : [],
    '-',
  ]
}

/**
 * Read one `codex exec --json` line. `exec` sends whole messages, not deltas.
 * @param line - parsed JSON line.
 * @returns the thread id, message and reasoning text, "Using" lines for MCP calls, usage and the result.
 */
export function parseCodexLine(line: unknown): CliEvent[] {
  if (!isRecord(line)) return []
  switch (line.type) {
    case 'thread.started':
      return typeof line.thread_id === 'string' ? [{ kind: 'session', id: line.thread_id }] : []
    case 'item.started': {
      // A call is announced once, when it starts.
      const item = line.item
      if (!isRecord(item) || item.type !== 'mcp_tool_call') return []
      const tool = typeof item.tool === 'string' ? item.tool : 'tool'
      const server = typeof item.server === 'string' ? item.server : 'ahel'
      return [{ kind: 'boundary' }, { kind: 'reasoning', text: `Using ${server}: ${tool}\n` }]
    }
    case 'item.completed': {
      const item = line.item
      if (!isRecord(item) || typeof item.text !== 'string') return []
      if (item.type === 'agent_message') return [{ kind: 'boundary' }, { kind: 'text', text: item.text }]
      if (item.type === 'reasoning') return [{ kind: 'boundary' }, { kind: 'reasoning', text: item.text }]
      return []
    }
    case 'turn.completed': {
      const usage = isRecord(line.usage) ? line.usage : {}
      const input = count(usage.input_tokens)
      const output = count(usage.output_tokens)
      const cacheRead = count(usage.cached_input_tokens)
      const cacheWrite = count(usage.cache_write_input_tokens)
      const reasoning = count(usage.reasoning_output_tokens)
      // Codex counts cached input inside `input_tokens`; harness counts are disjoint.
      const mapped: TokenUsage = {
        inputTokens: Math.max(0, input - cacheRead - cacheWrite),
        outputTokens: output,
        totalTokens: input + output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        ...reasoning > 0 ? { reasoningTokens: reasoning } : {},
      }
      return [{ kind: 'usage', usage: mapped }, { kind: 'result' }]
    }
    case 'turn.failed': {
      const message = isRecord(line.error) && typeof line.error.message === 'string' ? line.error.message : ''
      return [{ kind: 'result', error: message.length > 0 ? message : 'the turn failed' }]
    }
    case 'error': {
      // A later `turn.completed` replaces this result, so only an error the run ends on fails the turn.
      const message = typeof line.message === 'string' ? line.message : ''
      return message.length === 0 || RETRY_NOTICE.test(message) ? [] : [{ kind: 'result', error: message }]
    }
    default:
      return []
  }
}

/** Codex as a model route. */
export class CodexCliAdapter extends LocalCliAdapter {
  protected readonly models = CODEX_MODELS
  protected readonly signInMessage = 'Sign in first: open Terminal and run `codex login`'

  protected async invocation(request: InvocationRequest): Promise<CliInvocation> {
    // An empty working directory: the CLI finds no project files or AGENTS.md to pick up.
    const cwd = dshHomePath('local-cli', 'codex')
    await mkdir(cwd, { recursive: true })
    const token = await this.host.ahelToken()
    const args = codexArgs({
      cwd, model: request.model, ahelMcp: token !== undefined,
      ...request.resumeId === undefined ? {} : { resumeId: request.resumeId },
    })
    return {
      argv: commandArgv(request.executable, args, this.host.platform),
      cwd,
      env: {
        ...token === undefined ? {} : { AHEL_MCP_TOKEN: token },
        // A Desktop started from inside a Codex sandbox must not hand that sandbox's limits to this run.
        CODEX_SANDBOX: undefined, CODEX_SANDBOX_NETWORK_DISABLED: undefined,
      },
      stdin: codexPrompt(request.prompt, request.resumeId !== undefined),
    }
  }

  protected parseLine(line: unknown): CliEvent[] {
    return parseCodexLine(line)
  }

  protected override signInEvidence(resultError: string | undefined, stderr: string): string {
    const own = stderr.split('\n').filter(entry => !MCP_LOG_LINE.test(entry)).join('\n')
    return `${resultError ?? ''}\n${own}`
  }
}
