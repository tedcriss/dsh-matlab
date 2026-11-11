/**
 * One-shot MCP handshake against the MATLAB MCP Server.
 *
 * `dsh-mcp-client` probes a stdio server before serving it, and this probe
 * serves the same purpose for diagnosis: it answers "can this binary start,
 * and which tools does it publish" before the bridge owns the process. It runs
 * `initialize`, `tools/list`, and `resources/list`, none of which start MATLAB,
 * so a probe costs a process start rather than a MATLAB start.
 *
 * @module dsh-plugin-matlab/probe
 */

import { spawn } from 'node:child_process'
import { PACKAGE_NAME, VERSION } from './version.js'

/** Protocol revision this probe advertises; the server answers with the revision it will use. */
const PROBE_PROTOCOL_VERSION = '2025-06-18'

/** Client identity reported in `initialize`. */
export const CLIENT_INFO = { name: PACKAGE_NAME, version: VERSION }

/** Bytes of server stderr kept for a failure diagnostic. */
const MAX_STDERR_BYTES = 4096

/**
 * Extract a short tool list from a `tools/list` result.
 * @param result - JSON-RPC result object.
 * @returns name and description per tool.
 */
function readTools(result) {
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools.map(tool => ({
    name: typeof tool?.name === 'string' ? tool.name : '',
    description: typeof tool?.description === 'string' ? tool.description : '',
  })).filter(tool => tool.name.length > 0)
}

/**
 * Extract a short resource list from a `resources/list` result.
 * @param result - JSON-RPC result object.
 * @returns uri and name per resource.
 */
function readResources(result) {
  const resources = Array.isArray(result?.resources) ? result.resources : []
  return resources.map(resource => ({
    uri: typeof resource?.uri === 'string' ? resource.uri : '',
    name: typeof resource?.name === 'string' ? resource.name : '',
  })).filter(resource => resource.uri.length > 0)
}

/**
 * Probe the MATLAB MCP Server over stdio.
 * @param options - process, transport, and budget settings.
 * @param options.command - server executable.
 * @param options.args - server argument vector.
 * @param options.env - extra environment variables.
 * @param options.cwd - working directory for the child.
 * @param options.timeoutMs - whole-probe budget.
 * @param options.spawnImpl - spawn implementation; defaults to `node:child_process`.
 * @returns the probe outcome; a failed probe reports `ok: false` and a cause instead of throwing.
 */
export async function probeMcpServer(options) {
  const spawnImpl = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? 20_000
  return await new Promise(resolve => {
    let child
    try {
      child = spawnImpl(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      })
    } catch (cause) {
      resolve({ ok: false, error: `could not start ${options.command}: ${String(cause)}` })
      return
    }
    const pending = new Map()
    let stdoutBuffer = ''
    let stderr = ''
    let settled = false
    let nextId = 1

    const finish = outcome => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        // The child already exited; there is nothing left to stop.
      }
      resolve({ ...outcome, stderr: stderr.trim() })
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: `probe timed out after ${String(timeoutMs)} ms` })
    }, timeoutMs)

    const send = message => {
      child.stdin?.write(`${JSON.stringify(message)}\n`)
    }

    const request = (method, params) => {
      const id = nextId
      nextId += 1
      return new Promise(requestResolve => {
        pending.set(id, requestResolve)
        send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      })
    }

    const handleMessage = message => {
      if (message === null || typeof message !== 'object') return
      if (typeof message.id === 'number' && pending.has(message.id)) {
        const requestResolve = pending.get(message.id)
        pending.delete(message.id)
        requestResolve(message)
        return
      }
      // A server-initiated request that this probe does not implement gets a method-not-found answer.
      if (typeof message.method === 'string' && message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not supported by probe' } })
      }
    }

    child.stdout?.on('data', chunk => {
      stdoutBuffer += chunk.toString('utf8')
      let newline = stdoutBuffer.indexOf('\n')
      while (newline !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        newline = stdoutBuffer.indexOf('\n')
        if (line.length === 0) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          // Non-JSON output on stdout is a log line the server should have sent to stderr.
          continue
        }
        handleMessage(message)
      }
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8')
    })
    child.on('error', error => {
      finish({ ok: false, error: `could not start ${options.command}: ${error.message}` })
    })
    child.on('close', code => {
      if (!settled) finish({ ok: false, error: `server exited during the probe with code ${String(code)}` })
    })

    const run = async () => {
      const init = await request('initialize', {
        protocolVersion: PROBE_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      })
      if (init.error !== undefined) {
        finish({ ok: false, error: `initialize rejected: ${init.error.message ?? JSON.stringify(init.error)}` })
        return
      }
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      const toolsResponse = await request('tools/list', {})
      const resourcesResponse = await request('resources/list', {})
      const result = init.result ?? {}
      finish({
        ok: true,
        protocolVersion: typeof result.protocolVersion === 'string' ? result.protocolVersion : undefined,
        serverInfo: result.serverInfo ?? undefined,
        instructions: typeof result.instructions === 'string' ? result.instructions : undefined,
        tools: toolsResponse.error === undefined ? readTools(toolsResponse.result) : [],
        resources: resourcesResponse.error === undefined ? readResources(resourcesResponse.result) : [],
        toolListError: toolsResponse.error === undefined
          ? undefined
          : (toolsResponse.error.message ?? JSON.stringify(toolsResponse.error)),
      })
    }
    run().catch(error => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  })
}
