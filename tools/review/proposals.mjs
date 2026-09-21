#!/usr/bin/env node
/**
 * Review → proposal pipeline: turn review-panel findings into a triage ledger
 * so AI-proposed changes flow through the same discipline as everything else.
 *
 *   node tools/review/proposals.mjs ingest          # findings.json → proposals.jsonl
 *   node tools/review/proposals.mjs list            # print the ledger
 *   node tools/review/proposals.mjs close <id> --status applied|rejected [--note "..."]
 *
 * The ledger is append-only state/proposals.jsonl next to results.jsonl.
 * Ingest dedups by (file, issue-prefix); close never deletes — status moves.
 * Canary discipline stays human/agent-driven for now: implementing a proposal
 * means changing code and re-running the test suites; `close` records the
 * verdict with an optional evidence pointer.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const KIT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_STATE = join(KIT_ROOT, 'state')

const argv = process.argv.slice(2)
const sub = argv[0] ?? 'list'
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return dflt
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) {
    console.error(`proposals: --${name} requires a value`)
    process.exit(2)
  }
  return v
}
const stateDir = resolve(arg('state-dir', DEFAULT_STATE))
const ledgerFile = join(stateDir, 'proposals.jsonl')

const readLedger = () => existsSync(ledgerFile)
  ? readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  : []

const append = (row) => {
  const first = !existsSync(ledgerFile)
  writeFileSync(ledgerFile, JSON.stringify(row) + '\n', { flag: 'a' })
  if (first) {
    writeFileSync(join(stateDir, 'README.md'), [
      '# benchkit state',
      '',
      '`proposals.jsonl` records AI-proposed changes from review rounds with their',
      'triage verdicts. `results.jsonl` rows may contain agent output excerpts.',
      'Do NOT commit, publish, or upload this directory anywhere.',
      '',
    ].join('\n'))
  }
}

const signature = (f) => `${f.file}|${f.issue.toLowerCase().replace(/\s+/g, ' ').slice(0, 60)}`

if (sub === 'ingest') {
  const reviewsDir = resolve(arg('reviews-dir', join(stateDir, 'reviews')))
  if (!existsSync(reviewsDir)) {
    console.error(`proposals: no reviews dir at ${reviewsDir}`)
    process.exit(2)
  }
  const existing = new Set(readLedger().map((p) => p.signature))
  const out = []
  for (const dir of readdirSync(reviewsDir).sort()) {
    const file = join(reviewsDir, dir, 'findings.json')
    if (!existsSync(file)) continue
    const review = JSON.parse(readFileSync(file, 'utf8'))
    for (const f of review.findings ?? []) {
      if (!['high', 'med'].includes(f.severity)) continue // low findings stay in the review archive
      const sig = signature(f)
      if (existing.has(sig)) continue
      existing.add(sig)
      const row = {
        proposalId: randomUUID().slice(0, 8),
        ts: new Date().toISOString(),
        status: 'proposed',
        severity: f.severity,
        agreement: f.agreement ?? 1,
        file: f.file,
        title: `${f.slug}: ${f.file}`,
        issue: f.issue,
        suggestion: f.suggestion,
        evidence: file,
        signature: sig,
      }
      append(row)
      out.push(row)
    }
  }
  console.log(`ingest: ${out.length} new proposal(s) → ${ledgerFile}`)
  for (const p of out) console.log(`  [${p.severity}] ${p.proposalId} ${p.title}`)
} else if (sub === 'list') {
  const rows = readLedger()
  if (rows.length === 0) {
    console.log('proposals: ledger empty (run `proposals.mjs ingest` after a review round)')
    process.exit(0)
  }
  const rank = { proposed: 0, applied: 1, rejected: 2 }
  rows.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.ts.localeCompare(a.ts))
  console.log(`# proposals (${rows.length})`)
  for (const p of rows) {
    console.log(`${p.status.toUpperCase().padEnd(8)} [${p.severity}] ${p.proposalId} ${p.title}${p.agreement > 1 ? ` (${p.agreement} personas)` : ''}`)
    if (p.status !== 'proposed' && p.note) console.log(`         ↳ ${p.note}`)
  }
} else if (sub === 'close') {
  const id = argv[1]
  const status = arg('status')
  if (!id || !['applied', 'rejected'].includes(status)) {
    console.error('proposals: close <id> --status applied|rejected [--note "..."]')
    process.exit(2)
  }
  const rows = readLedger()
  const target = rows.find((p) => p.proposalId === id)
  if (!target) {
    console.error(`proposals: no proposal ${id}`)
    process.exit(2)
  }
  if (target.status !== 'proposed') {
    console.error(`proposals: ${id} already ${target.status}`)
    process.exit(2)
  }
  target.status = status
  target.closedAt = new Date().toISOString()
  target.note = arg('note', '')
  append(target) // append-only: the ledger carries the status transition
  console.log(`closed ${id} → ${status}${target.note ? ` (${target.note})` : ''}`)
} else {
  console.error('proposals: unknown subcommand (ingest | list | close)')
  process.exit(2)
}
