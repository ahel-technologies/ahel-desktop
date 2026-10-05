import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { geminiArgs, parseGeminiLine } from '../src/gemini.ts'

const fixture = readFileSync(new URL('fixtures/gemini-stream.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as unknown)

describe('gemini --output-format stream-json', () => {
  it('reads tool activity, the answer and usage, and ignores the echoed user message', () => {
    expect(fixture.flatMap(parseGeminiLine)).toEqual([
      { kind: 'boundary' },
      { kind: 'reasoning', text: 'Using google_web_search\n' },
      { kind: 'boundary' },
      { kind: 'text', text: 'pong' },
      { kind: 'usage', usage: { inputTokens: 300, outputTokens: 30, totalTokens: 1530, cacheReadTokens: 1200, cacheWriteTokens: 0 } },
      { kind: 'result' },
    ])
  })

  it('fails on an error result and passes no -m for the default model', () => {
    expect(parseGeminiLine({ type: 'result', status: 'error', error: { type: 'unknown', message: 'API key not valid' } }))
      .toEqual([{ kind: 'result', error: 'API key not valid' }])
    expect(parseGeminiLine({ type: 'error', severity: 'warning', message: 'Loop detected, stopping execution' })).toEqual([])
    expect(geminiArgs({ model: 'default' })).toEqual(['-p', '', '--output-format', 'stream-json'])
    expect(geminiArgs({ model: 'pro' })).toEqual(['-p', '', '--output-format', 'stream-json', '-m', 'pro'])
  })
})
