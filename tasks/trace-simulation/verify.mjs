import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL(join(process.cwd(), 'machine.mjs')).href).catch((e) => {
  console.log(JSON.stringify({ pass: false, reason: 'import failed: ' + String(e) }))
  process.exit(1)
})
if (typeof mod.run !== 'function') {
  console.log(JSON.stringify({ pass: false, reason: 'run not exported' }))
  process.exit(1)
}
const bad = []
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const p1 = 'push 3\npush 4\nadd\nout\nhalt\n'
try {
  if (!eq(mod.run(p1), [7])) bad.push(`p1 got ${JSON.stringify(mod.run(p1))}`)
} catch (e) { bad.push(`p1 threw ${String(e)}`) }
const p2 = 'push 3\n:loop\ndup\nout\npush 1\nswap\nsub\ndup\njz end\njmp loop\n:end\nhalt\n'
try {
  if (!eq(mod.run(p2), [3, 2, 1])) bad.push(`p2 got ${JSON.stringify(mod.run(p2))}`)
} catch (e) { bad.push(`p2 threw ${String(e)}`) }
for (const [name, src] of [['p3', 'push 1\nadd'], ['p4', 'jmp nowhere\nhalt'], ['p5', 'frobnicate\nhalt']]) {
  try {
    mod.run(src)
    bad.push(`${name} should have thrown`)
  } catch (e) {
    if (!(e instanceof Error) || e.message !== 'fault') bad.push(`${name} wrong error: ${String(e)}`)
  }
}
const pass = bad.length === 0
console.log(JSON.stringify({ pass, bad }))
process.exit(pass ? 0 : 1)
