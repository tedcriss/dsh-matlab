import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseBridgeArguments, readWorkspaceFolder, rewriteInitialize, rewriteWorkspace } from '../lib/mcp-bridge.js'

test('parses the bridge arguments around the separator', () => {
  assert.deepEqual(
    parseBridgeArguments(['--client-title', 'DeepSeek', '--', 'C:\\bin\\matlab-mcp-server.exe', '--log-level=info']),
    { title: 'DeepSeek', workspaceFile: undefined, command: 'C:\\bin\\matlab-mcp-server.exe', args: ['--log-level=info'] },
  )
  assert.deepEqual(parseBridgeArguments(['--', 'node', 'x.js']), { title: undefined, workspaceFile: undefined, command: 'node', args: ['x.js'] })
  assert.deepEqual(
    parseBridgeArguments(['--client-title', 'DeepSeek', '--workspace-file', 'C:\\tmp\\ws.json', '--', 'node', 'x.js']),
    { title: 'DeepSeek', workspaceFile: 'C:\\tmp\\ws.json', command: 'node', args: ['x.js'] },
  )
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

test('reads the workspace folder the host recorded', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-bridge-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'workspace-folder.json')
  await writeFile(file, JSON.stringify({ cwd: 'C:\\work\\project', at: 1 }))
  assert.equal(readWorkspaceFolder(file), 'C:\\work\\project')
  assert.equal(readWorkspaceFolder(join(dir, 'missing.json')), undefined)
  assert.equal(readWorkspaceFolder(undefined), undefined)
  await writeFile(file, 'not json')
  assert.equal(readWorkspaceFolder(file), undefined)
  await writeFile(file, JSON.stringify({ cwd: '' }))
  assert.equal(readWorkspaceFolder(file), undefined)
})

test('adds the conversation folder to an evaluate call only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-bridge-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'workspace-folder.json')
  await writeFile(file, JSON.stringify({ cwd: 'C:\\work\\project' }))

  const evaluate = JSON.stringify({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'evaluate_matlab_code', arguments: { code: 'disp(1)' } },
  })
  const rewritten = JSON.parse(rewriteWorkspace(evaluate, file))
  assert.deepEqual(rewritten.params.arguments, { code: 'disp(1)', project_path: 'C:\\work\\project' })

  // A folder the model passed wins over the record.
  const explicit = JSON.stringify({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'evaluate_matlab_code', arguments: { code: 'x', project_path: 'C:\\elsewhere' } },
  })
  assert.equal(rewriteWorkspace(explicit, file), explicit)

  // Tools without a project_path argument are never touched.
  const other = JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'run_matlab_file', arguments: { script_path: 'C:\\a.m' } },
  })
  assert.equal(rewriteWorkspace(other, file), other)

  // Without the feature there is no record and nothing changes.
  assert.equal(rewriteWorkspace(evaluate, undefined), evaluate)
  // A missing record leaves the call as the client sent it.
  assert.equal(rewriteWorkspace(evaluate, join(dir, 'missing.json')), evaluate)
  // Non-call traffic and malformed lines are untouched.
  assert.equal(rewriteWorkspace('{"jsonrpc":"2.0","id":8,"method":"tools/list"}', file), '{"jsonrpc":"2.0","id":8,"method":"tools/list"}')
  assert.equal(rewriteWorkspace('not json', file), 'not json')
})
