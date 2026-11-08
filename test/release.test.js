import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assetCandidates, assetUrl, downloadMcpServer } from '../lib/release.js'

test('names the current and legacy MathWorks assets per platform', () => {
  assert.deepEqual(assetCandidates('win32', 'x64'), [
    'matlab-mcp-server-windows-x64.exe',
    'matlab-mcp-core-server-win64.exe',
  ])
  assert.deepEqual(assetCandidates('darwin', 'arm64'), [
    'matlab-mcp-server-macos-arm64',
    'matlab-mcp-core-server-maca64',
  ])
  assert.equal(assetCandidates('darwin', 'x64')[0], 'matlab-mcp-server-macos-x64')
  assert.equal(assetCandidates('linux', 'x64')[0], 'matlab-mcp-server-linux-x64')
})

test('publishes no binary where MathWorks publishes none', () => {
  assert.deepEqual(assetCandidates('linux', 'arm64'), [])
})

test('builds latest and pinned download URLs', () => {
  assert.equal(
    assetUrl('matlab-mcp-server-windows-x64.exe'),
    'https://github.com/matlab/matlab-mcp-server/releases/latest/download/matlab-mcp-server-windows-x64.exe',
  )
  assert.equal(
    assetUrl('a', 'v0.16.0'),
    'https://github.com/matlab/matlab-mcp-server/releases/download/v0.16.0/a',
  )
})

test('falls back to the legacy asset when the current spelling is 404', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const requested = []
  const fetchImpl = async url => {
    requested.push(url)
    if (url.includes('matlab-mcp-server-windows')) return new Response('not found', { status: 404 })
    // A realistic binary is far larger than the guard; this stub repeats to reach it.
    return new Response(Buffer.alloc(1_200_000, 7), { status: 200 })
  }
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'win32',
    arch: 'x64',
    fetchImpl,
    log: () => {},
  })
  assert.equal(installed.asset, 'matlab-mcp-core-server-win64.exe')
  assert.equal(installed.path, join(dir, 'matlab-mcp-server.exe'))
  assert.equal(installed.bytes, 1_200_000)
  assert.equal(requested.length, 2)
})

test('refuses a truncated body instead of installing it as the server', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fetchImpl = async () => new Response('<html>rate limited</html>', { status: 200 })
  await assert.rejects(
    () => downloadMcpServer({ directory: dir, platform: 'win32', arch: 'x64', fetchImpl, log: () => {} }),
    /could not download the MATLAB MCP Server binary/u,
  )
})

test('reports every attempted asset when all of them fail', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  await assert.rejects(
    () => downloadMcpServer({ directory: dir, platform: 'linux', arch: 'x64', fetchImpl, log: () => {} }),
    /matlab-mcp-server-linux-x64: connect ECONNREFUSED; matlab-mcp-core-server-glnxa64: connect ECONNREFUSED/u,
  )
})
