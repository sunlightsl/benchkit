import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('warnings.csv', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'warnings.csv missing' }))
  process.exit(1)
}
const expected = 'WARN,2026-09-20,disk nearly full\nERROR,2026-09-20,db connection lost\n'
const pass = s === expected
console.log(JSON.stringify({ pass, preview: s.slice(0, 100) }))
process.exit(pass ? 0 : 1)
