import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('new.json', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'new.json missing' }))
  process.exit(1)
}
const expected = '{"server":{"host":"example.com","port":16162,"debug":true},"limits":{"rate":"1.5","burst":10}}\n'
const pass = s === expected
console.log(JSON.stringify({ pass, raw: s.slice(0, 120) }))
process.exit(pass ? 0 : 1)
