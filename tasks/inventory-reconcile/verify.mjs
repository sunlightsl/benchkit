import { readFileSync } from 'node:fs'
let s = ''
try {
  s = readFileSync('reconcile.md', 'utf8').replace(/\r\n/g, '\n')
} catch {
  console.log(JSON.stringify({ pass: false, reason: 'reconcile.md missing' }))
  process.exit(1)
}
const expected = '## Matched\n\n1001 Widget A S=5 W=5 (qty ok)\n1003 Gadget S=0 W=2 (qty diff)\n\n## System-only\n\n1002 Widget B S=3 W=-\n\n## Warehouse-only\n\n1004 New Item S=- W=9\n\nSummary: matched=2, system-only=1, warehouse-only=1, qty-diff=1\n'
const pass = s === expected
console.log(JSON.stringify({ pass, preview: s.slice(0, 140) }))
process.exit(pass ? 0 : 1)
