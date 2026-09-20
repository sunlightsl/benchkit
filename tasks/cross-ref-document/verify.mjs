import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('doc.md', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'doc.md missing' }))
  process.exit(1)
}
const expected = '# Index\n\n1. alpha\n2. beta\n3. gamma\n\n## 1. alpha\n\nSee also: §3\n\n## 2. beta\n\nSee also: §1\n\n## 3. gamma\n\nSee also: §2, §1\n'
const pass = s === expected
console.log(JSON.stringify({ pass, preview: s.slice(0, 120) }))
process.exit(pass ? 0 : 1)
