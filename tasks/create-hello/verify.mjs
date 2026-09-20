import { readFileSync } from 'node:fs'
let content = ''
try {
  content = readFileSync('hello.txt', 'utf8')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'hello.txt missing' }))
  process.exit(1)
}
const pass = content.replace(/\r?\n$/, '') === 'Hello, DSH!'
console.log(JSON.stringify({ pass, contentPreview: content.slice(0, 40) }))
process.exit(pass ? 0 : 1)
