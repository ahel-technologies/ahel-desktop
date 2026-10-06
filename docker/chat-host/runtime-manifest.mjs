// Build-stage helper for the ahel-chat-host image: declare one workspace
// package that depends on every first-party package dsh needs at run time
// (dependencies, optional and peer dependencies, transitively), so a
// production `pnpm deploy` of it resolves each package's workspace peers,
// as the Desktop runtime project does. Edits pnpm-workspace.yaml in the
// build container only.
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', '..')
const runtimeDir = 'docker/chat-host/runtime'
const workspaceFile = join(root, 'pnpm-workspace.yaml')
const workspace = readFileSync(workspaceFile, 'utf8')
const block = /^packages:\n((?:  .*\n|\n)*)/m.exec(workspace)
if (block === null) throw new Error('runtime-manifest: pnpm-workspace.yaml has no packages list')
const patterns = block[1].split('\n').filter(line => line.startsWith('  - ')).map(line => line.slice(4).trim())

const manifests = new Map()
for (const path of globSync(patterns.map(pattern => `${pattern}/package.json`), { cwd: root })) {
  const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'))
  manifests.set(manifest.name, manifest)
}

const closure = new Set()
const visit = (name) => {
  if (closure.has(name) || !manifests.has(name)) return
  closure.add(name)
  const manifest = manifests.get(name)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) visit(dependency)
  }
}
visit('@ahel/dsh')

mkdirSync(join(root, runtimeDir), { recursive: true })
writeFileSync(join(root, runtimeDir, 'package.json'), `${JSON.stringify({
  name: '@ahel/chat-host-runtime',
  private: true,
  version: '0.0.0',
  type: 'module',
  dependencies: Object.fromEntries([...closure].sort().map(name => [name, 'workspace:*'])),
}, undefined, 2)}\n`)
// The vendor `link:` overrides would deploy as links back into the build
// tree; every first-party consumer names them with workspace:~ anyway.
const vendorLinks = /^  '(@ahel\/[a-z-]+)': '?link:vendor\/[a-z-]+'?\n/gm
writeFileSync(workspaceFile, workspace.replace(block[0], `packages:\n  - ${runtimeDir}\n${block[1]}`).replace(vendorLinks, ''))
console.log(`runtime-manifest: ${String(closure.size)} workspace packages`)
