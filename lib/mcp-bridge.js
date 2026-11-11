/**
 * stdio bridge between DSH's MCP client and the MATLAB MCP Server.
 *
 * MATLAB names the connecting agent from the MCP `initialize` request —
 * `clientInfo.title` when present, otherwise `clientInfo.name` — and prints it
 * in the command window ("… is connected to MATLAB via the MATLAB MCP server")
 * and in the desktop title. `@deepseek-ai/dsh-mcp-client` sends a fixed
 * `name: "dsh-mcp-client"` with no title, and exposes no field to change it, so
 * the plugin inserts this bridge in the stdio path: it rewrites exactly one
 * message (the initialize request's clientInfo title) and copies every other
 * byte through.
 *
 * Usage: `node mcp-bridge.js --client-title <title> -- <command> [args…]`
 *
 * Framing is MCP's stdio transport: one JSON-RPC message per line. Only the
 * client-to-server direction is parsed; server output is piped untouched.
 *
 * @module dsh-plugin-matlab/mcp-bridge
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Environment variable that keeps an Electron binary acting as Node. */
export const ELECTRON_RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

/** The one tool whose schema takes a folder for the call: `evaluate_matlab_code`. */
export const WORKSPACE_TOOL = 'evaluate_matlab_code'

/** Its argument name, from MathWorks' tool schema. */
export const WORKSPACE_ARGUMENT = 'project_path'

/**
 * Parse this bridge's own argv.
 * @param argv - `process.argv.slice(2)`.
 * @returns the title to force (when given), the workspace file (when given), and the server command plus its args.
 */
export function parseBridgeArguments(argv) {
  let title
  let workspaceFile
  const rest = [...argv]
  while (rest.length > 0 && rest[0] !== '--') {
    const flag = rest.shift()
    if (flag === '--client-title') {
      const value = rest.shift()
      if (value !== undefined && value !== '--') title = value
      continue
    }
    if (flag === '--workspace-file') {
      const value = rest.shift()
      if (value !== undefined && value !== '--') workspaceFile = value
      continue
    }
    throw new Error(`matlab-agentic: unknown bridge argument ${String(flag)}`)
  }
  if (rest[0] === '--') rest.shift()
  const command = rest.shift()
  return { title, workspaceFile, command, args: rest }
}

/**
 * Rewrite one client-to-server line when it is the MCP initialize request.
 *
 * Every other line is returned unchanged (same string identity), so a protocol
 * message this bridge does not understand can never be altered by it.
 * @param line - one line of the JSON-RPC stream, without its newline.
 * @param title - agent name MATLAB should display.
 * @returns the line to send, with `params.clientInfo.title` set.
 */
export function rewriteInitialize(line, title) {
  if (title === undefined || line.length === 0) return line
  if (!line.includes('"initialize"')) return line
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return line
  }
  if (message === null || typeof message !== 'object' || message.method !== 'initialize') return line
  const params = message.params !== null && typeof message.params === 'object' ? message.params : {}
  const clientInfo = params.clientInfo !== null && typeof params.clientInfo === 'object' ? params.clientInfo : {}
  message.params = { ...params, clientInfo: { ...clientInfo, title } }
  return JSON.stringify(message)
}

/**
 * Read the folder the host recorded for the conversation that is calling.
 *
 * The host writes this file immediately before dispatching a MATLAB tool call
 * (see `lib/activate.js`), because an MCP `tools/call` carries no session
 * identity: the shared bridge has no other way to know which conversation the
 * call belongs to. A missing or malformed file is not an error — the call then
 * goes through exactly as the client sent it.
 * @param path - workspace record written by the host, or `undefined` when the feature is off.
 * @returns the recorded absolute folder, or `undefined`.
 */
export function readWorkspaceFolder(path) {
  if (path === undefined) return undefined
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'))
    const cwd = record?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Give one `evaluate_matlab_code` call the conversation's folder.
 *
 * Only that tool's schema takes `project_path` (MathWorks' contract); the others
 * take explicit file paths. A folder the model already passed wins, and every
 * other message is returned unchanged (same string identity).
 * @param line - one line of the JSON-RPC stream, without its newline.
 * @param workspaceFile - workspace record written by the host, or `undefined`.
 * @returns the line to send, with `params.arguments.project_path` set when applicable.
 */
export function rewriteWorkspace(line, workspaceFile) {
  if (workspaceFile === undefined || line.length === 0) return line
  if (!line.includes('"tools/call"')) return line
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return line
  }
  if (message === null || typeof message !== 'object' || message.method !== 'tools/call') return line
  const params = message.params
  if (params === null || typeof params !== 'object' || params.name !== WORKSPACE_TOOL) return line
  const args = params.arguments !== null && typeof params.arguments === 'object' ? params.arguments : {}
  const provided = args[WORKSPACE_ARGUMENT]
  if (typeof provided === 'string' && provided !== '') return line
  const cwd = readWorkspaceFolder(workspaceFile)
  if (cwd === undefined) return line
  message.params = { ...params, arguments: { ...args, [WORKSPACE_ARGUMENT]: cwd } }
  return JSON.stringify(message)
}

/**
 * Run the bridge until either side closes.
 * @param options - parsed bridge arguments.
 * @param options.title - agent name to force on initialize.
 * @param options.workspaceFile - workspace record to read per call, when enabled.
 * @param options.command - real server executable.
 * @param options.args - real server arguments.
 * @param options.env - environment for the server child.
 * @param options.spawnImpl - spawn seam for tests.
 * @param options.stdin - client-to-bridge stream.
 * @param options.stdout - bridge-to-client stream.
 * @param options.stderr - diagnostics stream.
 * @returns the server child, or throws when it cannot start.
 */
export function runBridge(options) {
  const spawnImpl = options.spawnImpl ?? spawn
  const stdin = options.stdin ?? process.stdin
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  if (options.command === undefined) throw new Error('matlab-agentic: the bridge needs a server command')
  const child = spawnImpl(options.command, options.args ?? [], {
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  })

  child.stdout.on('data', chunk => stdout.write(chunk))
  child.stderr.on('data', chunk => stderr.write(chunk))

  let buffer = ''
  const forward = line => {
    const outgoing = `${rewriteWorkspace(rewriteInitialize(line, options.title), options.workspaceFile)}\n`
    // Respect the child's write buffer: a slow server must not grow memory here.
    if (child.stdin.write(outgoing) === false) {
      stdin.pause()
      child.stdin.once('drain', () => stdin.resume())
    }
  }
  stdin.on('data', chunk => {
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      forward(line)
      newline = buffer.indexOf('\n')
    }
  })
  stdin.on('end', () => {
    // A final line without a newline is still a message the server may act on.
    if (buffer.length > 0) forward(buffer)
    child.stdin.end()
  })

  child.on('error', error => {
    stderr.write(`matlab-agentic: the MCP bridge could not start ${String(options.command)}: ${error.message}\n`)
    process.exitCode = 1
    // Nothing can be served without the server.
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal === null ? 0 : 1))
  })
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      child.kill(signal)
    })
  }
  return child
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  try {
    const parsed = parseBridgeArguments(process.argv.slice(2))
    if (parsed.command === undefined) {
      process.stderr.write('matlab-agentic: usage: mcp-bridge.js --client-title <title> -- <command> [args…]\n')
      process.exit(2)
    }
    runBridge({ ...parsed })
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(2)
  }
}
