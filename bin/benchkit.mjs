#!/usr/bin/env node
/**
 * benchkit CLI — regression testing for agent configurations.
 *
 *   node bin/benchkit.mjs run --adapter dsh --dsh-repo <abs path> [options]
 *   node bin/benchkit.mjs run --adapter command --cmd 'my-agent --cwd "{{workspace}}"' [options]
 *
 * Options:
 *   --tasks-dir <path>   task library (default: <kit>/tasks)
 *   --state-dir <path>   results + reports (default: <cwd>/state)
 *   --task a,b,c         run only these task ids
 *   --set dev|heldout|all (default dev)
 *   --repeat N           repetitions per task (default 1)
 *   --overlay <dir>      copied into every run workspace (agent config under test)
 *   --home <path>        DSH_HOME for the dsh adapter
 *   --tag <tag>          recorded on every result row
 *   --keep-failures      preserve failed workspaces under <state-dir>/failed
 *   --require-success    fold the agent's exit code into pass (dsh: turn must complete)
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dshAdapter, commandAdapter } from '../src/adapters.mjs'
import { abs, appendRecord, digestOverlay, discoverTasks, runTask, writeReport } from '../src/runner.mjs'

const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const command = argv[0] ?? 'run'
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}
const flag = (name) => argv.includes(`--${name}`)

function dieUsage(msg) {
  console.error(`benchkit: ${msg}`)
  process.exit(2)
}

if (command !== 'run') dieUsage(`unknown command ${command} (only "run")`)

const SET = arg('set', 'dev')
if (!['dev', 'heldout', 'all'].includes(SET)) dieUsage(`--set must be dev|heldout|all, got "${SET}"`)
const REPEAT_RAW = arg('repeat', '1')
const REPEAT = Number(REPEAT_RAW)
if (!Number.isInteger(REPEAT) || REPEAT < 1) dieUsage(`--repeat must be a positive integer, got "${REPEAT_RAW}"`)
const TASKS_DIR = abs(process.cwd(), arg('tasks-dir', join(KIT_ROOT, 'tasks')))
const STATE_DIR = abs(process.cwd(), arg('state-dir', 'state'))
const TASK_FILTER = arg('task', undefined)
const OVERLAY = arg('overlay', undefined)
const HOME = arg('home', undefined)
const TAG = arg('tag', 'adhoc')
const KEEP_FAILURES = flag('keep-failures')
const REQUIRE_SUCCESS = flag('require-success')

let adapter
if (arg('adapter', 'dsh') === 'dsh') {
  try {
    adapter = dshAdapter({ repo: arg('dsh-repo', process.env.DSH_REPO), home: HOME })
  } catch (error) {
    dieUsage(error.message)
  }
} else if (arg('adapter') === 'command') {
  try {
    adapter = commandAdapter({ template: arg('cmd', process.env.BENCHKIT_CMD) })
  } catch (error) {
    dieUsage(error.message)
  }
} else {
  dieUsage(`--adapter must be dsh|command, got "${arg('adapter')}"`)
}

const OVERLAY_DIGEST = digestOverlay(OVERLAY)

let tasks
try {
  tasks = discoverTasks(TASKS_DIR, { set: SET, taskFilter: TASK_FILTER })
} catch (error) {
  dieUsage(`cannot read tasks dir ${TASKS_DIR}: ${error.message}`)
}
if (tasks.length === 0) dieUsage(`no tasks matched (set=${SET}${TASK_FILTER ? ` task=${TASK_FILTER}` : ''})`)

console.log(`benchkit: ${tasks.length} task(s) × ${REPEAT} repeat(s) | adapter=${adapter.name} | set=${SET} | overlay=${OVERLAY_DIGEST || 'none'}`)

const records = []
for (let r = 1; r <= REPEAT; r++) {
  for (const task of tasks) {
    process.stdout.write(`  [${r}/${REPEAT}] ${task.id} ... `)
    const record = await runTask(task, { adapter, overlay: OVERLAY, overlayDigest: OVERLAY_DIGEST, stateDir: STATE_DIR, keepFailures: KEEP_FAILURES, requireSuccess: REQUIRE_SUCCESS })
    record.tag = TAG
    records.push(record)
    appendRecord(STATE_DIR, record)
    console.log(record.pass ? 'PASS' : `FAIL (${record.turnEnd})`)
  }
}

if (records.length === 0) dieUsage('no records produced')

const { markdown, reportFile } = writeReport(STATE_DIR, { records, adapter: adapter.name, overlayDigest: OVERLAY_DIGEST, set: SET, repeat: REPEAT })
console.log('')
console.log(markdown)
console.log(`benchkit: report written to ${reportFile}`)
