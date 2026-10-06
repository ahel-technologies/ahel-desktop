// The chat gateway's K8sClient (ahel services/chat-gateway/src/k8s.ts) served
// by the local Docker Engine instead of a cluster, for run-e2e.sh. It covers
// the calls the gateway makes: pods (get, create, delete, patch) and
// persistentvolumeclaims (get, create) in one namespace. A pod becomes a
// container on one bridge network with the pod spec's env, user, memory and
// CPU limits, a read-only root and a /tmp tmpfs; a claim becomes a named
// volume. Readiness is the pod's tcpSocket probe: the port accepts.
import http from 'node:http'
import net from 'node:net'

const API = '/v1.43'

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = http.request({ socketPath: '/var/run/docker.sock', method, path: API + path, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { raw += c })
      res.on('end', () => { let json = null; try { json = JSON.parse(raw) } catch { /* not JSON */ } resolve({ status: res.statusCode, json }) })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

function accepts(ip, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port, timeout: 300 }, () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

const bytes = (q) => { const m = /^(\d+)(Mi|Gi)$/.exec(q ?? ''); return m ? Number(m[1]) * (m[2] === 'Gi' ? 1024 ** 3 : 1024 ** 2) : 0 }
const nanoCpus = (q) => { if (!q) return 0; return q.endsWith('m') ? Number(q.slice(0, -1)) * 1e6 : Number(q) * 1e9 }

// The image entrypoint (docker/chat-host/entrypoint.sh) with one more overlay,
// /stub/stub.patch.yml: --patch must precede the web options it appends.
const ENTRYPOINT = `set -eu
mkdir -p "$DSH_HOME/workspaces"; cd "$DSH_HOME/workspaces"
o=/app/node_modules/@ahel/dsh-web-app/hosted/chat.patch.yml
from="--from-default-profile web"; [ -f "$DSH_HOME/profiles/chat/package.json" ] && from=""
exec node /app/node_modules/@ahel/dsh/lib/bin.js --profile chat $from --patch "$o" --patch /stub/stub.patch.yml \\
  --no-open --port "$CHAT_PORT" --public-url "$CHAT_PUBLIC_URL" --trusted-host "$CHAT_TRUSTED_HOST"`

/**
 * @param {{ network: string, prefix: string, stubDir: string, extraEnv: string[] }} options
 */
export function dockerK8sClient({ network, prefix, stubDir, extraEnv }) {
  const created = new Map() // pod name -> ms when the create call came in
  return {
    created,
    async request(method, path, body) {
      const pvc = /\/persistentvolumeclaims(?:\/([^/?]+))?$/.exec(path)
      if (pvc) {
        if (method === 'GET') return { status: (await docker('GET', `/volumes/${prefix}${pvc[1]}`)).status === 200 ? 200 : 404, json: {} }
        if (method === 'POST') {
          await docker('POST', '/volumes/create', { Name: `${prefix}${body.metadata.name}`, Labels: { 'ahel.e2e': '1' } })
          return { status: 201, json: body }
        }
      }
      const pod = /\/pods(?:\/([^/?]+))?$/.exec(path)
      if (!pod) return { status: 404, json: null }
      const name = pod[1]
      if (method === 'POST') {
        created.set(body.metadata.name, Date.now())
        const c = body.spec.containers[0]
        const claim = body.spec.volumes.find((v) => v.persistentVolumeClaim)?.persistentVolumeClaim.claimName
        const res = await docker('POST', `/containers/create?name=${prefix}${body.metadata.name}`, {
          Image: c.image,
          Env: [...c.env.map((e) => `${e.name}=${e.value}`), ...extraEnv],
          Entrypoint: ['/bin/sh', '-c', ENTRYPOINT],
          Cmd: [],
          User: `${body.spec.securityContext.runAsUser}:${body.spec.securityContext.runAsGroup}`,
          Labels: { 'ahel.e2e': '1', ...body.metadata.labels },
          HostConfig: {
            NetworkMode: network,
            Binds: [`${prefix}${claim}:/data`, `${stubDir}:/stub:ro`],
            ReadonlyRootfs: c.securityContext?.readOnlyRootFilesystem === true,
            // exec: the native addon loader loads from /tmp; a k8s emptyDir is exec too.
            Tmpfs: { '/tmp': 'exec,size=512m' },
            Memory: bytes(c.resources.limits.memory),
            NanoCpus: nanoCpus(c.resources.limits.cpu),
            CapDrop: ['ALL'],
            SecurityOpt: ['no-new-privileges'],
          },
        })
        if (res.status === 409) return { status: 409, json: null }
        if (res.status !== 201) throw new Error(`docker create ${res.status} ${JSON.stringify(res.json)}`)
        await docker('POST', `/containers/${res.json.Id}/start`)
        return { status: 201, json: body }
      }
      if (method === 'DELETE') {
        const res = await docker('DELETE', `/containers/${prefix}${name}?force=1`)
        return { status: res.status === 204 ? 200 : res.status, json: null }
      }
      if (method === 'PATCH') return { status: 200, json: {} }
      if (method === 'GET') {
        const res = await docker('GET', `/containers/${prefix}${name}/json`)
        if (res.status === 404) return { status: 404, json: null }
        const info = res.json
        const ip = info.NetworkSettings?.Networks?.[network]?.IPAddress || undefined
        const running = info.State?.Running === true
        const ready = running && ip ? await accepts(ip, 3080) : false
        const env = (info.Config?.Env ?? []).map((kv) => { const at = kv.indexOf('='); return { name: kv.slice(0, at), value: kv.slice(at + 1) } })
        return {
          status: 200,
          json: {
            metadata: { uid: info.Id },
            spec: { containers: [{ env }] },
            status: {
              phase: running ? 'Running' : info.State?.ExitCode === 0 ? 'Succeeded' : 'Failed',
              podIP: ip,
              conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
            },
          },
        }
      }
      return { status: 405, json: null }
    },
  }
}
