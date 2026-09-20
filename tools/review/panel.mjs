#!/usr/bin/env node
/**
 * benchkit review panel — multi-persona AI code review.
 *
 *   node tools/review/panel.mjs --target . \
 *     --files src/runner.mjs,src/adapters.mjs,bin/benchkit.mjs \
 *     --dsh-repo /path/to/deepseek-harness --home ~/.dsh-bench
 *
 * Spawns one headless reviewer per persona in parallel, parses structured
 * findings, dedups by signature, clusters by file, and boosts cross-persona
 * agreement. Raw outputs and parsed findings are kept under
 * <target>/state/reviews/<ts>/ for audit.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dshAdapter } from '../../src/adapters.mjs'
import { killTree } from '../../src/runner.mjs'

const PANEL_DIR = fileURLToPath(new URL('.', import.meta.url))
const PERSONAS_DIR = join(PANEL_DIR, 'personas')

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}
const die = (msg) => { console.error(`panel: ${msg}`); process.exit(2) }

const TARGET = resolve(arg('target', '.'))
const HOME = arg('home', undefined)
const REPO = arg('dsh-repo', process.env.DSH_REPO)
const PERSONAS = arg('personas', 'correctness,security,docs').split(',')
const TIMEOUT_MS = Number(arg('timeout', '600000'))
const OUT_ROOT = resolve(TARGET, arg('out', 'state/reviews'))

// --files: explicit comma-separated paths relative to TARGET,
// or "auto" = every .mjs/.ts under TARGET minus noise directories.
function collectFiles() {
  const explicit = arg('files', 'auto')
  if (explicit !== 'auto') return explicit.split(',').map((f) => f.trim()).filter(Boolean)
  const skip = new Set(['node_modules', '.git', 'state', 'tasks', 'docs'])
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (skip.has(name)) continue
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(mjs|ts)$/.test(name)) out.push(p.slice(TARGET.length + 1).replace(/\\/g, '/'))
    }
  }
  walk(TARGET)
  return out.sort()
}

const FILES = collectFiles()
if (FILES.length === 0) die('no files selected')
const adapter = dshAdapter({ repo: REPO, home: HOME })

function personaPrompt(persona, fileList) {
  const role = readFileSync(join(PERSONAS_DIR, `${persona}.md`), 'utf8')
  return [
    role.trim(),
    '',
    `工作目录：${TARGET}（所有文件路径相对它）。`,
    `请用只读工具审查以下文件：${fileList.join('、')}`,
    '',
    '输出契约：只输出发现条目，每条严格用如下格式（这是唯一会被机器解析的格式）：',
    'FINDING <短横线slug>',
    'severity: high|med|low',
    'file: <相对路径>',
    'issue: <一两句话讲清问题>',
    'suggestion: <一句修法>',
    '',
    '规则：只报你有把握、可核实的问题；没有则输出 NONE。不要修改任何文件，不要使用写工具或执行写操作的命令。条目之间用空行分隔。',
  ].join('\n')
}

function runPersona(persona) {
  const prompt = personaPrompt(persona, FILES)
  return new Promise((resolveRun) => {
    let child
    try {
      // Reviewers read the target directly: their session cwd IS the target,
      // so relative paths and the file policy line up with what we tell them.
      child = adapter.spawn({ prompt, workspace: TARGET, env: process.env })
    } catch (error) {
      resolveRun({ persona, error: String(error), raw: '', text: '', findings: [] })
      return
    }
    let stdout = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => { /* drain: a full pipe buffer would block the child */ })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun({ persona, error: String(error), raw: stdout, text: '', findings: [] })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const text = extractFinalText(stdout)
      resolveRun({ persona, raw: stdout, text, findings: timedOut ? [] : parseFindings(text), timedOut })
    })
  })
}

/** Pull the review prose out of the dsh NDJSON stream: the final event's text,
 *  falling back to all committed text events. */
export function extractFinalText(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch { /* non-JSON */ }
  }
  const final = events.find((e) => e.type === 'final')
  if (final && typeof final.text === 'string') return final.text
  return events.filter((e) => e.type === 'text' && typeof e.text === 'string').map((e) => e.text).join('\n')
}

/** Parse the FINDING blocks; tolerant of label case and extra blank lines. */
export function parseFindings(text) {
  const findings = []
  const blocks = text.split(/^FINDING\s+/m).slice(1)
  for (const block of blocks) {
    const get = (label) => {
      const m = new RegExp(`^${label}:\\s*(.+)$`, 'im').exec(block)
      return m ? m[1].trim() : ''
    }
    const severity = get('severity').toLowerCase()
    const file = get('file')
    const issue = get('issue')
    if (!issue) continue
    findings.push({
      slug: block.slice(0, block.indexOf('\n')).trim(),
      severity: ['high', 'med', 'low'].includes(severity) ? severity : 'low',
      file,
      issue,
      suggestion: get('suggestion'),
    })
  }
  return findings
}

const SEVERITY_RANK = { high: 0, med: 1, low: 2 }
const signature = (f) => `${f.file}|${f.issue.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`

// ---- run the panel -----------------------------------------------------------
const runs = await Promise.all(PERSONAS.map(runPersona))

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join(OUT_ROOT, stamp)
mkdirSync(outDir, { recursive: true })
for (const run of runs) {
  writeFileSync(join(outDir, `raw-${run.persona}.ndjson`), run.raw ?? (run.error ?? ''))
  writeFileSync(join(outDir, `text-${run.persona}.md`), run.text ?? '')
}

// dedup by signature, then cluster by file with persona agreement counts
const bySignature = new Map()
for (const run of runs) {
  for (const f of run.findings ?? []) {
    const sig = signature(f)
    if (!bySignature.has(sig)) bySignature.set(sig, { ...f, personas: [] })
    bySignature.get(sig).personas.push(run.persona)
  }
}
const byFile = new Map()
for (const f of bySignature.values()) {
  const key = f.file || '(unknown)'
  if (!byFile.has(key)) byFile.set(key, [])
  byFile.get(key).push(f)
}
const merged = [...byFile.entries()].flatMap(([file, items]) =>
  items.map((f) => ({ ...f, agreement: new Set(f.personas).size })),
).sort((a, b) => b.agreement - a.agreement || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

const summary = {
  ts: stamp,
  target: TARGET,
  files: FILES,
  personas: PERSONAS,
  personaErrors: runs.filter((r) => r.error || r.timedOut).map((r) => ({ persona: r.persona, error: r.error, timedOut: r.timedOut })),
  parsedCounts: Object.fromEntries(runs.map((r) => [r.persona, (r.findings ?? []).length])),
  findings: merged,
}
writeFileSync(join(outDir, 'findings.json'), JSON.stringify(summary, null, 2))

const lines = [`# Review panel — ${stamp}`, '', `target: \`${TARGET}\`  files: ${FILES.length}  personas: ${PERSONAS.join(',')}`, '']
for (const f of merged) {
  lines.push(`- **[${f.severity}]** \`${f.file}\` — ${f.issue} — *fix: ${f.suggestion}* (${f.personas.join('+')})`)
}
if (merged.length === 0) lines.push('No parsed findings.')
writeFileSync(join(outDir, 'report.md'), lines.join('\n') + '\n')

console.log(`panel: ${runs.length} reviewers, ${merged.length} unique findings → ${outDir}`)
console.log(JSON.stringify(summary.parsedCounts))
for (const f of merged) {
  console.log(`  [${f.severity}] ${f.agreement > 1 ? `(${f.agreement} agree) ` : ''}${f.file} — ${f.issue}`)
}
const anyHigh = merged.some((f) => f.severity === 'high')
const panelBroken = summary.personaErrors.length > 0
if (panelBroken) {
  console.error(`panel: ${summary.personaErrors.length} reviewer(s) failed or timed out — see findings.json`)
}
process.exit(anyHigh || panelBroken ? 1 : 0)
