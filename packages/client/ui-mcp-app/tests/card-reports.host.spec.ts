/** Card reports reach the Agent once, and never inside a running turn. */

import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@ahel/dsh-agent'
import type { UserMessage } from '@ahel/dsh-llm'
import { CardReports, MAX_REMEMBERED_REPORTS, type ReportTarget } from '../src/card-reports.ts'
import { cardActionText } from '../src/call-result.ts'

/** An Agent double whose running turn ends when the test says so. */
class FakeAgent implements ReportTarget {
  status: AgentStatus = 'idle'
  readonly injected: string[] = []
  private turnEnd = Promise.withResolvers<undefined>()

  startTurn(): void {
    this.status = 'running'
    this.turnEnd = Promise.withResolvers<undefined>()
  }

  endTurn(): void {
    this.status = 'idle'
    this.turnEnd.resolve(undefined)
  }

  whenIdle(): Promise<void> {
    return this.status === 'idle' ? Promise.resolve() : this.turnEnd.promise
  }

  inject(message: UserMessage): void {
    const block = message.content[0]
    this.injected.push(block?.type === 'text' ? block.text : '')
  }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('CardReports', () => {
  it('holds a report made during a running turn until the turn ends', async () => {
    const agent = new FakeAgent()
    const reports = new CardReports()
    agent.startTurn()
    reports.report(agent, '[ahel card] The card called run_action; the call succeeded. Result:\nThat card is cancelled.')
    await settle()
    expect(agent.injected).toEqual([])
    agent.endTurn()
    await settle()
    expect(agent.injected).toEqual(['[ahel card] The card called run_action; the call succeeded. Result:\nThat card is cancelled.'])
  })

  it('waits again when a new turn starts before the held report is delivered', async () => {
    const agent = new FakeAgent()
    const reports = new CardReports()
    agent.startTurn()
    reports.report(agent, 'state')
    // The turn ends and the next prompt starts a turn before the report's continuation runs.
    agent.endTurn()
    agent.startTurn()
    await settle()
    expect(agent.injected).toEqual([])
    agent.endTurn()
    await settle()
    expect(agent.injected).toEqual(['state'])
  })

  it('delivers at once to an idle Agent, in report order', async () => {
    const agent = new FakeAgent()
    const reports = new CardReports()
    reports.report(agent, 'first')
    reports.report(agent, 'second')
    await settle()
    expect(agent.injected).toEqual(['first', 'second'])
  })

  it('drops a report the Agent was already given, as a card redrawn after a reload repeats it', async () => {
    const agent = new FakeAgent()
    const other = new FakeAgent()
    const reports = new CardReports()
    reports.report(agent, 'card is open')
    reports.report(agent, 'card is open')
    reports.report(agent, 'card is cancelled')
    reports.report(other, 'card is open')
    await settle()
    expect(agent.injected).toEqual(['card is open', 'card is cancelled'])
    expect(other.injected).toEqual(['card is open'])
  })

  it('forgets the oldest text past its memory bound', async () => {
    const agent = new FakeAgent()
    const reports = new CardReports()
    for (let index = 0; index <= MAX_REMEMBERED_REPORTS; index += 1) reports.report(agent, `report ${String(index)}`)
    reports.report(agent, 'report 0')
    reports.report(agent, `report ${String(MAX_REMEMBERED_REPORTS)}`)
    await settle()
    expect(agent.injected).toHaveLength(MAX_REMEMBERED_REPORTS + 2)
    expect(agent.injected.at(-1)).toBe('report 0')
  })

  it('reports nothing without an Agent and survives an Agent that refuses delivery', async () => {
    const reports = new CardReports()
    expect(() => { reports.report(undefined, 'lost') }).not.toThrow()
    const disposed = new FakeAgent()
    disposed.inject = () => { throw new Error('agent disposed') }
    reports.report(disposed, 'late')
    await settle()
    expect(disposed.injected).toEqual([])
  })
})

describe('cardActionText', () => {
  it('names the call without claiming a press, which the Host cannot see', () => {
    expect(cardActionText('ahel', 'run_action', { content: [{ type: 'text', text: 'That card is open.' }] }))
      .toBe('[ahel card] The card called run_action; the call succeeded. Result:\nThat card is open.')
    expect(cardActionText('ahel', 'run_action', { content: [], isError: true }))
      .toBe('[ahel card] The card called run_action; the call failed. Result:\n')
  })
})
