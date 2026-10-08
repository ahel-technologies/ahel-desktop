/** Board fixture shared by the Issues specs. */
import type { Issue, IssuePage } from '@ahel/dsh-ahel-account/types'
import type { IssuesBackend } from '../src/client/feed.ts'

const base = {
  description: '', priority: 'none', assigneeType: null, assigneeId: null, assigneeName: null, assigneeAvatar: null, project: null,
  labels: [], parentKey: null, creatorType: 'member', creatorName: 'Karl', createdAt: '2026-10-05T09:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z', run: null, commentCount: 0,
} as const satisfies Partial<Issue>

const web = { id: 'p1', name: 'Website' }
const desktop = { id: 'p2', name: 'Desktop' }

/** Issues across the board's columns. */
export const ISSUES: Issue[] = [
  { ...base, key: 'AHEL-131', title: 'Pricing page shows Team at the wrong price in EUR', status: 'backlog', priority: 'low', project: web },
  { ...base, key: 'AHEL-134', title: 'Inbox rows open the issue detail', status: 'todo', priority: 'medium', project: desktop,
    assigneeType: 'member', assigneeId: 'u2', assigneeName: 'Kaarna Pets' },
  { ...base, key: 'AHEL-137', title: 'Write the onboarding checklist for new workspaces and link it from the welcome screen', status: 'in_progress',
    priority: 'high', project: web, labels: ['docs'], assigneeType: 'agent', assigneeId: 'ahel', assigneeName: 'Ahel',
    run: { sessionId: 's1', state: 'running', steps: 4, totalSteps: 9, updatedAt: '2026-10-06T08:00:00.000Z' }, updatedAt: '2026-10-06T08:00:00.000Z' },
  { ...base, key: 'AHEL-138', title: 'Connect Stripe sandbox for the team plan', status: 'blocked', priority: 'urgent', project: desktop,
    assigneeType: 'agent', assigneeId: 'ahel', assigneeName: 'Ahel',
    run: { sessionId: 's2', state: 'waiting_approval', steps: 2, totalSteps: null, updatedAt: '2026-10-06T07:00:00.000Z' } },
  { ...base, key: 'AHEL-129', title: 'Hero greets by first name', status: 'in_review', assigneeType: 'member', assigneeId: 'u1', assigneeName: 'Karl Ahel' },
  { ...base, key: 'AHEL-120', title: 'Ship pricing v2', status: 'done', project: web, assigneeType: 'member', assigneeId: 'u3', assigneeName: 'RIA' },
]

/** One list page carrying every fixture issue. */
export const PAGE: IssuePage = {
  issues: ISSUES, nextCursor: null, agentsWorking: 2, agentsQueued: 0, workspace: null,
  counts: { backlog: 1, todo: 1, in_progress: 1, in_review: 1, blocked: 1, done: 1, cancelled: 0 },
}

/**
 * A typed `ahelIssues` Remote whose unlisted methods reject.
 * @param methods - the methods a spec answers.
 * @returns the backend.
 */
export function backendOf(methods: Partial<IssuesBackend>): IssuesBackend {
  const unused = (): Promise<never> => Promise.reject(new Error('not used by this spec'))
  return {
    list: unused, create: unused, get: unused, update: unused, deleteIssue: unused, comments: unused, comment: unused, assignees: unused,
    activity: unused, run: unused, projects: unused, createProject: unused, ...methods,
  }
}
