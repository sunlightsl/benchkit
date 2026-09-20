#!/usr/bin/env node
/**
 * Runner edge-case regression tests (no real model):
 *  1. an agent that sleeps past the task timeout is reaped and recorded turnEnd=timeout
 *  2. --keep-failures preserves the workspace under stateDir/failed with the README warning
 *  3. --require-success folds a nonzero agent exit into pass=false
 *  4. a verifier that crashes is reported as verifier.status='crash', never a silent pass
 *  5. the command adapter substitutes {{prompt}} (regression: prompt was silently dropped)
 *  6. the verifier env is secret-scrubbed via process.env (vacuous-if-via-option regression)
 *  7. hostile task ids (path traversal) are rejected at discovery time
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandAdapter } from '../src/adapters.mjs'
import { discoverTasks, runTask } from '../src/runner.mjs'

const KIT = fileURLToPath(new URL('..', import.meta.url))
let failures = 0
const check = (name, cond, detail = '') => {
  if (!cond) failures += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`)
}

function makeTask(id, verifyBody) {
  const dir = join(STATE, 'tasks', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id, split: 'dev', tags: ['edge'], timeoutMs: 3000 }))
  writeFileSync(join(dir, 'prompt.txt'), 'do the thing\n')
  writeFileSync(join(dir, 'verify.mjs'), verifyBody)
  return { id, dir, prompt: 'do the thing', timeoutMs: 3000, split: 'dev', tags: ['edge'] }
}

const STATE = mkdtempSync(join(tmpdir(), 'benchkit-edge-'))
const sleeper = join(STATE, 'sleeper.mjs')
writeFileSync(sleeper, 'setTimeout(() => {}, 60000)\n')
const sleepAgent = commandAdapter({ template: `node "${sleeper}"` })
const failExitAgent = commandAdapter({ template: 'node -e "process.exit(3)"' })
const noopAgent = commandAdapter({ template: 'node -e ""' })
const brokenVerify = makeTask('edge-broken-verify', 'this is not valid javascript at all(')
const okVerify = makeTask('edge-ok', 'console.log(JSON.stringify({ pass: true }))')
const failingVerify = makeTask('edge-fail', 'console.log(JSON.stringify({ pass: false, reason: "missing" }))\nprocess.exit(1)')

// 1. timeout reap
{
  const rec = await runTask(okVerify, { adapter: sleepAgent, stateDir: STATE })
  check('timeout: turnEnd recorded', rec.turnEnd === 'timeout', `got ${rec.turnEnd}`)
  check('timeout: not a pass', rec.pass === false)
}

// 2. keep-failures preserves the workspace of a FAILED run
{
  const rec = await runTask(failingVerify, { adapter: noopAgent, stateDir: STATE, keepFailures: true })
  check('keep-failures: run failed as designed', rec.pass === false, `pass=${rec.pass}`)
  check('keep-failures: workspace preserved', typeof rec.keptWorkspace === 'string' && existsSync(rec.keptWorkspace), 'keptWorkspace missing')
  check('keep-failures: warning note written', existsSync(join(STATE, 'failed', 'README.md')))
}

// 3. require-success
{
  // workspace satisfies the verifier, but the agent exited 3
  const rec = await runTask(okVerify, { adapter: failExitAgent, stateDir: STATE })
  check('default: exit code ignored (workspace is truth)', rec.pass === true && rec.agentExitCode === 3, JSON.stringify({ pass: rec.pass, exit: rec.agentExitCode }))
  const rec2 = await runTask(okVerify, { adapter: failExitAgent, stateDir: STATE, requireSuccess: true })
  check('require-success: nonzero exit fails the run', rec2.pass === false)
  check('require-success: agentOutcome recorded', rec2.agentOutcome === 'failed')
}

// 4. verifier crash surfaces as 'crash', never a silent pass
{
  const rec = await runTask(brokenVerify, { adapter: noopAgent, stateDir: STATE })
  check('verifier crash: status crash', rec.verifier.status === 'crash', `got ${rec.verifier.status}`)
  check('verifier crash: never a pass', rec.pass === false)
}

// 5. regression: command adapter must substitute {{prompt}} when present
{
  const helper = join(STATE, 'prompt-argv.mjs')
  writeFileSync(helper, [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync('got.txt', process.argv[2] ?? 'NONE')",
    '',
  ].join('\n'))
  const agent = commandAdapter({ template: `node "${helper}" {{prompt}}` })
  // A failing run keeps the workspace, so the marker file survives for the check.
  const pingFail = makeTask('edge-ping', 'console.log(JSON.stringify({ pass: false }))\nprocess.exit(1)')
  pingFail.prompt = 'PINGMARKER' // single token: this test guards substitution, not quoting
  const rec = await runTask(pingFail, { adapter: agent, stateDir: STATE, keepFailures: true })
  let got = 'MISSING'
  try { got = readFileSync(join(rec.keptWorkspace, 'got.txt'), 'utf8').trim() } catch { /* ignore */ }
  check('command adapter: {{prompt}} substituted', got === 'PINGMARKER', `got "${got}"`)
}

// 6. regression: the verifier must not inherit secret-bearing env vars.
// The secret must be in process.env (finish() builds the verifier env from it);
// injecting it only via the env option would make this test vacuous.
{
  const secretProbe = makeTask('edge-env-scrub', 'console.log(JSON.stringify({ pass: process.env.BENCHKIT_TEST_SECRET === undefined }))\nprocess.exit(process.env.BENCHKIT_TEST_SECRET === undefined ? 0 : 1)')
  process.env.BENCHKIT_TEST_SECRET = 'topsecret'
  let rec
  try {
    rec = await runTask(secretProbe, { adapter: noopAgent, stateDir: STATE })
  } finally {
    delete process.env.BENCHKIT_TEST_SECRET
  }
  check('verifier env: secrets scrubbed', rec.pass === true, JSON.stringify(rec.verifier))
}

// 7. regression: hostile task ids are rejected at discovery time
{
  const evilDir = join(STATE, 'tasks-evil', '..evil')
  mkdirSync(evilDir, { recursive: true })
  writeFileSync(join(evilDir, 'meta.json'), '{ "id": "../evil", "split": "dev" }')
  writeFileSync(join(evilDir, 'prompt.txt'), 'x')
  writeFileSync(join(evilDir, 'verify.mjs'), 'console.log(JSON.stringify({pass:true}))\n')
  let threw = false
  try {
    discoverTasks(join(STATE, 'tasks-evil'))
  } catch {
    threw = true
  }
  check('task discovery: hostile id rejected', threw)
}

rmSync(STATE, { recursive: true, force: true })
console.log(failures === 0 ? 'edge tests: ALL GREEN' : `edge tests: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
