/**
 * The `claude-code` route: runs the person's own unmodified `claude` binary
 * headless (`claude -p`, stream-json in and out) on the sign-in they made in
 * Terminal. Nothing here reads Claude Code's credentials: HOME and
 * CLAUDE_CONFIG_DIR pass through untouched so the CLI finds its own login.
 * With an ahel.ai sign-in, Ahel's MCP server is handed to the CLI through a
 * temporary config whose bearer is `${AHEL_MCP_TOKEN}`, expanded by the CLI
 * from its environment, so no token is written to disk.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dshHomePath } from '@ahel/dsh-home-paths'
import type { TokenUsage } from '@ahel/dsh-llm'
import { LocalCliAdapter } from './bridge.ts'
import type { CliEvent, CliInvocation, InvocationRequest, LocalCliModel } from './bridge.ts'
import { commandArgv } from './detect.ts'

/** Ahel's hosted MCP endpoint, offered to the CLI while signed in to ahel.ai. */
export const AHEL_MCP_URL = 'https://mcp.ahel.ai/mcp'
/** Used when a request carries no system prompt, so the CLI does not fall back to its coding-agent prompt. */
const FALLBACK_SYSTEM_PROMPT = 'You are a helpful assistant.'
const AHEL_TOOL_PREFIX = 'mcp__ahel__'

/** Aliases the CLI accepts; `default` passes no `--model`, so the person's own Claude Code setting applies. */
export const CLAUDE_MODELS: readonly LocalCliModel[] = [
  { id: 'default', name: 'Default', description: 'The model your Claude Code is set to' },
  { id: 'opus', name: 'Opus' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'haiku', name: 'Haiku' },
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

/**
 * The `--mcp-config` document for Ahel's MCP server; the bearer stays a
 * `${AHEL_MCP_TOKEN}` reference the CLI expands from its environment.
 * @returns the JSON text.
 */
export function ahelMcpConfig(): string {
  return JSON.stringify({
    mcpServers: { ahel: { type: 'http', url: AHEL_MCP_URL, headers: { Authorization: 'Bearer ${AHEL_MCP_TOKEN}' } } },
  })
}

/**
 * Build the `claude` arguments for one run.
 * @param options - files, model and resume id.
 * @returns the arguments after the executable.
 */
export function claudeArgs(options: { systemPromptFile: string; model: string; resumeId?: string; mcpConfigFile?: string }): string[] {
  return [
    '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--include-partial-messages', '--verbose',
    // `--bare` is left out: it skips OAuth and the keychain, so a subscription sign-in is never found.
    '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config',
    '--system-prompt-file', options.systemPromptFile,
    ...options.model === 'default' ? [] : ['--model', options.model],
    ...options.resumeId === undefined ? [] : ['--resume', options.resumeId],
    ...options.mcpConfigFile === undefined ? [] : ['--mcp-config', options.mcpConfigFile, '--allowedTools', `${AHEL_TOOL_PREFIX}*`],
  ]
}

/**
 * Read one `claude -p --output-format stream-json` line.
 * @param line - parsed JSON line.
 * @returns the session id, text and thinking deltas, "Using" lines for tool calls, usage and the result.
 */
export function parseClaudeLine(line: unknown): CliEvent[] {
  if (!isRecord(line)) return []
  switch (line.type) {
    case 'system':
      return line.subtype === 'init' && typeof line.session_id === 'string' ? [{ kind: 'session', id: line.session_id }] : []
    case 'stream_event': {
      const event = line.event
      if (!isRecord(event)) return []
      if (event.type === 'content_block_start') return [{ kind: 'boundary' }]
      const delta = event.delta
      if (event.type !== 'content_block_delta' || !isRecord(delta)) return []
      if (delta.type === 'text_delta' && typeof delta.text === 'string') return [{ kind: 'text', text: delta.text }]
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') return [{ kind: 'reasoning', text: delta.thinking }]
      return []
    }
    case 'assistant': {
      const content = isRecord(line.message) && Array.isArray(line.message.content) ? line.message.content : []
      return content.flatMap((block): CliEvent[] => {
        if (!isRecord(block) || block.type !== 'tool_use' || typeof block.name !== 'string') return []
        const name = block.name.startsWith(AHEL_TOOL_PREFIX) ? block.name.slice(AHEL_TOOL_PREFIX.length) : block.name
        return [{ kind: 'boundary' }, { kind: 'reasoning', text: `Using ahel: ${name}\n` }]
      })
    }
    case 'result': {
      const events: CliEvent[] = []
      if (isRecord(line.usage)) {
        const usage: TokenUsage = {
          inputTokens: count(line.usage.input_tokens),
          outputTokens: count(line.usage.output_tokens),
          cacheReadTokens: count(line.usage.cache_read_input_tokens),
          cacheWriteTokens: count(line.usage.cache_creation_input_tokens),
        }
        events.push({ kind: 'usage', usage })
      }
      if (line.is_error === true || (typeof line.subtype === 'string' && line.subtype.startsWith('error'))) {
        const errors = Array.isArray(line.errors) ? line.errors.filter(item => typeof item === 'string') : []
        const text = typeof line.result === 'string' && line.result.length > 0 ? line.result : errors.join('; ')
        const subtype = typeof line.subtype === 'string' ? line.subtype : 'an error'
        events.push({ kind: 'result', error: text.length > 0 ? text : `the turn ended with ${subtype}` })
      } else {
        events.push({ kind: 'result' })
      }
      return events
    }
    default:
      return []
  }
}

/** Claude Code as a model route. */
export class ClaudeCodeAdapter extends LocalCliAdapter {
  protected readonly models = CLAUDE_MODELS
  protected readonly signInMessage = 'Sign in first: open Terminal and run `claude`'

  protected async invocation(request: InvocationRequest): Promise<CliInvocation> {
    // An empty working directory: the CLI finds no project files or project settings to pick up.
    const cwd = dshHomePath('local-cli', 'claude')
    await mkdir(cwd, { recursive: true })
    const scratch = await mkdtemp(join(tmpdir(), 'ahel-claude-'))
    try {
      const systemPromptFile = join(scratch, 'system.txt')
      await writeFile(systemPromptFile, request.prompt.system.length > 0 ? request.prompt.system : FALLBACK_SYSTEM_PROMPT, { mode: 0o600 })
      const token = await this.host.ahelToken()
      let mcpConfigFile: string | undefined
      if (token !== undefined) {
        mcpConfigFile = join(scratch, 'mcp.json')
        await writeFile(mcpConfigFile, ahelMcpConfig(), { mode: 0o600 })
        await chmod(mcpConfigFile, 0o600)
      }
      const args = claudeArgs({
        systemPromptFile, model: request.model,
        ...request.resumeId === undefined ? {} : { resumeId: request.resumeId },
        ...mcpConfigFile === undefined ? {} : { mcpConfigFile },
      })
      const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: request.prompt.prompt }] } }
      return {
        argv: commandArgv(request.executable, args, this.host.platform),
        cwd,
        env: {
          ...token === undefined ? {} : { AHEL_MCP_TOKEN: token },
          // A Desktop started from a Claude Code terminal must not look like a nested session.
          CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, CLAUDE_CODE_SSE_PORT: undefined,
        },
        stdin: `${JSON.stringify(message)}\n`,
        cleanup: () => rm(scratch, { recursive: true, force: true }),
      }
    } catch (error) {
      await rm(scratch, { recursive: true, force: true })
      throw error
    }
  }

  protected parseLine(line: unknown): CliEvent[] {
    return parseClaudeLine(line)
  }
}
