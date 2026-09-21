/**
 * benchkit tag diff: compare two labeled runs from state/results.jsonl.
 * Pass rates per task plus duration medians; significance requires repeats —
 * with n < 3 per side the verdict says so instead of inventing statistics.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadResults(stateDir) {
  const file = join(stateDir, 'results.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
}

const median = (xs) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export function diffTags(rows, tagA, tagB) {
  const pick = (tag) => rows.filter((r) => r.tag === tag)
  const a = pick(tagA)
  const b = pick(tagB)
  if (a.length === 0) throw new Error(`no results tagged "${tagA}"`)
  if (b.length === 0) throw new Error(`no results tagged "${tagB}"`)
  const per = (rs) => {
    const m = new Map()
    for (const r of rs) {
      if (!m.has(r.taskId)) m.set(r.taskId, { n: 0, pass: 0, ms: [] })
      const e = m.get(r.taskId)
      e.n += 1
      if (r.pass) e.pass += 1
      e.ms.push(r.metrics?.durationMs ?? 0)
    }
    return m
  }
  const ma = per(a)
  const mb = per(b)
  const taskIds = [...new Set([...ma.keys(), ...mb.keys()])].sort()
  const tasks = taskIds.map((id) => {
    const x = ma.get(id)
    const y = mb.get(id)
    return {
      taskId: id,
      a: x ? { n: x.n, rate: x.pass / x.n, medMs: median(x.ms) } : undefined,
      b: y ? { n: y.n, rate: y.pass / y.n, medMs: median(y.ms) } : undefined,
    }
  })
  const overall = {
    a: { n: a.length, rate: a.filter((r) => r.pass).length / a.length, medMs: median(a.map((r) => r.metrics?.durationMs ?? 0)) },
    b: { n: b.length, rate: b.filter((r) => r.pass).length / b.length, medMs: median(b.map((r) => r.metrics?.durationMs ?? 0)) },
  }
  const minN = Math.min(...tasks.flatMap((t) => [t.a?.n ?? 0, t.b?.n ?? 0]).filter((n) => n > 0), overall.a.n, overall.b.n)
  return { tagA, tagB, tasks, overall, lowReplicates: minN < 3 }
}

const pct = (x) => `${(x * 100).toFixed(0)}%`

export function renderDiff(d) {
  const lines = []
  lines.push(`# benchkit diff — "${d.tagA}" vs "${d.tagB}"`, '')
  lines.push('| task | A pass | B pass | Δ | A median ms | B median ms |', '|---|---|---|---|---|---|')
  for (const t of d.tasks) {
    const delta = t.a && t.b ? t.b.rate - t.a.rate : undefined
    lines.push(`| ${t.taskId} | ${t.a ? `${pct(t.a.rate)} (${t.a.n})` : '—'} | ${t.b ? `${pct(t.b.rate)} (${t.b.n})` : '—'} | ${delta === undefined ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}pp`} | ${t.a?.medMs ?? '—'} | ${t.b?.medMs ?? '—'} |`)
  }
  const od = d.overall.b.rate - d.overall.a.rate
  lines.push('', `**Overall: ${pct(d.overall.a.rate)} (${d.overall.a.n} runs) → ${pct(d.overall.b.rate)} (${d.overall.b.n} runs), ${od >= 0 ? '+' : ''}${(od * 100).toFixed(0)}pp**`)
  lines.push(`Duration medians: ${d.overall.a.medMs}ms → ${d.overall.b.medMs}ms`)
  if (d.lowReplicates) {
    lines.push('', '> Repeats < 3 per side: treat deltas as hints, not signal. Re-run with `--repeat 3` for significance.')
  }
  return lines.join('\n') + '\n'
}
