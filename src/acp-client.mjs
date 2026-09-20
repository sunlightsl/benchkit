/**
 * Minimal ACP v1 (Agent Client Protocol) client over a child's stdio:
 * newline-delimited JSON-RPC 2.0. Implements exactly the surface benchkit
 * needs: initialize, authenticate, session/new, one session/prompt turn with
 * update draining, then cancel + close. Protocol reference:
 * https://agentclientprotocol.com
 */

export class AcpClient {
  /** @param child - a ChildProcess with stdio ['pipe','pipe','pipe']. */
  constructor(child) {
    this.child = child
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.updateHandlers = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => this.#onData(d))
  }

  #onData(d) {
    this.buf += d
    let nl
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { /* keepalive garbage */ continue }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error) p.reject(new Error(msg.error.message ?? 'ACP request failed'))
        else p.resolve(msg.result)
      } else if (msg.method === 'session/update') {
        for (const h of this.updateHandlers) h(msg.params)
      }
    }
  }

  /** Send one JSON-RPC request; rejects on timeout or error response. */
  request(method, params, timeoutMs = 120_000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`ACP timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  /**
   * Run one full turn: initialize, authenticate, create a session in
   * `workspace`, send the prompt, drain updates until the prompt settles.
   * @returns {Promise<{ text: string, toolCalls: number }>}
   */
  async turn(promptText, workspace, promptTimeoutMs = 600_000) {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    })
    try { await this.request('authenticate', {}, 10_000) } catch { /* optional in ACP v1 */ }
    const { sessionId } = await this.request('session/new', { cwd: workspace, mcpServers: [] })
    let text = ''
    const toolCallIds = new Set()
    const onUpdate = (params) => {
      const u = params?.update ?? {}
      if (u.type === 'agent_message_chunk') {
        const c = u.content
        text += typeof c === 'string' ? c : (c?.text ?? '')
      } else if (u.type === 'tool_call' || u.type === 'tool_call_update') {
        // ACP servers may report lifecycle per call ('tool_call_update' with a
        // status); distinct ids count once.
        toolCallIds.add(u.toolCallId ?? u.toolCall?.id ?? `anon-${toolCallIds.size}`)
      }
    }
    this.updateHandlers.push(onUpdate)
    try {
      await this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: promptText }] }, promptTimeoutMs)
    } finally {
      this.updateHandlers = this.updateHandlers.filter((h) => h !== onUpdate)
      try { await this.request('session/cancel', { sessionId }, 5_000) } catch { /* best effort */ }
      try { await this.request('session/close', { sessionId }, 10_000) } catch { /* best effort */ }
    }
    return { text: text.trim(), toolCalls: toolCallIds.size }
  }
}
