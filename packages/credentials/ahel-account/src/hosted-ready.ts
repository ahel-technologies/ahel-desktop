/**
 * Readiness of a Host the hosted chat launched: ahel.ai's chat gateway keeps
 * the person on its "Starting your chat" page until the Host has settled its
 * launch grant, so the first page load is already signed in (or definitely
 * signed out). The route answers without the browser cookie and carries no
 * account data.
 * @module @ahel/dsh-ahel-account/hosted-ready
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@ahel/cordis'
import type {} from '@ahel/dsh-host-webserver'

/** Why the Host counts as ready: the launch grant settled, or the ceiling passed first. */
export type HostedReadyReason = 'account' | 'ceiling'

/**
 * Track the first account resolution of a launched Host.
 * @param ctx - effect owner; disposal clears the ceiling timer.
 * @param settled - settles once the launch grant was stored or refused; it never rejects.
 * @param ceilingMs - after this many milliseconds from the call the Host counts as ready even while the grant is unsettled.
 * @returns a reader of the current reason, undefined while not ready.
 */
export function hostedReadiness(ctx: Context, settled: Promise<void>, ceilingMs: number): () => HostedReadyReason | undefined {
  let reason: HostedReadyReason | undefined
  void settled.then(() => { reason ??= 'account' })
  ctx.effect(() => {
    const timer = setTimeout(() => { reason ??= 'ceiling' }, ceilingMs)
    return () => { clearTimeout(timer) }
  }, 'ahel-account.hosted-ready-ceiling')
  return () => reason
}

/**
 * The readiness route handler: `200 {"ready":true,"reason"}` once ready, `503 {"ready":false}` before,
 * `405` for methods other than GET and HEAD. Every answer is `no-store`.
 * @param reason - the reader `hostedReadiness` returned.
 * @returns a `dsh-host-webserver` route handler.
 */
export function hostedReadyHandler(reason: () => HostedReadyReason | undefined): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }).end()
      return
    }
    const current = reason()
    const body = JSON.stringify(current === undefined ? { ready: false } : { ready: true, reason: current })
    res.writeHead(current === undefined ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/**
 * Serve the readiness route on the Host's web server once one is loaded; a Host without `webServer` (Electron) serves none.
 * @param ctx - the account plugin's context.
 * @param path - exact absolute route path.
 * @param reason - the reader `hostedReadiness` returned.
 */
export function serveHostedReady(ctx: Context, path: string, reason: () => HostedReadyReason | undefined): void {
  ctx.inject(['webServer'], (inner) => {
    inner.effect(() => inner.webServer.register({ kind: 'exact', path, handler: hostedReadyHandler(reason) }), `ahel-account.hosted-ready: ${path}`)
  })
}
