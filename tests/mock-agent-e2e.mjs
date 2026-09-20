#!/usr/bin/env node
/**
 * End-to-end smoke test without any real model: a mock agent (a node script)
 * completes one task correctly through the command adapter, and the runner must
 * record a PASS. Asserts results.jsonl grows and the report renders.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KIT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = mkdtempSync(join(tmpdir(), 'benchkit-e2e-'))
const tasksDir = join(ROOT, 'tasks')
const stateDir = join(ROOT, 'state')
mkdirSync(join(tasksDir, 'smoke-hello'), { recursive: true })
writeFileSync(join(tasksDir, 'smoke-hello', 'meta.json'), '{ "id": "smoke-hello", "split": "dev", "tags": ["smoke"] }')
writeFileSync(join(tasksDir, 'smoke-hello', 'prompt.txt'), 'create hello.txt containing exactly Hello, DSH!\n')
writeFileSync(join(tasksDir, 'smoke-hello', 'verify.mjs'), [
  "import { readFileSync } from 'node:fs'",
  'let s = ""',
  'try { s = readFileSync("hello.txt", "utf8").replace(/\\r?\\n$/, "") } catch {}',
  'const pass = s === "Hello, DSH!"',
  'console.log(JSON.stringify({ pass }))',
  'process.exit(pass ? 0 : 1)',
  '',
].join('\n'))

const mock = join(ROOT, 'mock-agent.mjs')
writeFileSync(mock, 'import { writeFileSync } from "node:fs"\nwriteFileSync("hello.txt", "Hello, DSH!\\n")\n')

const cli = join(KIT, 'bin', 'benchkit.mjs')
const cmd = `node "${mock}"`
const r = spawnSync(process.execPath, [cli, 'run', '--adapter', 'command', '--cmd', cmd, '--tasks-dir', tasksDir, '--state-dir', stateDir, '--tag', 'e2e'], { encoding: 'utf8' })
const out = r.stdout ?? ''
const resultsFile = join(stateDir, 'results.jsonl')
const rows = existsSync(resultsFile) ? readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const ok = r.status === 0 && out.includes('smoke-hello ... PASS') && rows.length === 1 && rows[0].pass === true
console.log(ok ? 'e2e: PASS (mock agent recorded green)' : `e2e: FAIL\n${out}\n${r.stderr ?? ''}`)
rmSync(ROOT, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
