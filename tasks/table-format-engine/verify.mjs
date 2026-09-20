import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL(join(process.cwd(), 'formatTable.mjs')).href).catch((e) => {
  console.log(JSON.stringify({ pass: false, reason: 'import failed: ' + String(e) }))
  process.exit(1)
})
const cases = [
  {
    rows: [['Name', 'Age'], ['alice', '7'], ['bob', '123']],
    aligns: ['left', 'right'],
    want: '| Name  | Age |\n| --- | ---: |\n| alice | 7   |\n| bob   | 123 |\n',
  },
  {
    rows: [['A', 'B'], ['x', ''], ['yy', 'z']],
    aligns: ['center', 'left'],
    want: '| A  | B |\n| :--: | --- |\n| x  |   |\n| yy | z |\n',
  },
  {
    rows: [['hi']],
    aligns: ['right'],
    want: '| hi |\n| ---: |\n',
  },
]
const bad = []
if (typeof mod.formatTable !== 'function') {
  console.log(JSON.stringify({ pass: false, reason: 'formatTable not exported' }))
  process.exit(1)
}
for (const [i, c] of cases.entries()) {
  const got = mod.formatTable(c.rows.map((r) => [...r]), [...c.aligns])
  if (got !== c.want) bad.push(`case${i + 1} got ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`)
}
const pass = bad.length === 0
console.log(JSON.stringify({ pass, bad: bad.slice(0, 3) }))
process.exit(pass ? 0 : 1)
