import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assetCandidates, assetUrl, downloadMcpServer, looksLikeExecutable } from '../lib/release.js'

/**
 * A payload that clears the size floor and this platform's executable check.
 *
 * The bytes after the header are filler: only the header distinguishes a binary
 * from the large HTML page a dead proxy mirror returns with HTTP 200.
 */
function executableBytes(platform, size = 1_200_000) {
  const bytes = Buffer.alloc(size, 7)
  if (platform === 'win32') {
    bytes[0] = 0x4d
    bytes[1] = 0x5a
  } else if (platform === 'linux') {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes)
  } else {
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]).copy(bytes)
  }
  return bytes
}

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

test('recognizes a runnable payload and refuses a text answer', () => {
  assert.equal(looksLikeExecutable('win32', executableBytes('win32')), true)
  assert.equal(looksLikeExecutable('linux', executableBytes('linux')), true)
  assert.equal(looksLikeExecutable('darwin', executableBytes('darwin')), true)
  // A script is runnable on POSIX even though it carries no binary magic.
  assert.equal(looksLikeExecutable('linux', Buffer.from('#!/bin/sh\nexec true\n')), true)
  assert.equal(looksLikeExecutable('win32', Buffer.from('<!DOCTYPE html><html>')), false)
  assert.equal(looksLikeExecutable('linux', Buffer.from('<html><body>blocked')), false)
  assert.equal(looksLikeExecutable('linux', Buffer.from('{"error":"rate limited"}')), false)
  assert.equal(looksLikeExecutable('darwin', Buffer.alloc(64, 7)), false)
})

test('falls back to the legacy asset when the current spelling is 404', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const requested = []
  const fetchImpl = async url => {
    requested.push(url)
    if (url.includes('matlab-mcp-server-windows')) return new Response('not found', { status: 404 })
    return new Response(executableBytes('win32'), { status: 200 })
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
  assert.equal(installed.route, null)
  assert.equal(requested.length, 2)
})

test('streams the body to disk byte for byte', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const payload = executableBytes('linux')
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async () => new Response(payload, { status: 200 }),
    log: () => {},
  })
  assert.deepEqual(await readFile(installed.path), payload)
})

test('walks the acceleration routes in order and reports the one that served', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const hosts = []
  const fetchImpl = async url => {
    hosts.push(new URL(url).host)
    if (url.startsWith('https://gh-proxy.com/')) return new Response('bad gateway', { status: 502 })
    return new Response(executableBytes('win32'), { status: 200 })
  }
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'win32',
    arch: 'x64',
    routes: ['https://gh-proxy.com', 'https://ghfast.top', null],
    fetchImpl,
    log: () => {},
  })
  // The prefix receives the whole destination URL, which is what a GitHub
  // prefix expects; only the mirror hosts are contacted, never the origin.
  assert.deepEqual(hosts, ['gh-proxy.com', 'ghfast.top'])
  assert.equal(installed.route, 'https://ghfast.top')
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

test('refuses a proxy error page even when it is larger than the size floor', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const page = Buffer.from(`<!DOCTYPE html><html><body>${'x'.repeat(1_200_000)}</body></html>`)
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async () => new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      log: () => {},
    }),
    /answered with an HTML page instead of a binary/u,
  )
  // The same trap without a lying content-type is caught by the payload itself.
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async () => new Response(page, { status: 200 }),
      log: () => {},
    }),
    /payload is not a runnable program/u,
  )
})

test('reports every attempted asset and route when all of them fail', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  await assert.rejects(
    () => downloadMcpServer({ directory: dir, platform: 'linux', arch: 'x64', fetchImpl, log: () => {} }),
    /matlab-mcp-server-linux-x64 via direct: connect ECONNREFUSED; matlab-mcp-core-server-glnxa64 via direct: connect ECONNREFUSED/u,
  )
})

test('gives up when the budget is spent instead of walking every route', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let contacted = 0
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'linux',
      arch: 'x64',
      routes: ['https://gh-proxy.com', 'https://ghfast.top', null],
      timeoutMs: 0,
      fetchImpl: async () => {
        contacted += 1
        return new Response(executableBytes('linux'), { status: 200 })
      },
      log: () => {},
    }),
    /budget of 0 ms spent with 6 attempt\(s\) untried/u,
  )
  assert.equal(contacted, 0)
})
