import { add, sub, mul } from './src/calc.js'
const cases = [[add, 3, 1, 2, 'add'], [sub, 1, 3, 2, 'sub'], [mul, 6, 2, 3, 'mul']]
let ok = true
for (const [fn, want, a, b, name] of cases) {
  const got = fn(a, b)
  if (got !== want) { console.log(`FAIL ${name}: got ${got} want ${want}`); ok = false }
}
console.log(ok ? 'ALL PASS' : 'FAILED')
process.exit(ok ? 0 : 1)
