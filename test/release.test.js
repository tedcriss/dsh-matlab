import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sha256Hex } from '../lib/integrity.js'
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

/** Whether a request names the GitHub release API rather than a download. */
function isReleaseApi(url) {
  return String(url).includes('api.github.com/repos/matlab/matlab-mcp-server/releases')
}

/** A release API answer listing this platform's assets, with the real digests. */
function releaseBody(platform, payload, { tag = 'v0.16.0', digest, size } = {}) {
  return {
    tag_name: tag,
    assets: assetCandidates(platform, 'x64').map(name => ({
      name,
      size: size ?? payload.byteLength,
      digest: digest ?? `sha256:${sha256Hex(payload)}`,
    })),
  }
}

/** One JSON answer from the release API. */
function apiAnswer(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** A temp directory that is removed when the test ends. */
async function tempDirectory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-download-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
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

test('pins the tag and verifies the published sha256', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('win32')
  const requested = []
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async url => {
      requested.push(String(url))
      if (isReleaseApi(url)) return apiAnswer(releaseBody('win32', payload))
      return new Response(payload, { status: 200 })
    },
    log: () => {},
  })
  assert.equal(installed.asset, 'matlab-mcp-server-windows-x64.exe')
  assert.equal(installed.tag, 'v0.16.0')
  assert.equal(installed.verified, true)
  assert.equal(installed.digest, sha256Hex(payload))
  // The digest describes one release, so the download is pinned to the tag the
  // metadata came from instead of following `latest` a second time.
  assert.match(requested[1], /releases\/download\/v0\.16\.0\/matlab-mcp-server-windows-x64\.exe/u)
  assert.deepEqual(await readFile(installed.path), payload)
})

test('refuses a payload whose sha256 does not match the release', async t => {
  const dir = await tempDirectory(t)
  const published = executableBytes('win32')
  const served = executableBytes('win32')
  served[512] = 0x42
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async url => {
        if (isReleaseApi(url)) return apiAnswer(releaseBody('win32', published))
        return new Response(served, { status: 200 })
      },
      log: () => {},
    }),
    /checksum mismatch: the release publishes sha256 [0-9a-f]{64}, the download hashed to [0-9a-f]{64}/u,
  )
  await assert.rejects(() => stat(join(dir, 'matlab-mcp-server.exe')), /ENOENT/u)
  await assert.rejects(() => stat(join(dir, 'matlab-mcp-server.exe.download')), /ENOENT/u)
})

test('refuses a transfer shorter than the release states', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('linux')
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'linux',
      arch: 'x64',
      fetchImpl: async url => {
        if (isReleaseApi(url)) {
          return apiAnswer(releaseBody('linux', payload, { size: payload.byteLength + 4096 }))
        }
        return new Response(payload, { status: 200 })
      },
      log: () => {},
    }),
    /incomplete download: the release lists 1204096 bytes, the transfer carried 1200000/u,
  )
})

test('refuses a body shorter than its declared content-length', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('win32')
  await assert.rejects(
    () => downloadMcpServer({
      directory: dir,
      platform: 'win32',
      arch: 'x64',
      // No metadata: the transfer's own declared length is the only check.
      fetchImpl: async url => {
        if (isReleaseApi(url)) return new Response('not found', { status: 404 })
        return new Response(payload.subarray(0, 1_100_000), {
          status: 200,
          headers: { 'content-length': String(payload.byteLength) },
        })
      },
      log: () => {},
    }),
    /incomplete download: 1200000 bytes were declared, 1100000 arrived/u,
  )
})

test('falls back to a mirror-reported digest when the direct API is blocked', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('win32')
  const logs = []
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'win32',
    arch: 'x64',
    routes: ['https://gh-proxy.com', 'https://ghfast.top', null],
    fetchImpl: async url => {
      const text = String(url)
      if (isReleaseApi(text)) {
        // The direct API is unreachable, but the prefix can relay it.
        if (!text.startsWith('https://gh-proxy.com/')) throw new Error('connect ECONNREFUSED')
        return apiAnswer(releaseBody('win32', payload))
      }
      if (text.startsWith('https://gh-proxy.com/')) return new Response('bad gateway', { status: 502 })
      return new Response(payload, { status: 200 })
    },
    log: entry => logs.push(entry.message),
  })
  assert.equal(installed.verified, true)
  assert.equal(installed.route, 'https://ghfast.top')
  assert.ok(logs.some(message => /came through gh-proxy\.com, not api\.github\.com/u.test(message)))
})

test('installs unverified only when no release metadata can be read', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('linux')
  const logs = []
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async url => {
      if (isReleaseApi(url)) throw new Error('connect ECONNREFUSED')
      return new Response(payload, { status: 200 })
    },
    log: entry => logs.push(entry.message),
  })
  assert.equal(installed.verified, false)
  assert.ok(logs.some(message => /will not be verified/u.test(message)))
})

test('falls back to the legacy asset when the current spelling is 404', async t => {
  const dir = await tempDirectory(t)
  const requested = []
  const fetchImpl = async url => {
    requested.push(String(url))
    if (isReleaseApi(url)) return new Response('not found', { status: 404 })
    if (String(url).includes('matlab-mcp-server-windows')) return new Response('not found', { status: 404 })
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
  assert.equal(installed.verified, false)
  // One metadata attempt, then the two asset spellings.
  assert.equal(requested.length, 3)
})

test('streams the body to disk byte for byte', async t => {
  const dir = await tempDirectory(t)
  const payload = executableBytes('linux')
  const installed = await downloadMcpServer({
    directory: dir,
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async url => {
      if (isReleaseApi(url)) return apiAnswer(releaseBody('linux', payload))
      return new Response(payload, { status: 200 })
    },
    log: () => {},
  })
  assert.deepEqual(await readFile(installed.path), payload)
})

test('walks the acceleration routes in order and reports the one that served', async t => {
  const dir = await tempDirectory(t)
  const hosts = []
  const fetchImpl = async url => {
    const text = String(url)
    // Metadata cannot be read here, so the legacy latest/download walk runs.
    if (isReleaseApi(text)) throw new Error('no metadata')
    hosts.push(new URL(text).host)
    if (text.startsWith('https://gh-proxy.com/')) return new Response('bad gateway', { status: 502 })
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
  const dir = await tempDirectory(t)
  const fetchImpl = async () => new Response('<html>rate limited</html>', { status: 200 })
  await assert.rejects(
    () => downloadMcpServer({ directory: dir, platform: 'win32', arch: 'x64', fetchImpl, log: () => {} }),
    /could not download the MATLAB MCP Server binary/u,
  )
})

test('refuses a proxy error page even when it is larger than the size floor', async t => {
  const dir = await tempDirectory(t)
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
  const dir = await tempDirectory(t)
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  await assert.rejects(
    () => downloadMcpServer({ directory: dir, platform: 'linux', arch: 'x64', fetchImpl, log: () => {} }),
    /matlab-mcp-server-linux-x64 via direct: connect ECONNREFUSED; matlab-mcp-core-server-glnxa64 via direct: connect ECONNREFUSED/u,
  )
})

test('gives up when the budget is spent instead of walking every route', async t => {
  const dir = await tempDirectory(t)
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
