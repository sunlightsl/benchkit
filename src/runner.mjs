/**
 * benchkit core runner: discover tasks, run each in an isolated workspace
 * through an adapter, verify the workspace programmatically, append a record
 * to results.jsonl, and render a markdown report. Zero dependencies.
 */

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const now = () => new Date().toISOString()

/** Discover task directories: <tasksDir>/<id>/{meta.json,prompt.txt,verify.mjs}. */
export function discoverTasks(tasksDir, { set = 'dev', taskFilter, overlay }) {
  const out = []
  for (const id of readdirSync(tasksDir).sort()) {
    const dir = join(tasksDir, id)
    if (!existsSync(join(dir, 'meta.json'))) continue
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    if (taskFilter && !taskFilter.split(',').includes(meta.id)) continue
    if (set !== 'all' && meta.split !== set) continue
    out.push({
      ...meta,
      dir,
      prompt: readFileSync(join(dir, 'prompt.txt'), 'utf8').trim(),
      timeoutMs: meta.timeoutMs ?? 600000,
    })
  }
  return out
}

/** Content digest of an overlay directory ("" when absent). */
export function digestOverlay(overlay) {
  if (!overlay || !existsSync(overlay)) return ''
  const hash = createHash('sha1')
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else {
        hash.update(p.slice(overlay.length))
        hash.update(readFileSync(p))
      }
    }
  }
  walk(overlay)
  return hash.digest('hex').slice(0, 12)
}

function killTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
}

/**
 * Run one task once. Never throws: failures land in the returned record.
 * @returns the results.jsonl record for this run.
 */
export function runTask(task, { adapter, overlay, stateDir, keepFailures = false, env = process.env, onChildSpawn } = {}) {
  const ws = join(tmpdir(), `benchkit-${task.id}-${randomUUID().slice(0, 8)}`)
  mkdirSync(ws, { recursive: true })
  const fixture = join(task.dir, 'fixture')
  if (existsSync(fixture)) cpSync(fixture, ws, { recursive: true })
  if (overlay && existsSync(overlay)) cpSync(overlay, ws, { recursive: true })

  const t0 = Date.now()
  return new Promise((resolveRun) => {
    let child
    try {
      child = adapter.spawn({ prompt: task.prompt, workspace: ws, env })
    } catch (error) {
      resolveRun(finish(ws, task, t0, { spawnError: String(error) }, { adapter, stateDir, keepFailures }))
      return
    }
    onChildSpawn?.(child)
    let stdout = ''
    let stderrTail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, task.timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun(finish(ws, task, t0, { spawnError: String(error) }, { adapter, stateDir, keepFailures }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun(finish(ws, task, t0, { exitCode: code, stdout, stderrTail, timedOut }, { adapter, stateDir, keepFailures }))
    })
  })
}

function finish(ws, task, t0, run, { adapter, stateDir, keepFailures }) {
  const events = []
  if (run.stdout) {
    for (const line of run.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue
      try { events.push(JSON.parse(line)) } catch { /* non-JSON agent output */ }
    }
  }
  const toolCalls = events.filter((e) => e.type === 'tool_call').length
  const finalEvent = events.find((e) => e.type === 'final')
  const errorEvent = events.find((e) => e.type === 'error')
  const turnEnd = run.timedOut ? 'timeout' : (run.spawnError ? 'spawn-error' : (run.exitCode === 0 ? 'completed' : 'failed'))

  // The workspace is ground truth: the verifier always runs.
  const verify = spawnSync(process.execPath, [join(task.dir, 'verify.mjs')], { cwd: ws, encoding: 'utf8', timeout: 120000 })
  let verifierSummary = {}
  try {
    const lines = (verify.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
    verifierSummary = JSON.parse(lines[lines.length - 1])
  } catch {
    verifierSummary = { parseError: true, raw: (verify.stdout ?? '').slice(0, 200) }
  }
  const pass = !run.timedOut && !run.spawnError && verify.status === 0

  const record = {
    runId: randomUUID(),
    ts: now(),
    taskId: task.id,
    split: task.split,
    tags: task.tags ?? [],
    adapter: adapter.name,
    overlayDigest: '',
    pass,
    metrics: { durationMs: Date.now() - t0, toolCalls },
    turnEnd,
    finalText: finalEvent && typeof finalEvent.text === 'string' ? finalEvent.text.slice(0, 200) : null,
    agentError: errorEvent ? String(errorEvent.message ?? '').slice(0, 300) : null,
    verifier: { exitCode: verify.status, summary: verifierSummary },
  }

  if (!pass && keepFailures) {
    const keepDir = join(stateDir, 'failed', record.runId)
    mkdirSync(keepDir, { recursive: true })
    renameSync(ws, keepDir)
    record.keptWorkspace = keepDir
  } else {
    rmSync(ws, { recursive: true, force: true })
  }
  return record
}

/** Append a record to <stateDir>/results.jsonl. */
export function appendRecord(stateDir, record) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'results.jsonl'), JSON.stringify(record) + '\n', { flag: 'a' })
}

/** Aggregate records into a markdown report; returns { markdown, reportFile }. */
export function writeReport(stateDir, { records, adapter, overlayDigest, set, repeat }) {
  const byTask = new Map()
  for (const rec of records) {
    if (!byTask.has(rec.taskId)) byTask.set(rec.taskId, [])
    byTask.get(rec.taskId).push(rec)
  }
  const lines = []
  lines.push(`# benchkit report — ${now()}`, '')
  lines.push(`- adapter: \`${adapter}\`  overlay: \`${overlayDigest || 'none'}\`  set: ${set}  repeats: ${repeat}`)
  lines.push(`- results: ${records.filter((r) => r.pass).length}/${records.length} passed`, '')
  lines.push('| task | split | tags | pass rate | avg ms | tool calls |', '|---|---|---|---|---|---|')
  for (const [id, recs] of byTask) {
    const p = recs.filter((r) => r.pass).length
    const avgMs = Math.round(recs.reduce((s, r) => s + r.metrics.durationMs, 0) / recs.length)
    const avgTools = (recs.reduce((s, r) => s + r.metrics.toolCalls, 0) / recs.length).toFixed(1)
    lines.push(`| ${id} | ${recs[0].split} | ${(recs[0].tags ?? []).join(',')} | ${(p * 100).toFixed(0)}% (${p}/${recs.length}) | ${avgMs} | ${avgTools} |`)
  }
  const markdown = lines.join('\n') + '\n'
  mkdirSync(stateDir, { recursive: true })
  const reportFile = join(stateDir, `report-${Date.now()}.md`)
  writeFileSync(reportFile, markdown)
  return { markdown, reportFile }
}

/** Resolve paths relative to a base, keeping absolute paths untouched. */
export const abs = (base, p) => resolve(base, p)
