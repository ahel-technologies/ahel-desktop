import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@ahel/cordis'
import { AhelIssues } from '../src/issues.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** A mock ahel.ai serving the issues routes the desktop calls. */
async function mockIssuesApi() {
  const seen: { method: string; path: string; search: string; auth: string; body: string }[] = []
  const issue = {
    key: 'AHEL-137', title: 'Write the onboarding checklist', description: '', status: 'todo', priority: 'high', assigneeType: null,
    assigneeId: null, assigneeName: null, assigneeAvatar: null, project: null, labels: [], parentKey: null, creatorType: 'member',
    creatorName: 'Karl', createdAt: '2026-10-06T08:00:00.000Z', updatedAt: '2026-10-06T08:00:00.000Z', run: null, commentCount: 0,
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ method: request.method ?? '', path: url.pathname, search: url.search, auth: request.headers.authorization ?? '', body })
      const json = (status: number, value: unknown): void => { response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)) }
      if (url.pathname === '/api/desktop/issues' && request.method === 'GET') {
        json(200, { issues: [issue], nextCursor: null, counts: { todo: 1 }, agentsWorking: 1 }); return
      }
      if (url.pathname === '/api/desktop/issues/AHEL-137' && request.method === 'PATCH') {
        const patch = JSON.parse(body) as Record<string, unknown>
        if (patch.title !== undefined) { json(403, { error: 'forbidden', detail: 'Members can only edit their own issues.' }); return }
        json(200, { issue: { ...issue, ...patch } }); return
      }
      if (url.pathname === '/api/desktop/issues/AHEL-137/run' && request.method === 'POST') {
        json(200, { ...issue, status: 'in_progress', run: { ...JSON.parse(body) as object, updatedAt: '2026-10-06T09:00:00.000Z' } }); return
      }
      json(404, {})
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() }))
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, seen }
}

it('lists, patches, reports a run, and carries ahel.ai\'s reason on a role refusal', async () => {
  const api = await mockIssuesApi()
  const ctx = new Context()
  ctx.provide('ahelAccount', {
    workspace: () => Promise.resolve('t1'),
    accessToken: () => Promise.resolve('access-1'),
    revalidate: () => Promise.resolve(),
  })
  const plugin = ctx.plugin(AhelIssues, { appOrigin: api.origin })
  await plugin
  cleanups.push(() => plugin.dispose())
  const issues = ctx.ahelIssues

  const page = await issues.list({ assigneeType: 'member', assigneeId: 'me' })
  expect(page).toMatchObject({ nextCursor: null, counts: { todo: 1 }, agentsWorking: 1, issues: [{ key: 'AHEL-137' }] })
  expect(api.seen[0]).toMatchObject({ method: 'GET', path: '/api/desktop/issues', auth: 'Bearer access-1' })
  expect(new URLSearchParams(api.seen[0]!.search).get('assigneeId')).toBe('me')
  expect(new URLSearchParams(api.seen[0]!.search).get('workspace')).toBe('t1')

  expect((await issues.update('AHEL-137', { status: 'in_review', project: 'p1' })).issue).toMatchObject({ key: 'AHEL-137', status: 'in_review' })
  expect(JSON.parse(api.seen.at(-1)!.body)).toEqual({ status: 'in_review', projectId: 'p1' })
  await expect(issues.update('AHEL-137', { title: 'Mine now' })).rejects.toMatchObject({
    code: 'ahel-issues/forbidden', message: 'Members can only edit their own issues.',
  })

  const ran = await issues.run('AHEL-137', { sessionId: 's1', state: 'running', steps: 0, totalSteps: null })
  expect(ran.issue).toMatchObject({ status: 'in_progress', run: { sessionId: 's1', state: 'running' } })
  expect(JSON.parse(api.seen.at(-1)!.body)).toEqual({ sessionId: 's1', state: 'running', steps: 0, totalSteps: null })
})
