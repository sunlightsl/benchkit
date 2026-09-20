import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Ground truth: the pristine fixture test.js must be byte-identical in the workspace.
const original = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'fixture', 'test.js'), 'utf8')
let current = null
try {
  current = readFileSync('test.js', 'utf8')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'test.js missing' }))
  process.exit(1)
}
const untouched = current === original
const r = spawnSync('node', ['test.js'], { encoding: 'utf8' })
const pass = untouched && r.status === 0 && (r.stdout ?? '').includes('ALL PASS')
console.log(JSON.stringify({ pass, untouched, exitCode: r.status, stdout: (r.stdout ?? '').trim().slice(0, 80) }))
process.exit(pass ? 0 : 1)
