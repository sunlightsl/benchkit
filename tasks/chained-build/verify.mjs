import { readFileSync } from 'node:fs'
let indexRaw = ''
let summaryRaw = ''
try {
  indexRaw = readFileSync('index.json', 'utf8').replace(/\r\n/g, '\n').trim()
  summaryRaw = readFileSync('summary.txt', 'utf8').replace(/\r\n/g, '\n')
} catch (e) {
  console.log(JSON.stringify({ pass: false, reason: String(e) }))
  process.exit(1)
}
const expectedIndex = '[{"file":"b.txt","count":2,"sum":30},{"file":"a.txt","count":3,"sum":8},{"file":"c.txt","count":1,"sum":7}]'
const expectedSummary = 'b.txt=30\na.txt=8\nc.txt=7\ntotal=45\n'
const indexOk = indexRaw === expectedIndex
const summaryOk = summaryRaw === expectedSummary
let parsed = null
try { parsed = JSON.parse(indexRaw) } catch { /* handled by exact match */ }
const pass = indexOk && summaryOk
console.log(JSON.stringify({ pass, indexOk, summaryOk, indexPreview: indexRaw.slice(0, 80) }))
process.exit(pass ? 0 : 1)
