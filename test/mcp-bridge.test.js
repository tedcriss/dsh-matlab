import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { parseBridgeArguments, rewriteInitialize } from '../lib/mcp-bridge.js'

test('parses the bridge arguments around the separator', () => {
  assert.deepEqual(
    parseBridgeArguments(['--client-title', 'DeepSeek', '--', 'C:\\bin\\matlab-mcp-server.exe', '--log-level=info']),
    { title: 'DeepSeek', command: 'C:\\bin\\matlab-mcp-server.exe', args: ['--log-level=info'] },
  )
  assert.deepEqual(parseBridgeArguments(['--', 'node', 'x.js']), { title: undefined, command: 'node', args: ['x.js'] })
  assert.throws(() => parseBridgeArguments(['--wat', 'x']), /unknown bridge argument/u)
})

test('rewrites only the initialize request, and only its title', () => {
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dsh-mcp-client', version: '0.0.1' },
    },
  })
  const rewritten = JSON.parse(rewriteInitialize(initialize, 'DeepSeek'))
  assert.deepEqual(rewritten.params.clientInfo, { name: 'dsh-mcp-client', version: '0.0.1', title: 'DeepSeek' })
  assert.equal(rewritten.params.protocolVersion, '2025-06-18')
  assert.equal(rewritten.method, 'initialize')

  // Every other message is returned untouched, character for character.
  const other = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"evaluate_matlab_code"}}'
  assert.equal(rewriteInitialize(other, 'DeepSeek'), other)
  assert.equal(rewriteInitialize('{"jsonrpc":"2.0","method":"notifications/initialized"}', 'DeepSeek'), '{"jsonrpc":"2.0","method":"notifications/initialized"}')
  // Malformed input must never be mangled: the server answers with a parse error instead.
  assert.equal(rewriteInitialize('not json', 'DeepSeek'), 'not json')
  assert.equal(rewriteInitialize(initialize, undefined), initialize)
  // A server-initiated request whose params merely mention initialize is not the handshake.
  const notification = '{"jsonrpc":"2.0","method":"notifications/initialize-like"}'
  assert.equal(rewriteInitialize(notification, 'DeepSeek'), notification)
})

test('passes a real stdio session through, rewriting the handshake in place', async () => {
  const echo = 'process.stdin.on("data", chunk => process.stdout.write(chunk))'
  const bridge = fileURLToPath(new URL('../lib/mcp-bridge.js', import.meta.url))
  const child = spawn(process.execPath, [
    bridge,
    '--client-title', 'DeepSeek',
    '--', process.execPath, '-e', echo,
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

  let stdout = ''
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })

  const initialize = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"dsh-mcp-client","version":"0.0.1"},"protocolVersion":"2025-06-18"}}'
  const tools = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  child.stdin.write(`${initialize}\n${tools}\n`)

  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && stdout.split('\n').filter(Boolean).length < 2) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  child.kill()

  const lines = stdout.split('\n').filter(line => line.length > 0)
  assert.equal(lines.length >= 2, true, `expected two lines, got ${JSON.stringify(stdout)} (stderr ${stderr})`)
  const first = JSON.parse(lines[0])
  assert.equal(first.params.clientInfo.title, 'DeepSeek')
  assert.equal(first.params.clientInfo.name, 'dsh-mcp-client')
  // The second message crosses the bridge unchanged.
  assert.equal(lines[1], tools)
})
