import { describe, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { ToolCallId, createMessage, createToolResultMessage } from '@ahel/dsh-llm'
import type { ContentBlock } from '@ahel/dsh-llm'
import type { JsonValue } from '@ahel/dsh-util-values'
import { Session, SessionId } from '@ahel/dsh-session'
import SessionProjectionRegistry from '@ahel/dsh-session-projection'
import TokenMeter from '@ahel/dsh-token-meter'
import ToolResultPruner, { trimNote } from '@ahel/dsh-compaction-tool-result-pruner'

const MODEL = 'test-model'

function service(): ToolResultPruner {
  const ctx = new Context()
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  return new ToolResultPruner(ctx, { earlierResults: { enabled: true, thresholdChars: 200, keepChars: 40 } })
}

const observed = new WeakMap<Session, number>()

/** Feed the events appended since the last call, as the `session/event` listener does, then trim. */
function trim(pruner: ToolResultPruner, session: Session): ReturnType<ToolResultPruner['trimEarlierResults']> {
  const events = session.snapshotEvents()
  for (const event of events.slice(observed.get(session) ?? 0)) pruner.observeEvent(session, event)
  const result = pruner.trimEarlierResults(session)
  observed.set(session, session.snapshotEvents().length)
  return result
}

/** Append one model step that calls a tool and records its result; returns the result seq. */
function toolStep(
  session: Session,
  step: number,
  call: string,
  content: ContentBlock[],
  extra: { isError?: boolean; meta?: JsonValue } = {},
): number {
  const callId = ToolCallId(call)
  session.append('step/start', { turn: 1, step })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'use', arguments: '{}' }],
      source: { kind: 'model', provider: MODEL, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step, callId, name: 'use', arguments: '{}' })
  const result = session.append('tool/result', {
    turn: 1,
    step,
    message: createToolResultMessage({ callId, content, isError: extra.isError === true }),
    ...extra.isError === true ? { error: { name: 'ToolError', code: 'FAILED' } } : {},
    ...extra.meta === undefined ? {} : { meta: extra.meta },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step })
  return result.seq
}

function started(id: string): Session {
  const session = Session.create(SessionId(id))
  session.append('turn/start', { turn: 1 })
  return session
}

function text(char: string, length = 1000): ContentBlock[] {
  return [{ type: 'text', text: char.repeat(length) }]
}

/** Text the next request sends for one call. */
function sent(session: Session, call: string): string {
  const message = session.deriveMessages().find(item => item.role === 'tool' && item.toolCallId === ToolCallId(call))
  return message?.content.map(block => block.type === 'text' ? block.text : '').join('') ?? ''
}

describe('earlier tool-result trimming', () => {
  it('trims a result the model saw and leaves the fresh result whole', () => {
    const session = started('trim-seen')
    toolStep(session, 1, 'seen', text('A'))
    toolStep(session, 2, 'fresh', text('B'))

    const result = trim(service(), session)

    expect(result.pruned.map(entry => entry.callId)).toEqual([ToolCallId('seen')])
    expect(sent(session, 'seen')).toBe(`${'A'.repeat(40)}${trimNote(960)}`)
    expect(sent(session, 'seen')).toContain('[trimmed: 1 KB more; call the tool again for the full result]')
    expect(sent(session, 'fresh')).toBe('B'.repeat(1000))
  })

  it('trims each result once, so every later request sends the same bytes', () => {
    const session = started('trim-stable')
    const pruner = service()
    toolStep(session, 1, 'one', text('A'))
    toolStep(session, 2, 'two', text('B'))
    trim(pruner, session)
    const firstTrim = sent(session, 'one')
    toolStep(session, 3, 'three', text('C'))
    const second = trim(pruner, session)

    expect(second.pruned.map(entry => entry.callId)).toEqual([ToolCallId('two')])
    expect(sent(session, 'one')).toBe(firstTrim)
    expect(trim(pruner, session)).toEqual({ pruned: [], charsRemoved: 0 })
    const replay = Session.create(session.id, session.snapshotEvents())
    expect(replay.deriveMessages()).toEqual(session.deriveMessages())
  })

  it('trims the last step of a finished turn once its answer exists', () => {
    const session = started('trim-turn-end')
    toolStep(session, 1, 'last', text('A'))
    session.append('step/start', { turn: 1, step: 2 })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 2,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'done' }], source: { kind: 'model', provider: MODEL, model: MODEL } }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 2 })

    expect(trim(service(), session).pruned.map(entry => entry.callId)).toEqual([ToolCallId('last')])
  })

  it('never trims errors, cards that ask the person, non-text results, or short results', () => {
    const session = started('trim-skips')
    toolStep(session, 1, 'error', text('E'), { isError: true })
    toolStep(session, 2, 'confirm', text('C'), { meta: { mcpApp: { structuredContent: { view: 'question', mode: 'confirm', interaction: { status: 'pending' } } } } })
    toolStep(session, 3, 'approval', text('P'), { meta: { mcpApp: { structuredContent: { view: 'approval' } } } })
    toolStep(session, 4, 'question-text', [{ type: 'text', text: `${'Q'.repeat(900)} run_action interaction_id=abc` }])
    toolStep(session, 5, 'image', [...text('I'), { type: 'image', attachment: {
      attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } }])
    toolStep(session, 6, 'short', text('S', 200))
    toolStep(session, 7, 'card', text('K'), { meta: { mcpApp: { v: 1, server: 'ahel', tool: 'use', resourceUri: 'ui://ahel/app.html', visibility: ['model'], structuredContent: { rows: [] } } } })
    toolStep(session, 8, 'fresh', text('F'))

    expect(trim(service(), session).pruned.map(entry => entry.callId)).toEqual([ToolCallId('card')])
  })

  it('keeps the stored transcript: originals stay and replacements change only the text', () => {
    const session = started('trim-transcript')
    const meta = { mcpApp: { v: 1, server: 'ahel', tool: 'use', resourceUri: 'ui://ahel/app.html', visibility: ['model'], structuredContent: { rows: [1, 2] } } }
    const seq = toolStep(session, 1, 'card', text('A'), { meta })
    toolStep(session, 2, 'fresh', text('B'))
    const before = structuredClone(session.snapshotEvents())

    const { pruned } = trim(service(), session)

    const after = session.snapshotEvents()
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.filter(event => event.type === 'tool/result' && 'surfaceOp' in event && event.surfaceOp === 'append'))
      .toEqual(before.filter(event => event.type === 'tool/result'))
    const replacement = after[pruned[0]!.replacementSeq]!
    expect(replacement).toMatchObject({ type: 'tool/result', sourceEventSeqs: [seq], surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq } })
    expect(replacement.type === 'tool/result' && replacement.data.meta).toEqual(meta)
    expect(after[pruned[0]!.replacementSeq - 1]).toMatchObject({ type: 'compaction/prune', data: { shadowedSeqs: [seq] } })
  })

  it('keeps block order when the kept text spans several text blocks', () => {
    const pruner = service()
    expect(pruner.trimContent([{ type: 'text', text: 'a'.repeat(30) }, { type: 'text', text: 'b'.repeat(300) }])).toEqual([
      { type: 'text', text: 'a'.repeat(30) },
      { type: 'text', text: `${'b'.repeat(10)}${trimNote(320)}` },
    ])
    expect(pruner.trimContent(text('x', 200))).toBeNull()
  })
})
