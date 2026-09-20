/**
 * Agent adapters: how benchkit hands one task run to an agent.
 *
 * An adapter is `{ name, expectsEvents?, spawn({ prompt, workspace, env }) -> ChildProcess }`.
 * The child runs with cwd = the task workspace. benchkit parses NDJSON event lines
 * from stdout when the agent emits them (`expectsEvents: true` asserts that at
 * least one event parses and surfaces a warning otherwise) and always treats the
 * workspace + verifier as ground truth.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/** Non-Windows children get their own process group so timeout can reap the tree. */
const SPAWN_BASE = {
  windowsHide: true,
  get detached() { return process.platform !== 'win32' },
}

/**
 * DeepSeek Harness adapter: runs the task through `dsh --profile headless --json`.
 * Uses the built CLI so plugin resolution matches an installed consumer; the
 * source-launch mode duplicates @deepseek-ai/dsh-tools and breaks tool calls
 * (deepseek-harness discussion #4529). Rebuild the repo after pulling.
 * @param options.repo - Absolute path to a deepseek-harness checkout.
 * @param options.home - Optional DSH_HOME for the runs.
 */
export function dshAdapter({ repo, home } = {}) {
  if (!repo) throw new Error('dsh adapter requires --dsh-repo <abs path>')
  const bin = join(repo, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) {
    throw new Error(`dsh built CLI not found: ${bin} — run "pnpm run build" in the repo first`)
  }
  return {
    name: 'dsh',
    expectsEvents: true,
    spawn({ prompt, workspace, env }) {
      return spawn(process.execPath, [bin, '--profile', 'headless', prompt, '--json'], {
        cwd: workspace,
        env: home === undefined ? env : { ...env, DSH_HOME: home },
        stdio: ['ignore', 'pipe', 'pipe'],
        ...SPAWN_BASE,
      })
    },
  }
}

/**
 * ACP adapter: drives any ACP v1 server (https://agentclientprotocol.com) over
 * stdio. Unlike the streaming adapters, ACP is conversational: after spawn the
 * adapter drives initialize → session/new → prompt → close through
 * `adapter.drive`, and the runner settles from the drive result.
 * @param options.command - Launch command for the ACP server, e.g.
 *   'node "<repo>/apps/cli/lib/bin.js" --profile acp'.
 * @param options.promptTimeoutMs - Per-turn timeout (default 10 min).
 */
export function acpAdapter({ command, home, promptTimeoutMs = 600000 } = {}) {
  if (!command) throw new Error('acp adapter requires --acp-cmd "<launch command>"')
  return {
    name: 'acp',
    spawn({ workspace, env }) {
      return spawn(command, [], {
        cwd: workspace,
        env: home === undefined ? env : { ...env, DSH_HOME: home },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        ...SPAWN_BASE,
      })
    },
    async drive({ child, prompt, workspace }) {
      const { AcpClient } = await import('./acp-client.mjs')
      const client = new AcpClient(child)
      return client.turn(prompt, workspace, promptTimeoutMs)
    },
  }
}

/**
 * Generic command adapter: any agent invocable as a shell command template.
 * Placeholders: {{prompt}} (task text), {{workspace}} (workspace path).
 * The child runs with cwd = workspace.
 *
 * Security: with {{prompt}} the task text is interpolated into a shell command.
 * Task text is semi-trusted (fixtures can contain injection samples), so prefer
 * the stdin mode. If the template contains NO {{prompt}}, the prompt is piped to
 * the child's stdin instead — that mode is immune to shell interpolation.
 * @param options.template - e.g. 'my-agent --cwd "{{workspace}}"' (prompt via stdin)
 */
export function commandAdapter({ template } = {}) {
  if (!template) throw new Error('command adapter requires --cmd "<template>"')
  const viaStdin = !template.includes('{{prompt}}')
  return {
    name: 'command',
    spawn({ prompt, workspace, env }) {
      let cmd = template.split('{{workspace}}').join(workspace)
      if (!viaStdin) cmd = cmd.split('{{prompt}}').join(prompt)
      const child = spawn(cmd, [], {
        cwd: workspace,
        env,
        stdio: viaStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        shell: true,
        ...SPAWN_BASE,
      })
      if (viaStdin) {
        // A fast-exiting agent (or a >64 KiB prompt) can EPIPE the pipe; an
        // unhandled 'error' here would crash the whole run.
        child.stdin.on('error', () => { /* the child's exit path owns the verdict */ })
        child.stdin.write(prompt)
        child.stdin.end()
      }
      return child
    },
  }
}
