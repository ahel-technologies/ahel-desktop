/** The palette's Chats group lists what the Session browser lists: top-level chats its filter accepts. */
import { expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@ahel/dsh-api-session-controller/client'
import { listedChats } from '../src/client/sources.ts'

function row(id: string, updatedAt: number, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { id, blank: false, updatedAt, retainedBy: {}, ...extra } as SessionSummary
}

it('lists top-level chats newest first, only those the browser filter accepts', () => {
  const rows = [
    row('old', 1), row('new', 3), row('draft', 4, { blank: true }),
    row('child', 5, { origin: 'subagent' }), row('other', 2, { projectionValues: { ahelWorkspace: 'w2' } }),
  ]
  const list = { phase: 'ready', ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) } as SessionListState
  expect(listedChats(list, null).map(r => r.id)).toEqual(['new', 'other', 'old'])
  const scope = (session: SessionSummary): boolean => session.projectionValues?.ahelWorkspace !== 'w2'
  expect(listedChats(list, scope).map(r => r.id)).toEqual(['new', 'old'])
})
