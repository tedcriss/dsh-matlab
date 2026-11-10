import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHINA_GITHUB_ROUTES,
  MARKET_STATE_DIR,
  MARKET_STATE_FILE,
  normalizeGithubProxy,
  readMarketState,
  resolveGithubAcceleration,
  resolveProfileDirectory,
  routeLabel,
  routesFor,
  throughProxy,
} from '../lib/github.js'

/** Write a market state file the way DSH's market does. */
async function marketState(profileDirectory, state) {
  await mkdir(join(profileDirectory, MARKET_STATE_DIR), { recursive: true })
  const file = join(profileDirectory, MARKET_STATE_DIR, MARKET_STATE_FILE)
  await writeFile(file, JSON.stringify(state))
  return file
}

async function makeProfile(t, state) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-profile-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await marketState(dir, state)
  return dir
}

test('normalizes an HTTPS prefix and refuses anything a prefix cannot carry', () => {
  assert.equal(normalizeGithubProxy('https://gh-proxy.com'), 'https://gh-proxy.com')
  assert.equal(normalizeGithubProxy(' https://gh-proxy.com/// '), 'https://gh-proxy.com')
  assert.equal(normalizeGithubProxy('https://mirror.example/github/'), 'https://mirror.example/github')
  // Only a bare origin plus path is meaningful: everything else could smuggle a
  // different destination or downgrade the transport under the binary.
  for (const rejected of [undefined, null, 42, '', '   ', 'gh-proxy.com', 'http://gh-proxy.com',
    'https://user:pw@gh-proxy.com', 'https://gh-proxy.com/?url=x', 'https://gh-proxy.com/#x',
    'https:\\gh-proxy.com', 'ftp://gh-proxy.com']) {
    assert.equal(normalizeGithubProxy(rejected), null, `accepted ${String(rejected)}`)
  }
})

test('joins a prefix the way a GitHub prefix expects', () => {
  const url = 'https://github.com/matlab/matlab-mcp-server/releases/download/v0.16.0/a.exe'
  assert.equal(throughProxy(null, url), url)
  assert.equal(throughProxy('https://gh-proxy.com', url), `https://gh-proxy.com/${url}`)
  assert.equal(routeLabel(null), 'direct')
  assert.equal(routeLabel('https://gh-proxy.com'), 'gh-proxy.com')
})

test('builds a chain that always ends in the direct route', () => {
  assert.deepEqual(routesFor({ region: 'china', proxy: null }), [...CHINA_GITHUB_ROUTES, null])
  assert.deepEqual(routesFor({ region: 'global', proxy: null }), [null])
  assert.deepEqual(
    routesFor({ region: 'china', proxy: 'https://mirror.example/github' }),
    ['https://mirror.example/github', ...CHINA_GITHUB_ROUTES, null],
  )
  // A prefix the table already carries heads the chain without repeating itself.
  assert.deepEqual(routesFor({ region: 'china', proxy: 'https://gh-proxy.com' }), [...CHINA_GITHUB_ROUTES, null])
  assert.deepEqual(routesFor({ region: 'global', proxy: 'https://mirror.example' }), ['https://mirror.example', null])
})

test('reads the region and prefix DSH persisted for a profile', async t => {
  const dir = await makeProfile(t, { region: 'china', githubProxy: 'https://mirror.example/github/', disabled: [] })
  assert.deepEqual(await readMarketState(dir), {
    region: 'china',
    githubProxy: 'https://mirror.example/github',
  })
})

test('treats an absent, unreadable, or hand-edited market state as no fact', async t => {
  const empty = await mkdtemp(join(tmpdir(), 'matlab-profile-'))
  t.after(() => rm(empty, { recursive: true, force: true }))
  assert.equal(await readMarketState(empty), undefined)

  const broken = await makeProfile(t, {})
  await writeFile(join(broken, MARKET_STATE_DIR, MARKET_STATE_FILE), '{not json')
  assert.equal(await readMarketState(broken), undefined)

  // Nothing usable recorded: the next fact source decides.
  const unrelated = await makeProfile(t, { disabled: [], groups: {} })
  assert.equal(await readMarketState(unrelated), undefined)

  const invalid = await makeProfile(t, { region: 'mars', githubProxy: 'http://mirror.example' })
  assert.equal(await readMarketState(invalid), undefined)
})

test('takes the launcher profile directory before anything derived from a name', async t => {
  const home = await mkdtemp(join(tmpdir(), 'matlab-home-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const launched = await makeProfile(t, { region: 'china' })

  assert.equal(
    await resolveProfileDirectory({ profileDirectory: launched, dshHome: home, env: {} }),
    launched,
  )
  assert.equal(
    await resolveProfileDirectory({ profileDirectory: '', dshHome: home, env: { DSH_PROFILE_DIR: launched } }),
    launched,
  )
  assert.equal(
    await resolveProfileDirectory({ dshHome: home, env: { DSH_PROFILE: 'desktop' } }),
    join(home, 'profiles', 'desktop'),
  )
})

test('falls back to the newest market state when nothing names the profile', async t => {
  const home = await mkdtemp(join(tmpdir(), 'matlab-home-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const older = join(home, 'profiles', 'old')
  const newer = join(home, 'profiles', 'desktop')
  const oldFile = await marketState(older, { region: 'global' })
  const newFile = await marketState(newer, { region: 'china' })
  await utimes(oldFile, new Date(1_000_000), new Date(1_000_000))
  await utimes(newFile, new Date(2_000_000), new Date(2_000_000))
  // A profile with no market state cannot answer, and must not win by existing.
  await mkdir(join(home, 'profiles', 'fresh'), { recursive: true })

  assert.equal(await resolveProfileDirectory({ dshHome: home, env: {} }), newer)
  assert.equal(await resolveProfileDirectory({ dshHome: join(home, 'missing'), env: {} }), undefined)
})

test('prefers the plugin setting over the environment and the market', async t => {
  const profile = await makeProfile(t, { region: 'china', githubProxy: 'https://from-market.example' })
  const acceleration = await resolveGithubAcceleration({
    githubProxy: 'https://from-config.example',
    downloadRegion: 'auto',
    profileDirectory: profile,
    env: { DSHM_GITHUB_PROXY: 'https://from-env.example' },
  })
  assert.equal(acceleration.proxy, 'https://from-config.example')
  assert.equal(acceleration.source, 'config')
  assert.deepEqual(acceleration.routes, [
    'https://from-config.example',
    ...CHINA_GITHUB_ROUTES,
    null,
  ])
})

test('follows DSHM_GITHUB_PROXY, then the market, when the plugin says nothing', async t => {
  const profile = await makeProfile(t, { region: 'china', githubProxy: 'https://from-market.example' })

  const fromEnv = await resolveGithubAcceleration({
    downloadRegion: 'auto', profileDirectory: profile, env: { DSHM_GITHUB_PROXY: 'https://from-env.example/' },
  })
  assert.equal(fromEnv.proxy, 'https://from-env.example')
  assert.equal(fromEnv.source, 'environment')

  const fromMarket = await resolveGithubAcceleration({ downloadRegion: 'auto', profileDirectory: profile, env: {} })
  assert.equal(fromMarket.proxy, 'https://from-market.example')
  assert.equal(fromMarket.source, 'market')
  assert.equal(fromMarket.region, 'china')
  assert.equal(fromMarket.regionSource, 'market')
})

test('falls back to the built-in China table on a China profile with no prefix', async t => {
  const profile = await makeProfile(t, { region: 'china' })
  const acceleration = await resolveGithubAcceleration({ downloadRegion: 'auto', profileDirectory: profile, env: {} })
  assert.equal(acceleration.proxy, null)
  assert.equal(acceleration.source, 'none')
  assert.deepEqual(acceleration.routes, [...CHINA_GITHUB_ROUTES, null])
})

test('reports an unusable environment prefix and keeps going direct elsewhere', async () => {
  const warnings = []
  const acceleration = await resolveGithubAcceleration({
    downloadRegion: 'auto',
    env: { DSHM_GITHUB_PROXY: 'http://plain-mirror.example' },
    log: entry => warnings.push(entry),
  })
  assert.equal(acceleration.proxy, null)
  assert.equal(acceleration.region, 'global')
  assert.deepEqual(acceleration.routes, [null])
  assert.match(warnings[0].message, /ignoring DSHM_GITHUB_PROXY=http:\/\/plain-mirror\.example/u)
})

test('lets the plugin region override the market region', async t => {
  const profile = await makeProfile(t, { region: 'china' })
  const global = await resolveGithubAcceleration({ downloadRegion: 'global', profileDirectory: profile, env: {} })
  assert.equal(global.region, 'global')
  assert.equal(global.regionSource, 'config')
  assert.deepEqual(global.routes, [null])

  const china = await resolveGithubAcceleration({ downloadRegion: 'china', env: {} })
  assert.equal(china.regionSource, 'config')
  assert.deepEqual(china.routes, [...CHINA_GITHUB_ROUTES, null])
})

test('has no acceleration to follow when nothing is configured', async () => {
  const acceleration = await resolveGithubAcceleration({ downloadRegion: 'auto', env: {} })
  assert.deepEqual(acceleration, {
    region: 'global',
    regionSource: 'default',
    proxy: null,
    source: 'none',
    routes: [null],
  })
})
