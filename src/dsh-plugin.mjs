/**
 * benchkit as a dsh plugin: mounts one `benchkit` tool so an agent can
 * self-evaluate — run the task suite against the host harness and read the
 * pass-rate report back.
 *
 * Host-contract notes:
 * - `@deepseek-ai/dsh-tools` is NOT a declared dependency on purpose: inside a
 *   dsh profile it resolves through the installation's symlink farm to the
 *   host's single copy (declaring it as a dep is what duplicates the package
 *   and breaks tool calls — see the dsh-plugins-finder incident).
 * - Class form with `static inject`: cordis gates service access by declared
 *   dependencies; a bare function touching `ctx.tools` fails with
 *   "cannot get property without inject".
 * - The child benchmark run spawns asynchronously so a long dev-set run never
 *   blocks the host event loop.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUN_TIMEOUT_MS = 20 * 60 * 1000

/** Host repo root from the launch entry (<repo>/apps/cli/{src,lib}/bin.*). */
function hostRepoRoot() {
  try {
    const entry = process.argv[1] ? resolve(process.argv[1]) : ''
    const repo = resolve(dirname(entry), '..', '..', '..')
    if (existsSync(join(repo, 'apps', 'cli'))) return repo
  } catch { /* fall through */ }
  return undefined
}

/**
 * Load the host's dsh-tools WITHOUT a declared dependency (declaring it
 * duplicates the package and breaks tool calls — the dsh-plugins-finder
 * incident). Resolution is by filesystem path from the host checkout, because
 * pnpm workspaces neither hoist this package to the repo root nor survive
 * `require()` of its ESM/TLA build. The installation's symlink farm remains
 * the implicit fallback for installed (non-workspace) layouts.
 */
async function loadDshTools() {
  const repo = hostRepoRoot()
  const bases = []
  if (repo) {
    bases.push(join(repo, 'node_modules', '@deepseek-ai', 'dsh-tools'))
    bases.push(join(repo, 'packages', 'core', 'tools'))
  }
  for (const base of bases) {
    try {
      const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
      const entry = typeof pkg.exports === 'string' ? pkg.exports : (pkg.exports?.['.']?.default ?? pkg.main)
      if (!entry) continue
      const mod = await import(pathToFileURL(join(base, entry)).href)
      if (mod?.defineTool) return mod
    } catch { /* try the next layout */ }
  }
  // Last resort: bare specifier (works where the installation provides it).
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod?.defineTool) return mod
  } catch { /* fall through to the error */ }
  throw new Error('benchkit plugin: cannot locate the host @deepseek-ai/dsh-tools')
}

/**
 * Locate the host's deepseek-harness checkout. Inside a dsh host the launch
 * entry is <repo>/apps/cli/src/bin.ts (source) or <repo>/apps/cli/lib/bin.js
 * (built) — three levels up from either is the repo root.
 * @param explicit - caller-provided path (tool argument or env) wins.
 */
function resolveDshRepo(explicit) {
  if (explicit) return explicit
  if (process.env.BENCHKIT_DSH_REPO) return process.env.BENCHKIT_DSH_REPO
  try {
    const entry = process.argv[1] ? resolve(process.argv[1]) : ''
    const repo = resolve(dirname(entry), '..', '..', '..')
    if (existsSync(join(repo, 'apps', 'cli', 'lib', 'bin.js'))) return repo
  } catch { /* fall through to the error */ }
  throw new Error('cannot locate the dsh installation: pass dsh_repo or set BENCHKIT_DSH_REPO')
}

function runBenchkitCli({ repo, set, task, repeat, tag }) {
  const args = [
    join(KIT_ROOT, 'bin', 'benchkit.mjs'), 'run',
    '--adapter', 'dsh', '--dsh-repo', repo,
    '--state-dir', join(KIT_ROOT, 'state'),
    '--tag', tag ?? 'agent-run',
  ]
  if (set) args.push('--set', set)
  if (task) args.push('--task', task)
  if (repeat) args.push('--repeat', String(repeat))
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectRun(new Error('benchkit run timed out after 20 minutes'))
    }, RUN_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000) })
    child.on('error', (error) => { clearTimeout(timer); rejectRun(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        rejectRun(new Error(`benchkit exited ${String(code)}: ${stderr.slice(-400)}`))
        return
      }
      const start = stdout.indexOf('# benchkit report')
      const report = (start >= 0 ? stdout.slice(start) : stdout).trim().slice(-8000)
      const m = /results: (\d+)\/(\d+) passed/.exec(stdout)
      resolveRun({ report, passed: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0 })
    })
  })
}

/** The benchkit tool definition, built once dsh-tools is loaded. */
function buildTool() {
  return {
    name: 'benchkit',
    description: 'Run the benchkit evaluation task suite against this harness and return the pass-rate report. Use to regression-test configuration changes (prompts, skills, presets): run a baseline, change something, run again, compare pass rates.',
    parameters: {
      set: { type: 'string', description: 'task split to run: dev (default), heldout, or all. heldout is reserved for milestone comparisons.' },
      task: { type: 'string', description: 'comma-separated task ids to run (default: the whole set)' },
      repeat: { type: 'number', description: 'repetitions per task for noise control (default 1; 3 for baselines)' },
      tag: { type: 'string', description: 'label recorded on every result row (default agent-run)' },
      dsh_repo: { type: 'string', description: 'deepseek-harness checkout to evaluate (default: auto-detected host installation)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          report: { type: 'string', required: true },
          passed: { type: 'number', required: true },
          total: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `benchkit: ${String(value.passed)}/${String(value.total)} tasks passed\n\n${String(value.report).slice(-4000)}`,
      }],
    },
    async execute(args) {
      const repo = resolveDshRepo(args.dsh_repo)
      const result = await runBenchkitCli({
        repo,
        set: args.set,
        task: args.task,
        repeat: args.repeat,
        tag: args.tag,
      })
      return result
    },
  }
}

/** Cordis plugin: register the benchkit self-evaluation tool on the host. The
 * dsh-tools load is async (ESM/TLA), so registration is deferred through an
 * effect and rolled back cleanly if the plugin unloads first. */
class BenchkitPlugin {
  static inject = ['tools']

  constructor(ctx) {
    ctx.effect(() => {
      let cancelled = false
      let disposeTool = () => {}
      void loadDshTools().then(({ defineTool }) => {
        if (cancelled) return
        disposeTool = ctx.tools.register(defineTool(buildTool()))
      }).catch((error) => {
        ctx.emit('benchkit/plugin-error', error)
      })
      return () => {
        cancelled = true
        disposeTool()
      }
    })
  }
}

export { BenchkitPlugin as apply, BenchkitPlugin as default }
