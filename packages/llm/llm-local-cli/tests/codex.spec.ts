import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codexArgs, codexPrompt, parseCodexLine } from '../src/codex.ts'

const fixture = readFileSync(new URL('fixtures/codex-exec.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as unknown)

describe('codex exec --json', () => {
  it('reads the thread id, MCP activity, the answer and usage from a recorded run', () => {
    expect(fixture.flatMap(parseCodexLine)).toEqual([
      { kind: 'session', id: '01a10d69-f53e-7102-9ba4-54e196c0b764' },
      { kind: 'boundary' },
      { kind: 'reasoning', text: 'Using ahel: search\n' },
      { kind: 'boundary' },
      { kind: 'text', text: 'pong' },
      {
        kind: 'usage',
        usage: { inputTokens: 29376, outputTokens: 10, totalTokens: 52938, cacheReadTokens: 23552, cacheWriteTokens: 0 },
      },
      { kind: 'result' },
    ])
  })

  it('ignores retry notices and fails on the final error', () => {
    expect(parseCodexLine({ type: 'error', message: 'Reconnecting... 2/5 (unexpected status 401 Unauthorized)' })).toEqual([])
    expect(parseCodexLine({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } }))
      .toEqual([{ kind: 'result', error: 'unexpected status 401 Unauthorized' }])
  })

  it('leads a fresh thread with the instructions and resumes without -C or --sandbox', () => {
    expect(codexPrompt({ system: 'Be terse.', prompt: 'Hi' }, false)).toBe('# Instructions\n\nBe terse.\n\n# Conversation\n\nHi')
    expect(codexPrompt({ system: 'Be terse.', prompt: 'Hi' }, true)).toBe('Hi')
    expect(codexArgs({ cwd: '/w', model: 'default', ahelMcp: false }))
      .toEqual(['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', '/w', '-'])
    expect(codexArgs({ cwd: '/w', model: 'gpt-x', resumeId: 't1', ahelMcp: true })).toEqual([
      'exec', 'resume', 't1', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-m', 'gpt-x',
      '-c', 'mcp_servers.ahel.url="https://mcp.ahel.ai/mcp"', '-c', 'mcp_servers.ahel.bearer_token_env_var="AHEL_MCP_TOKEN"', '-',
    ])
  })
})
