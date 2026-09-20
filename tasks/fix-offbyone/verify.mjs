import { spawnSync } from 'node:child_process'
const r = spawnSync('node', ['bug.js'], { encoding: 'utf8' })
if (r.error) {
  console.log(JSON.stringify({ pass: false, reason: String(r.error) }))
  process.exit(1)
}
const out = (r.stdout ?? '').trim()
const pass = r.status === 0 && out === '55'
console.log(JSON.stringify({ pass, stdout: out.slice(0, 60), exitCode: r.status }))
process.exit(pass ? 0 : 1)
