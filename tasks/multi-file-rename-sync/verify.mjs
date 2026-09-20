import { existsSync, readFileSync } from 'node:fs'
const bad = []
const contents = { alpha: '# Alpha Guide\n', beta: '# Beta Notes\n', gamma: '# Gamma Reference\n' }
for (const [key, expected] of Object.entries(contents)) {
  const oldPath = `docs/${key}.md`
  const newPath = `docs/0${['alpha', 'beta', 'gamma'].indexOf(key) + 1}-${key}.md`
  if (existsSync(oldPath)) bad.push(`${oldPath} still exists`)
  if (!existsSync(newPath)) { bad.push(`${newPath} missing`); continue }
  if (readFileSync(newPath, 'utf8') !== expected) bad.push(`${newPath} content changed`)
}
let index = null
try {
  index = JSON.parse(readFileSync('index.json', 'utf8'))
} catch {
  bad.push('index.json unreadable')
}
if (index && JSON.stringify(index.docs) !== JSON.stringify(['01-alpha.md', '02-beta.md', '03-gamma.md'])) {
  bad.push(`index.json docs = ${JSON.stringify(index.docs)}`)
}
let readme = ''
try {
  readme = readFileSync('README.md', 'utf8')
} catch {
  bad.push('README.md missing')
}
for (const name of ['01-alpha.md', '02-beta.md', '03-gamma.md']) {
  if (!readme.includes(name)) bad.push(`README missing ${name}`)
}
// Any old-style reference (name.md not preceded by a digit or '-') is a stale reference.
const stale = /(^|[^0-9A-Za-z-])(alpha|beta|gamma)\.md/.exec(readme)
if (stale) bad.push(`README stale reference: ${stale[0]}`)
const pass = bad.length === 0
console.log(JSON.stringify({ pass, bad }))
process.exit(pass ? 0 : 1)
