import test from 'node:test'
import assert from 'node:assert/strict'

import {
  compareVersions,
  formatVersion,
  isNewer,
  latestRelease,
  latestServerRelease,
  parseVersion,
  releaseAssets,
  releaseTagFromText,
} from '../lib/updates.js'

/** The published digest of the ASCII string `abc`. */
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

/** A release page shaped like GitHub's: the tag lives in `og:url`. */
function releasePage(tag) {
  return `<html><head><meta property="og:url" content="/matlab/matlab-agentic-toolkit/releases/tag/${tag}"><title>Release ${tag} · matlab/matlab-agentic-toolkit · GitHub</title></head></html>`
}

test('reads a version out of tags, release names, and --version output', () => {
  assert.deepEqual(parseVersion('v0.16.0'), [0, 16, 0])
  assert.deepEqual(parseVersion('0.17.2'), [0, 17, 2])
  assert.deepEqual(parseVersion('github.com/matlab/matlab-mcp-server v0.16.0'), [0, 16, 0])
  assert.deepEqual(parseVersion('release v1.2.3-beta.1'), [1, 2, 3])
  assert.equal(parseVersion('no version here'), undefined)
  assert.equal(parseVersion(undefined), undefined)
  assert.equal(formatVersion([1, 2, 3]), 'v1.2.3')
})

test('orders versions numerically, not lexicographically', () => {
  assert.equal(compareVersions([0, 16, 0], [0, 16, 0]), 0)
  assert.equal(compareVersions([0, 17, 0], [0, 16, 9]), 1)
  assert.equal(compareVersions([0, 9, 2], [0, 10, 0]), -1)
  assert.equal(isNewer('v0.17.0', 'v0.16.0'), true)
  assert.equal(isNewer('v0.16.0', 'v0.16.0'), false)
  assert.equal(isNewer('v0.16.0', undefined), true)
  assert.equal(isNewer(undefined, 'v0.16.0'), false)
})

test('reads a tag from a release page, a title, or a redirecting URL', () => {
  assert.equal(releaseTagFromText(releasePage('MATK-2026.11.a')), 'MATK-2026.11.a')
  assert.equal(releaseTagFromText('<title>Release v0.17.0 · matlab/matlab-mcp-server · GitHub</title>'), 'v0.17.0')
  assert.equal(releaseTagFromText('https://github.com/matlab/matlab-mcp-server/releases/tag/v0.17.0'), 'v0.17.0')
  assert.equal(releaseTagFromText('https://gh-proxy.com/https://github.com/matlab/matlab-agentic-toolkit/releases/tag/MATK-2026.11.a'), 'MATK-2026.11.a')
  assert.equal(releaseTagFromText('<html>Invalid input.</html>'), undefined)
  assert.equal(releaseTagFromText(''), undefined)
})

test('asks the GitHub API first and reports the route that answered', async () => {
  const requested = []
  const release = await latestServerRelease({
    routes: ['https://gh-proxy.com', null],
    fetchImpl: async url => {
      requested.push(url)
      return new Response(JSON.stringify({ tag_name: 'v0.17.0' }), { status: 200 })
    },
  })
  assert.equal(release.version, 'v0.17.0')
  assert.equal(release.tag, 'v0.17.0')
  assert.equal(release.route, 'https://gh-proxy.com')
  assert.equal(release.source, 'api')
  assert.equal(requested.length, 1)
  assert.match(requested[0], /gh-proxy\.com\/https:\/\/api\.github\.com\/repos\/matlab\/matlab-mcp-server\/releases\/latest/u)
})

test('falls back to the release page when a route refuses the API host', async () => {
  const requested = []
  const release = await latestServerRelease({
    routes: ['https://gh-proxy.com'],
    fetchImpl: async url => {
      requested.push(url)
      if (String(url).includes('/api.github.com/')) return new Response('rate limited', { status: 403 })
      return new Response('<html><meta property="og:url" content="/matlab/matlab-mcp-server/releases/tag/v0.17.0"></html>', { status: 200 })
    },
  })
  assert.equal(release.tag, 'v0.17.0')
  assert.equal(release.source, 'page')
  assert.equal(requested.length, 2)
  assert.match(requested[1], /gh-proxy\.com\/https:\/\/github\.com\/matlab\/matlab-mcp-server\/releases\/latest/u)
})

test('reports every route when nothing answers', async () => {
  await assert.rejects(
    () => latestServerRelease({
      routes: ['https://gh-proxy.com', null],
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
      log: () => {},
    }),
    /could not read the newest MATLAB MCP Server release: api via gh-proxy\.com: connect ECONNREFUSED; page via gh-proxy\.com: connect ECONNREFUSED; api via direct: connect ECONNREFUSED; page via direct: connect ECONNREFUSED/u,
  )
})

test('reads the newest toolkit release by its monthly tag', async () => {
  const requested = []
  const release = await latestRelease({
    slug: 'matlab/matlab-agentic-toolkit',
    label: 'MATLAB Agentic Toolkit',
    routes: [null],
    fetchImpl: async url => {
      requested.push(String(url))
      return new Response(JSON.stringify({ tag_name: 'MATK-2026.11.a' }), { status: 200 })
    },
  })
  assert.deepEqual(release, { tag: 'MATK-2026.11.a', route: null, source: 'api' })
  assert.match(requested[0], /repos\/matlab\/matlab-agentic-toolkit\/releases\/latest/u)
})

test('fails a route that answers with a page naming no tag', async () => {
  await assert.rejects(
    () => latestRelease({
      slug: 'matlab/matlab-agentic-toolkit',
      label: 'MATLAB Agentic Toolkit',
      routes: [null],
      fetchImpl: async () => new Response('<html>no release here</html>', { status: 200 }),
    }),
    /the release page names no tag/u,
  )
})

test('reads an asset digest from the release API over the direct route first', async () => {
  const requested = []
  const release = await releaseAssets({
    slug: 'matlab/matlab-mcp-server',
    routes: ['https://gh-proxy.com'],
    fetchImpl: async url => {
      requested.push(String(url))
      return new Response(JSON.stringify({
        tag_name: 'v0.16.0',
        assets: [{ name: 'matlab-mcp-server-windows-x64.exe', size: 19_905_376, digest: `sha256:${ABC}` }],
      }), { status: 200 })
    },
  })
  assert.equal(release.tag, 'v0.16.0')
  assert.equal(release.route, null)
  assert.equal(release.assets.get('matlab-mcp-server-windows-x64.exe').digest, ABC)
  assert.equal(release.assets.get('matlab-mcp-server-windows-x64.exe').size, 19_905_376)
  assert.match(requested[0], /^https:\/\/api\.github\.com\/repos\/matlab\/matlab-mcp-server\/releases\/latest$/u)
})

test('falls back to an acceleration route when the direct API is blocked', async () => {
  const requested = []
  const messages = []
  const release = await releaseAssets({
    slug: 'matlab/matlab-mcp-server',
    routes: ['https://gh-proxy.com'],
    fetchImpl: async url => {
      requested.push(String(url))
      if (!String(url).startsWith('https://gh-proxy.com/')) throw new Error('connect ECONNREFUSED')
      return new Response(JSON.stringify({ tag_name: 'v0.16.0', assets: [] }), { status: 200 })
    },
    log: entry => messages.push(entry.message),
  })
  assert.equal(release.route, 'https://gh-proxy.com')
  assert.equal(release.assets.size, 0)
  assert.ok(messages.some(message => /came through gh-proxy\.com/u.test(message)))
})

test('requests a pinned tag when one is supplied', async () => {
  const requested = []
  await releaseAssets({
    slug: 'matlab/matlab-agentic-toolkit',
    tag: 'MATK-2026.11.a',
    fetchImpl: async url => {
      requested.push(String(url))
      return new Response(JSON.stringify({ tag_name: 'MATK-2026.11.a', assets: [] }), { status: 200 })
    },
  })
  assert.match(requested[0], /releases\/tags\/MATK-2026\.11\.a$/u)
})

test('reports every route when no release metadata can be read', async () => {
  await assert.rejects(
    () => releaseAssets({
      slug: 'matlab/matlab-mcp-server',
      routes: ['https://gh-proxy.com'],
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    }),
    /could not read matlab\/matlab-mcp-server release metadata: direct: connect ECONNREFUSED; gh-proxy\.com: connect ECONNREFUSED/u,
  )
})
