import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL(join(process.cwd(), 'parse.mjs')).href).catch((e) => {
  console.log(JSON.stringify({ pass: false, reason: 'import failed: ' + String(e) }))
  process.exit(1)
})
const okCases = [['1h30m', 90], ['45m', 45], ['2h', 120], ['90s', 1.5], ['1h30m45s', 90.75], ['30s', 0.5]]
const throwCases = ['30m1h', 'abc', '', '1h30', '10', '1x']
const bad = []
for (const [input, want] of okCases) {
  try {
    const got = mod.parseDuration(input)
    if (got !== want) bad.push(`parseDuration(${JSON.stringify(input)})=${String(got)} want ${want}`)
  } catch (e) {
    bad.push(`parseDuration(${JSON.stringify(input)}) threw ${String(e)}`)
  }
}
for (const input of throwCases) {
  try {
    const got = mod.parseDuration(input)
    bad.push(`parseDuration(${JSON.stringify(input)})=${String(got)} should have thrown`)
  } catch (e) {
    if (!(e instanceof Error) || e.message !== 'invalid') bad.push(`parseDuration(${JSON.stringify(input)}) wrong error: ${String(e)}`)
  }
}
const exported = typeof mod.parseDuration === 'function'
const pass = exported && bad.length === 0
console.log(JSON.stringify({ pass, exported, bad: bad.slice(0, 5) }))
process.exit(pass ? 0 : 1)
