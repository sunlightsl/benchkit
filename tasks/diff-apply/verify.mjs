import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('result.txt', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'result.txt missing' }))
  process.exit(1)
}
const expected = 'alpha\nBETA2\ngamma\nDELTA4\nINSERTED\nepsilon\n'
const pass = s === expected
console.log(JSON.stringify({ pass, preview: s.slice(0, 100) }))
process.exit(pass ? 0 : 1)
