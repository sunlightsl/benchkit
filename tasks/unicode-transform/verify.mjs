import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('total.md', 'utf8')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'total.md missing' }))
  process.exit(1)
}
const hasBom = s.charCodeAt(0) === 0xfeff
if (hasBom) s = s.slice(1)
s = s.replace(/\r\n/g, '\n')
const expected = '| 名称 | 单价 | 数量 | 小计 |\n| --- | --- | --- | --- |\n| 铅笔 | 2 | 10 | 20 |\n| 笔记本 | 5 | 20 | 100 |\n| 橡皮 | 1 | 100 | 100 |\n| 总计 |  |  | 220 |\n'
const pass = !hasBom && s === expected
console.log(JSON.stringify({ pass, hasBom, preview: s.slice(0, 100) }))
process.exit(pass ? 0 : 1)
