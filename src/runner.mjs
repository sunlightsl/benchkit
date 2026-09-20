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

const STDOUT_CAP_BYTES = 200_000
const STDERR_TAIL_BYTES = 2_000

export const now = () => new Date().toISOString()

/** Discover task directories: <tasksDir>/<id>/{meta.json,prompt.txt,verify.mjs}. */
export function discoverTasks(tasksDir, { set = 'dev', taskFilter } = {}) {
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

/** Content digest of an overlay directory ("" when absent), platform-stable. */
export function digestOverlay(overlay) {
  if (!overlay || !existsSync(overlay)) return ''
  const hash = createHash('sha1')
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else {
        hash.update(p.slice(overlay.length).replace(/\\/g, '/'))
        hash.update(readFileSync(p))
      }
    }
  }
  walk(overlay)
  return hash.digest('hex').slice(0, 12)
}

function killTree(child) {
  if (child.pid === undefined) return
  const pid = String(child.pid)
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' })
    if (r.error || r.status !== 0) child.kill('SIGKILL')
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* already dead */ }
    }
  }
}

/**
 * Run one task once. Never throws: failures land in the returned record.
 * @param options.overlay       Copied into the workspace before the run.
 * @param options.overlayDigest Recorded on the row (pass digestOverlay(overlay)).
 * @param options.requireSuccess Fold the agent's exit code into `pass`.
 */
export function runTask(task, {
  adapter,
  overlay,
  overlayDigest = '',
  stateDir = join(tmpdir(), 'benchkit-state'),
  keepFailures = false,
  requireSuccess = false,
  env = process.env,
  onChildSpawn,
} = {}) {
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
      resolveRun(finish(ws, task, t0, { spawnError: String(error) }, { adapter, overlayDigest, stateDir, keepFailures }))
      return
    }
    onChildSpawn?.(child)
    let stdout = ''
    let stdoutDropped = 0
    let stderrTail = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // Second insurance: never let a wedged child hold the turn open.
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* dead */ } }, 5000).unref()
    }, task.timeoutMs)
    child.stdout.on('data', (d) => {
      if (stdout.length < STDOUT_CAP_BYTES) stdout += d
      else stdoutDropped += d.length
    })
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-STDERR_TAIL_BYTES) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun(finish(ws, task, t0, { spawnError: String(error) }, { adapter, overlayDigest, stateDir, keepFailures }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun(finish(ws, task, t0, { exitCode: code, stdout, stdoutDropped, stderrTail, timedOut }, { adapter, overlayDigest, stateDir, keepFailures, requireSuccess }))
    })
  })
}

function finish(ws, task, t0, run, { adapter, overlayDigest, stateDir, keepFailures, requireSuccess = false }) {
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
  const eventParseWarning = adapter.expectsEvents && run.stdout.trim().length > 0 && events.length === 0
    ? 'non-empty stdout but zero parseable events'
    : undefined

  // The workspace is ground truth: the verifier always runs. A verifier that
  // crashes (spawn error/timeout/status null) is a benchkit problem, not an
  // agent verdict — flag it distinctly.
  const verify = spawnSync(process.execPath, [join(task.dir, 'verify.mjs')], { cwd: ws, encoding: 'utf8', timeout: 120000 })
  let verifierSummary = {}
  try {
    const lines = (verify.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)
    verifierSummary = JSON.parse(lines[lines.length - 1])
  } catch {
    verifierSummary = { parseError: true, raw: (verify.stdout ?? '').slice(0, 200) }
  }
  const summaryPass = typeof verifierSummary.pass === 'boolean' ? verifierSummary.pass : undefined
  // ok: clean verdict. fail: nonzero exit with a verdict. crash: nonzero exit
  // WITHOUT a verdict (verifier itself is broken — a benchkit problem).
  // no-verdict: exit 0 without a verdict. inconsistent: exit code and JSON disagree.
  let verifierStatus
  if (verify.error) verifierStatus = 'spawn-error'
  else if (verify.signal) verifierStatus = 'timeout'
  else if (verify.status === 0) verifierStatus = summaryPass === undefined ? 'no-verdict' : 'ok'
  else verifierStatus = summaryPass === undefined ? 'crash' : 'fail'
  const verifierConsistent = summaryPass === undefined ? undefined : (verify.status === 0) === summaryPass
  let pass = !run.timedOut && !run.spawnError && verifierStatus === 'ok' && summaryPass === true
  if (pass && requireSuccess && run.exitCode !== 0) pass = false

  const record = {
    runId: randomUUID(),
    ts: now(),
    taskId: task.id,
    split: task.split,
    tags: task.tags ?? [],
    adapter: adapter.name,
    overlayDigest,
    pass,
    metrics: {
      durationMs: Date.now() - t0,
      toolCalls,
      eventsParsed: events.length,
      ...(eventParseWarning ? { eventParseWarning } : {}),
      ...(run.stdoutDropped ? { stdoutDroppedBytes: run.stdoutDropped } : {}),
    },
    turnEnd,
    agentExitCode: run.exitCode ?? null,
    ...(run.exitCode !== undefined && run.exitCode !== 0 ? { agentOutcome: 'failed' } : {}),
    finalText: finalEvent && typeof finalEvent.text === 'string' ? finalEvent.text.slice(0, 500) : null,
    agentError: errorEvent ? String(errorEvent.message ?? '').slice(0, 300) : null,
    verifier: {
      status: verifierStatus,
      exitCode: verify.status,
      ...(verifierConsistent === false ? { inconsistent: true } : {}),
      summary: verifierSummary,
    },
  }

  if (!pass && keepFailures) {
    const failedRoot = join(stateDir, 'failed')
    mkdirSync(failedRoot, { recursive: true })
    writeFileSync(join(failedRoot, 'README.md'), [
      '# Preserved failed workspaces',
      '',
      'These trees are agent output: they may contain the planted secrets used by',
      'safety tasks, copies of fixtures, and arbitrary model-generated content.',
      'Do NOT commit, publish, or upload this directory anywhere.',
      '',
    ].join('\n'))
    const keepDir = join(failedRoot, record.runId)
    renameSync(ws, keepDir)
    record.keptWorkspace = keepDir
  } else {
    rmSync(ws, { recursive: true, force: true })
  }
  return record
}

/** Append a record to <stateDir>/results.jsonl. Not safe for concurrent writers. */
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
  lines.push('| task | split | tags | tag | pass rate | avg ms | tool calls |', '|---|---|---|---|---|---|---|')
  for (const [id, recs] of byTask) {
    const p = recs.filter((r) => r.pass).length
    const avgMs = Math.round(recs.reduce((s, r) => s + r.metrics.durationMs, 0) / recs.length)
    const avgTools = (recs.reduce((s, r) => s + r.metrics.toolCalls, 0) / recs.length).toFixed(1)
    const tags = (recs[0].tags ?? []).join(',')
    lines.push(`| ${id} | ${recs[0].split} | ${tags} | ${recs[0].tag ?? ''} | ${(p * 100).toFixed(0)}% (${p}/${recs.length}) | ${avgMs} | ${avgTools} |`)
  }
  const markdown = lines.join('\n') + '\n'
  mkdirSync(stateDir, { recursive: true })
  const reportFile = join(stateDir, `report-${Date.now()}.md`)
  writeFileSync(reportFile, markdown)
  return { markdown, reportFile }
}

/** Resolve paths relative to a base, keeping absolute paths untouched. */
export const abs = (base, p) => resolve(base, p)
