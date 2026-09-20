import { readFileSync } from 'node:fs'
const expected = 'name,age,city\nAda,36,London\nBob,28,Paris\nCy,41,Tokyo\n'
let actual = ''
try {
  actual = readFileSync('out.csv', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'out.csv missing' }))
  process.exit(1)
}
const pass = actual === expected
console.log(JSON.stringify({ pass, preview: actual.slice(0, 80) }))
process.exit(pass ? 0 : 1)
