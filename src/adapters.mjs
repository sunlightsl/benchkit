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
        windowsHide: true,
      })
    },
  }
}

/**
 * Generic command adapter: any agent invocable as a shell command template.
 * Placeholders: {{prompt}} (task text), {{workspace}} (workspace path).
 * The child runs with cwd = workspace.
 *
 * Security: with {{prompt}} the task text is interpolated into a shell command.
 * Task text is semi-trusted (fixtures can contain injection samples), so review
 * your template. If the template contains NO {{prompt}}, the prompt is piped to
 * the child's stdin instead — that mode is immune to shell interpolation.
 * @param options.template - e.g. 'my-agent --cwd "{{workspace}}"' (prompt via stdin)
 */
export function commandAdapter({ template } = {}) {
  if (!template) throw new Error('command adapter requires --cmd "<template>"')
  const viaStdin = !template.includes('{{prompt}}')
  return {
    name: 'command',
    spawn({ prompt, workspace, env }) {
      const cmd = template.split('{{workspace}}').join(workspace)
      const child = spawn(cmd, [], {
        cwd: workspace,
        env,
        stdio: viaStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      })
      if (viaStdin) {
        child.stdin.write(prompt)
        child.stdin.end()
      }
      return child
    },
  }
}
