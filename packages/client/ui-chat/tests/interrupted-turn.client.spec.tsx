// @vitest-environment jsdom
/** A Turn the Host stopped mid-tool-call, closed afterwards with `interrupted`, never reads as completed. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { createAssistantMessage, createToolResultMessage, ToolCallId } from '@ahel/dsh-llm'
import { SessionSeq, type SessionEvent } from '@ahel/dsh-session/types'
import type { SessionLiveEventEntry } from '@ahel/dsh-api-session-controller/client'
import { ConversationNodeAssembler } from '@ahel/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@ahel/dsh-client-ui-chat/client'
import { makeTranslate } from '@ahel/dsh-client-test-runtime'
import { en as commonEn } from '@ahel/dsh-client-locale/src/locales/en.ts'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import type { TurnProcessSpec } from '../src/client/contract/turn-process.ts'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { turnProcessDefinition } from '../src/client/conversation-nodes/turn-process.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import { TurnProcessNodeView } from '../src/client/chat/TurnProcessNodeView.tsx'
import { en } from '../src/client/locale.ts'

const callId = ToolCallId('explore-call')
const toolBlock = { type: 'tool-call' as const, id: callId, name: 'mcp__ahel__explore', arguments: '{"q":"companies"}' }

function entry(event: SessionEvent): SessionLiveEventEntry {
  return { type: 'event', event }
}

/** The first tool call settled, then the Host went away; its replacement closed the Turn on resume. */
const cutOff = [
  entry({ type: 'turn/start', seq: SessionSeq(1), time: 1_000, data: { turn: 1 } }),
  entry({ type: 'step/start', seq: SessionSeq(2), time: 1_500, data: { turn: 1, step: 1 } }),
  entry({ type: 'assistant/message', seq: SessionSeq(3), time: 2_000, surfaceOp: 'append', data: {
    turn: 1, step: 1, stream: [],
    message: createAssistantMessage({ source: { provider: 'test', model: 'test' }, content: [toolBlock] }),
  } }),
  entry({ type: 'tool/call', seq: SessionSeq(4), time: 2_100,
    data: { turn: 1, step: 1, callId, name: toolBlock.name, arguments: toolBlock.arguments } }),
  entry({ type: 'tool/result', seq: SessionSeq(5), time: 3_000, surfaceOp: 'append', data: {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: '{"rows":[]}' }], isError: false }),
  } }),
  entry({ type: 'turn/end', seq: SessionSeq(6), time: 12_000, data: { turn: 1, reason: { kind: 'interrupted' } } }),
]

function projected(): { node: ChatNode<'turn-process'>; spec: TurnProcessSpec } {
  const assembler = new ConversationNodeAssembler(
    {
      entries: () => [assistantDefinition, toolDefinition, turnProcessDefinition, turnTailDefinition],
      fallbackEntry: () => undefined,
    },
    { entries: () => [chatViewDefinition] },
  )
  assembler.replaceWindow(cutOff, false)
  assembler.activateTarget('chat')
  assembler.flush()
  const snapshot = assembler.snapshot('chat') as ChatSnapshot
  const node = snapshot.nodes.values().find((candidate): candidate is ChatNode<'turn-process'> =>
    candidate.kind === 'turn-process')
  const spec = node === undefined ? undefined : snapshot.nodes.processSource(node.key).getSnapshot()?.spec
  if (node === undefined || spec === undefined) throw new Error('the cut-off Turn projected no turn-process node')
  return { node, spec }
}

describe('Interrupted Turn', () => {
  it('shows Connection lost with a Retry for the Turn instead of a completion time', () => {
    const retryTurn = vi.fn<(turn: number) => void>()
    const { node, spec } = projected()
    // The view reads only these props; the rest of the slot runtime is irrelevant here.
    const props: Pick<ChatNodeViewProps<'turn-process'>, 'node' | 'turnProcess' | 'retryTurn' | 't'> = {
      node,
      turnProcess: { hasContent: true, foldable: true, open: false, setOpen: vi.fn(), spec },
      retryTurn,
      t: makeTranslate(en, commonEn),
    }
    const view = render(<TurnProcessNodeView {...props as ChatNodeViewProps<'turn-process'>} />)
    const row = view.container.querySelector<HTMLElement>('[data-turn-interrupted="1"]')!
    expect(row.querySelector('[data-turn-process="1"]')?.textContent).toBe('Connection lost')
    expect(view.container.textContent).not.toContain('Completed')
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect(retryTurn).toHaveBeenCalledWith(1)
  })
})
