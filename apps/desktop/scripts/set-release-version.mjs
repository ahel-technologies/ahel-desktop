/**
 * Set the product version on the root manifest and on every tracked workspace manifest that shares it.
 * Vendored and native packages keep their own version lines because they never carry the root version.
 * Usage: `node apps/desktop/scripts/set-release-version.mjs 0.1.0` (a leading `v`, as in a tag, is accepted).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { valid } from 'semver'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const requested = process.argv[2]?.replace(/^v/, '')
if (requested === undefined || valid(requested) === null) {
  throw new Error(`set-release-version: expected a semantic version, got ${JSON.stringify(process.argv[2])}`)
}

const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const manifests = execFileSync('git', ['ls-files', '-z', 'package.json', '**/package.json'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(file => file !== '')
const line = new RegExp(`^(\\s*"version":\\s*)"${current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm')
let changed = 0
for (const file of manifests) {
  const path = join(root, file)
  const text = readFileSync(path, 'utf8')
  if (!line.test(text)) continue
  writeFileSync(path, text.replace(line, `$1"${requested}"`))
  changed += 1
}
process.stdout.write(`set-release-version: ${current} -> ${requested} in ${String(changed)} manifest(s)\n`)
