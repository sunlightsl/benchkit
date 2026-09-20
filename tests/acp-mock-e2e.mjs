#!/usr/bin/env node
/**
 * End-to-end ACP adapter test with a MOCK ACP server (no real model):
 * the mock speaks just enough ACP v1 (initialize / authenticate / session/new
 * / session/prompt with updates / cancel / close) to complete one benchkit
 * task. Asserts the runner records PASS and the drive result lands in the
 * record (finalText/toolCalls from ACP updates, not NDJSON events).
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const KIT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = mkdtempSync(join(tmpdir(), 'benchkit-acp-e2e-'))

// A trivial task: the mock server will "do" it by writing the file itself.
const taskDir = join(ROOT, 'tasks', 'acp-smoke')
mkdirSync(taskDir, { recursive: true })
writeFileSync(join(taskDir, 'meta.json'), '{ "id": "acp-smoke", "split": "dev", "tags": ["smoke"] }')
writeFileSync(join(taskDir, 'prompt.txt'), 'create hello.txt containing exactly Hello, DSH!\n')
writeFileSync(join(taskDir, 'verify.mjs'), [
  "import { readFileSync } from 'node:fs'",
  'let s = ""',
  'try { s = readFileSync("hello.txt", "utf8").replace(/\\r?\\n$/, "") } catch {}',
  'const pass = s === "Hello, DSH!"',
  'console.log(JSON.stringify({ pass }))',
  'process.exit(pass ? 0 : 1)',
  '',
].join('\n'))

// The mock ACP server: newline-delimited JSON-RPC 2.0 over stdio.
const mock = join(ROOT, 'mock-acp-server.mjs')
writeFileSync(mock, `
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
let sessionSeq = 0
const rl = createInterface({ input: process.stdin })
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n')
rl.on('line', (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  const reply = (result) => send({ jsonrpc: '2.0', id: req.id, result })
  switch (req.method) {
    case 'initialize':
      reply({ protocolVersion: 1, capabilities: {} })
      break
    case 'authenticate':
      reply({})
      break
    case 'session/new': {
      sessionSeq += 1
      reply({ sessionId: 'mock-' + sessionSeq })
      break
    }
    case 'session/prompt': {
      const sessionId = req.params.sessionId
      // The agent "does the task": its cwd is the benchkit workspace.
      writeFileSync('hello.txt', 'Hello, DSH!\\n')
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { type: 'tool_call', toolCallId: 't1', title: 'write', kind: 'edit' } } })
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { type: 'agent_message_chunk', content: { type: 'text', text: 'created hello.txt' } } } })
      reply({ stopReason: 'end_turn' })
      break
    }
    case 'session/cancel':
    case 'session/close':
      reply({})
      break
    default:
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'unknown method ' + req.method } })
  }
})
`)

const stateDir = join(ROOT, 'state')
const cli = join(KIT, 'bin', 'benchkit.mjs')
const r = spawnSync(process.execPath, [cli, 'run', '--adapter', 'acp', '--acp-cmd', `node "${mock}"`, '--tasks-dir', join(ROOT, 'tasks'), '--state-dir', stateDir, '--tag', 'acp-e2e'], { encoding: 'utf8' })
const out = r.stdout ?? ''
const resultsFile = join(stateDir, 'results.jsonl')
const rows = existsSync(resultsFile) ? readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const rec = rows[0]
const ok = r.status === 0
  && out.includes('acp-smoke ... PASS')
  && rows.length === 1
  && rec.pass === true
  && rec.adapter === 'acp'
  && rec.finalText === 'created hello.txt'
  && rec.metrics.toolCalls === 1
console.log(ok ? 'acp e2e: PASS (mock ACP server drove one green run)' : `acp e2e: FAIL\n${out}\n${r.stderr ?? ''}\n${JSON.stringify(rec ?? {})}`)
rmSync(ROOT, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
