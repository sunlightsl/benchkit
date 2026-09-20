#!/usr/bin/env node
/**
 * Runner edge-case regression tests (no real model):
 *  1. an agent that sleeps past the task timeout is reaped and recorded turnEnd=timeout
 *  2. --keep-failures preserves the workspace under stateDir/failed with the README warning
 *  3. --require-success folds a nonzero agent exit into pass=false
 *  4. a verifier that crashes is reported as verifier.status='crash', never a silent pass
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandAdapter } from '../src/adapters.mjs'
import { runTask } from '../src/runner.mjs'

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

rmSync(STATE, { recursive: true, force: true })
console.log(failures === 0 ? 'edge tests: ALL GREEN' : `edge tests: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
