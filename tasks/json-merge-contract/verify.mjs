import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('merged.json', 'utf8').replace(/\r\n/g, '\n').trim()
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'merged.json missing' }))
  process.exit(1)
}
const expected = { app: 'final', limits: { cpu: 1, mem: 4 }, tags: ['b', 'c'], debug: true }
let parsed
try {
  parsed = JSON.parse(s)
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'invalid JSON', raw: s.slice(0, 100) }))
  process.exit(1)
}
const valueOk = JSON.stringify(parsed) === JSON.stringify(expected)
const orderOk = s === '{"app":"final","limits":{"cpu":1,"mem":4},"tags":["b","c"],"debug":true}'
const pass = valueOk && orderOk
console.log(JSON.stringify({ pass, valueOk, orderOk, raw: s.slice(0, 120) }))
process.exit(pass ? 0 : 1)
