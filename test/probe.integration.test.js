import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { probeMcpServer } from '../lib/probe.js'

/**
 * The probe is the only part of the plugin that talks the MCP wire protocol, so
 * it is tested against a real server when one is available. Set
 * `MATLAB_MCP_SERVER` to a `matlab-mcp-server` binary to run it, or install the
 * toolkit where MathWorks puts it and the test finds the binary there.
 */
async function serverBinary() {
  if (process.env.MATLAB_MCP_SERVER) return process.env.MATLAB_MCP_SERVER
  const name = process.platform === 'win32' ? 'matlab-mcp-server.exe' : 'matlab-mcp-server'
  const candidate = join(homedir(), '.matlab', 'agentic-toolkits', 'bin', name)
  try {
    await access(candidate)
    return candidate
  } catch {
    return undefined
  }
}

const binary = await serverBinary()

test('probes a real MATLAB MCP Server and reads its tools', { skip: binary === undefined ? 'no matlab-mcp-server binary' : false }, async () => {
  const result = await probeMcpServer({
    command: binary,
    args: ['--matlab-session-mode=auto', '--matlab-display-mode=nodesktop'],
    timeoutMs: 30_000,
  })
  assert.equal(result.ok, true, result.error)
  assert.match(String(result.serverInfo?.name ?? ''), /matlab/u)
  const names = result.tools.map(tool => tool.name)
  // The five tools MathWorks documents for every release of this server.
  for (const expected of ['evaluate_matlab_code', 'run_matlab_file', 'check_matlab_code', 'detect_matlab_toolboxes']) {
    assert.ok(names.includes(expected), `missing ${expected} in ${names.join(', ')}`)
  }
  // Both resources MathWorks documents.
  const uris = result.resources.map(resource => resource.uri)
  assert.ok(uris.includes('guidelines://coding'))
})

test('reports a missing executable instead of throwing', async () => {
  const result = await probeMcpServer({
    command: join(homedir(), 'definitely-not-a-server'),
    args: [],
    timeoutMs: 5_000,
  })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /could not start/u)
})
