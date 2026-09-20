import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('summary.json', 'utf8').replace(/\r\n/g, '\n').trim()
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'summary.json missing' }))
  process.exit(1)
}
let parsed
try {
  parsed = JSON.parse(s)
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'not valid JSON', raw: s.slice(0, 80) }))
  process.exit(1)
}
const orderOk = s.startsWith('{"total":')
const valueOk = parsed.total === 60 && parsed.count === 3 && parsed.top === 'banana'
const pass = orderOk && valueOk
console.log(JSON.stringify({ pass, orderOk, valueOk, raw: s.slice(0, 80) }))
process.exit(pass ? 0 : 1)
