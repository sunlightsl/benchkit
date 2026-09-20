import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('summary.md', 'utf8')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'summary.md missing' }))
  process.exit(1)
}
const required = ['Alpha', 'Beta', 'Gamma', '120', '80', '45', '李明', '王芳', '陈晨']
const missing = required.filter((k) => !s.includes(k))
const pass = missing.length === 0
console.log(JSON.stringify({ pass, missing }))
process.exit(pass ? 0 : 1)
