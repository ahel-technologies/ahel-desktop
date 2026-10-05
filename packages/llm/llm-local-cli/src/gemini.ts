// Google: reusing Gemini CLI OAuth from third-party software is a terms violation; only the `gemini` binary talks to Google.

/**
 * The `gemini-cli` route: runs the person's own unmodified `gemini` binary
 * headless (`gemini -p '' --output-format stream-json`, prompt on stdin) on
 * the sign-in they made in Terminal. Nothing here reads Gemini CLI's
 * credentials: HOME passes through untouched so the binary finds `~/.gemini`
 * itself. Headless Gemini has no documented resume, so every turn sends the
 * system prompt and the whole rendered transcript. No MCP server is added in
 * v1 (it would need a settings file); the route is text only.
 */

import { mkdir } from 'node:fs/promises'
import { dshHomePath } from '@ahel/dsh-home-paths'
import type { TokenUsage } from '@ahel/dsh-llm'
import { LocalCliAdapter } from './bridge.ts'
import type { CliEvent, CliInvocation, InvocationRequest, LocalCliModel } from './bridge.ts'
import { codexPrompt } from './codex.ts'
import { commandArgv } from './detect.ts'

/** Aliases the CLI resolves to its current models; `default` passes no `-m`, so the person's own Gemini setting (Auto) applies. */
export const GEMINI_MODELS: readonly LocalCliModel[] = [
  { id: 'default', name: 'Default', description: 'The model your Gemini CLI is set to' },
  { id: 'pro', name: 'Pro' },
  { id: 'flash', name: 'Flash' },
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

/**
 * Build the `gemini` arguments for one run. The prompt is read from stdin;
 * `-p ''` selects headless mode without appending text to it.
 * @param options - model alias.
 * @returns the arguments after the executable.
 */
export function geminiArgs(options: { model: string }): string[] {
  return ['-p', '', '--output-format', 'stream-json', ...options.model === 'default' ? [] : ['-m', options.model]]
}

/**
 * The prompt Gemini receives on stdin: the system prompt leads as an
 * `# Instructions` section, then the transcript. Never empty, since the CLI
 * exits on empty input.
 * @param prompt - system prompt and rendered transcript.
 * @returns the text written to stdin.
 */
export function geminiPrompt(prompt: { system: string; prompt: string }): string {
  const text = codexPrompt(prompt, false)
  return text.trim().length > 0 ? text : '(empty message)'
}

/**
 * Read one `gemini --output-format stream-json` line.
 * @param line - parsed JSON line.
 * @returns assistant text deltas, "Using" lines for tool calls, usage and the result.
 */
export function parseGeminiLine(line: unknown): CliEvent[] {
  if (!isRecord(line)) return []
  switch (line.type) {
    case 'message':
      return line.role === 'assistant' && typeof line.content === 'string' && line.content.length > 0
        ? [{ kind: 'text', text: line.content }]
        : []
    case 'tool_use': {
      const tool = typeof line.tool_name === 'string' ? line.tool_name : 'tool'
      return [{ kind: 'boundary' }, { kind: 'reasoning', text: `Using ${tool}\n` }, { kind: 'boundary' }]
    }
    case 'error':
      // Warnings (loop detection, blocked hooks) do not end the turn; an error-level event is followed by an error result.
      return line.severity === 'error' && typeof line.message === 'string' && line.message.length > 0
        ? [{ kind: 'result', error: line.message }]
        : []
    case 'result': {
      if (line.status !== 'success') {
        const message = isRecord(line.error) && typeof line.error.message === 'string' ? line.error.message : ''
        // Without its own message the result repeats the error event just read.
        return message.length > 0 ? [{ kind: 'result', error: message }] : []
      }
      const stats = isRecord(line.stats) ? line.stats : {}
      const input = count(stats.input_tokens)
      const cacheRead = count(stats.cached)
      const output = count(stats.output_tokens)
      // Gemini counts cached tokens inside `input_tokens`; harness counts are disjoint.
      const usage: TokenUsage = {
        inputTokens: Math.max(0, input - cacheRead),
        outputTokens: output,
        totalTokens: count(stats.total_tokens) || input + output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
      }
      return [{ kind: 'usage', usage }, { kind: 'result' }]
    }
    default:
      return []
  }
}

/** Gemini CLI as a model route. */
export class GeminiCliAdapter extends LocalCliAdapter {
  protected readonly models = GEMINI_MODELS
  protected readonly signInMessage = 'Sign in first: open Terminal and run `gemini` and sign in'

  protected async invocation(request: InvocationRequest): Promise<CliInvocation> {
    // An empty working directory: the CLI finds no project files or GEMINI.md to pick up.
    const cwd = dshHomePath('local-cli', 'gemini')
    await mkdir(cwd, { recursive: true })
    return {
      argv: commandArgv(request.executable, geminiArgs({ model: request.model }), this.host.platform),
      cwd,
      env: {
        // The working directory is Ahel's own empty folder; headless runs fail in an untrusted one.
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
        // A missing or expired sign-in fails at once instead of opening a browser from a background run.
        NO_BROWSER: 'true',
      },
      stdin: geminiPrompt(request.prompt),
    }
  }

  protected parseLine(line: unknown): CliEvent[] {
    return parseGeminiLine(line)
  }
}
