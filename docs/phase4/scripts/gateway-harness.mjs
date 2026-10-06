// One container that stands in for the cluster side of ahel.ai/chat in
// run-e2e.sh: the real chat gateway (ahel services/chat-gateway, mounted at
// /gateway) behind a TLS front on :8443, Host pods as Docker containers
// (docker-k8s.mjs) and a fake ahel.ai (fake-ahel.mjs). Env:
//   PUBLIC_HOST   browser-facing authority, e.g. localhost:8443
//   HOST_IMAGE    the ahel-chat-host image to run per person
//   STUB_DIR      host path holding stub.patch.yml and ca.pem (mounted at /stub in each Host)
//   NETWORK       Docker network shared with the Host containers
import { readFileSync } from 'node:fs'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import { createGateway } from '/gateway/src/gateway.ts'
import { createGrantMinter } from '/gateway/src/grant.ts'
import { createHostManager } from '/gateway/src/hosts.ts'
import { createSessionChecker } from '/gateway/src/session.ts'
import { dockerK8sClient } from './docker-k8s.mjs'
import { startFakeAhel } from './fake-ahel.mjs'

const self = process.env.SELF_NAME ?? 'chat-gw'
const publicHost = process.env.PUBLIC_HOST ?? 'localhost:8443'
const secret = randomBytes(32).toString('hex')
const tls = { key: readFileSync('/certs/leaf.key'), cert: readFileSync('/certs/leaf.pem') }

startFakeAhel({ httpPort: 9080, httpsPort: 9443, grantHost: self, publicHost, appOrigin: `https://${self}:9443`, secret, tls })

const config = {
  port: 8080,
  appUrl: `http://${self}:9080`,
  publicHost,
  mount: '/chat/',
  namespace: 'e2e',
  hostImage: process.env.HOST_IMAGE ?? 'ahel-chat-host:e2e',
  hostPort: 3080,
  imagePullSecret: null,
  storageClass: 'local-path',
  gatewaySecret: secret,
}
const client = dockerK8sClient({
  network: process.env.NETWORK ?? 'chat-e2e',
  prefix: 'e2e-',
  stubDir: process.env.STUB_DIR,
  extraEnv: ['NODE_EXTRA_CA_CERTS=/stub/ca.pem'],
})
const gateway = createGateway({
  config,
  session: createSessionChecker(config),
  hosts: createHostManager(config, client, createGrantMinter(config)),
})
// TLS in front, as Cloudflare is in production: the gateway sees the same
// requests and upgrades, on the browser-facing authority.
const front = https.createServer(tls)
front.on('request', (req, res) => gateway.emit('request', req, res))
front.on('upgrade', (req, socket, head) => gateway.emit('upgrade', req, socket, head))
front.listen(8443, '0.0.0.0', () => console.log(`e2e gateway: https://${publicHost}/chat/`))
