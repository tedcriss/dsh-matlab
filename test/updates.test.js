import test from 'node:test'
import assert from 'node:assert/strict'

import {
  compareVersions,
  formatVersion,
  isNewer,
  latestServerRelease,
  latestToolkitHead,
  localToolkitHead,
  parseVersion,
  versionFromLsRemote,
} from '../lib/updates.js'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

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

test('picks the newest tag out of ls-remote output, ignoring peeled lines', () => {
  const output = [
    `${SHA_A}\trefs/tags/v0.4.0`,
    `${SHA_A}\trefs/tags/v0.9.2`,
    `${SHA_A}\trefs/tags/v0.16.0^{}`,
    `${SHA_B}\trefs/tags/v0.16.0`,
    `${SHA_A}\trefs/tags/not-a-version`,
  ].join('\n')
  assert.deepEqual(versionFromLsRemote(output), { tag: 'v0.16.0', version: 'v0.16.0' })
  assert.equal(versionFromLsRemote(''), undefined)
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
  assert.equal(release.route, 'https://gh-proxy.com')
  assert.equal(requested.length, 1)
  assert.match(requested[0], /gh-proxy\.com\/https:\/\/api\.github\.com\/repos\/matlab\/matlab-mcp-server\/releases\/latest/u)
})

test('falls back to the repository tags when a mirror refuses the API host', async () => {
  const commands = []
  const release = await latestServerRelease({
    routes: ['https://gh-proxy.com'],
    fetchImpl: async () => new Response('forbidden', { status: 403 }),
    run: async (command, args) => {
      commands.push([command, ...args].join(' '))
      return { code: 0, stdout: `${SHA_A}\trefs/tags/v0.17.0\n${SHA_A}\trefs/tags/v0.9.0\n`, stderr: '' }
    },
  })
  assert.equal(release.tag, 'v0.17.0')
  assert.equal(release.version, 'v0.17.0')
  assert.match(commands[0], /git ls-remote --tags https:\/\/gh-proxy\.com\/https:\/\/github\.com\/matlab\/matlab-mcp-server\.git/u)
})

test('reports every route when nothing answers', async () => {
  await assert.rejects(
    () => latestServerRelease({
      routes: ['https://gh-proxy.com', null],
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
      run: async () => {
        throw new Error('git missing')
      },
      log: () => {},
    }),
    /could not read the newest MATLAB MCP Server release: api via gh-proxy\.com: connect ECONNREFUSED/u,
  )
})

test('reads the toolkit HEAD over the accelerated route', async () => {
  const head = await latestToolkitHead({
    repo: 'https://github.com/matlab/matlab-agentic-toolkit.git',
    routes: ['https://gh-proxy.com'],
    run: async () => ({ code: 0, stdout: `${SHA_B}\tHEAD\n`, stderr: '' }),
  })
  assert.deepEqual(head, { sha: SHA_B, route: 'https://gh-proxy.com' })
})

test('reads the local toolkit commit, or nothing when the folder is not a checkout', async () => {
  assert.equal(
    await localToolkitHead({
      root: 'C:\\data\\toolkit',
      run: async (command, args) => {
        assert.deepEqual(args, ['-C', 'C:\\data\\toolkit', 'rev-parse', 'HEAD'])
        return { code: 0, stdout: `${SHA_A}\n`, stderr: '' }
      },
    }),
    SHA_A,
  )
  assert.equal(
    await localToolkitHead({ root: 'C:\\missing', run: async () => ({ code: 128, stdout: '', stderr: 'not a git repository' }) }),
    undefined,
  )
})
