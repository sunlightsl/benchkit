import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('report.txt', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'report.txt missing' }))
  process.exit(1)
}
const expected = 'bob|012\nalice|007\ncarol|007\ndave|003\n'
const pass = s === expected
console.log(JSON.stringify({ pass, preview: s.slice(0, 80) }))
process.exit(pass ? 0 : 1)
