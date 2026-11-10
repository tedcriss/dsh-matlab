import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { activate, STATUS_PATH } from '../lib/activate.js'
import { resolveOptions } from '../lib/options.js'

const MANIFEST = `display-name: "Example Agentic Toolkit"
skill-groups:
  - name: core
    display-name: "Core"
    path: skills-catalog/core
    required: true
  - name: extra
    display-name: "Extra"
    path: skills-catalog/extra
`

/** Every field the schema supplies, so the test only varies what it means to vary. */
function baseConfig(overrides = {}) {
  return {
    serverName: 'matlab',
    toolCallTimeoutMs: 600_000,
    failOnStartupError: false,
    matlabRoot: '',
    displayMode: 'desktop',
    sessionMode: 'auto',
    initialWorkingFolder: '',
    initializeMatlabOnStartup: false,
    disableTelemetry: false,
    mcpServerPath: '',
    autoProvision: false,
    githubProxy: '',
    downloadRegion: 'auto',
    provisionTimeoutMs: 300_000,
    provisionWaitMs: 0,
    installRoot: '',
    toolkitRoots: [],
    skillGroups: [],
    extensionFiles: [],
    watchSkills: true,
    probe: true,
    probeTimeoutMs: 20_000,
    statusRoute: true,
    ...overrides,
  }
}

/** A context recording what the binding mounts, plus the services it asks for. */
function fakeContext(services = { skills: {}, webServer: { register: () => () => {} } }) {
  const mounts = []
  const routes = []
  const logs = []
  const disposers = []
  return {
    mounts,
    routes,
    logs,
    ctx: {
      logger: {
        info: message => logs.push(['info', message]),
        warn: message => logs.push(['warn', message]),
        error: message => logs.push(['error', message]),
        debug: () => {},
      },
      get: name => services[name],
      plugin: (module, config) => {
        mounts.push({ module, config })
        return Promise.resolve()
      },
      effect: (factory, label) => {
        const dispose = factory()
        disposers.push({ dispose, label })
        const server = services.webServer
        if (server !== undefined && typeof server.register === 'function') {
          // The route factory already called register; capture the arguments it received.
          routes.push(...(server.registered ?? []))
        }
        return dispose
      },
    },
    disposers,
  }
}

/** A web server stub recording registered routes. */
function recordingWebServer() {
  const registered = []
  return {
    registered,
    register: route => {
      registered.push(route)
      return () => {}
    },
  }
}

/** Six-byte placeholder standing in for the downloaded server binary. */
async function makeBinary(directory) {
  const path = join(directory, process.platform === 'win32' ? 'matlab-mcp-server.exe' : 'matlab-mcp-server')
  await writeFile(path, 'stub')
  return path
}

/** Keep the real MathWorks install root out of every activation under test. */
function isolated(directory) {
  return { installRoot: join(directory, 'install-root') }
}

async function makeToolkit(directory, groups = ['core', 'extra']) {
  const root = join(directory, 'matlab-agentic-toolkit')
  await mkdir(join(root, 'skills-catalog'), { recursive: true })
  for (const group of groups) {
    const skillDir = join(root, 'skills-catalog', group, `${group}-skill`)
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${group}-skill\ndescription: d\n---\n`)
  }
  await writeFile(join(root, 'manifest.yaml'), MANIFEST)
  return root
}

/** Resolve test seams that never touch MATLAB, the network, or the runtime packages. */
function seams(binary) {
  return {
    discoverMatlabRoot: async () => ({ root: '/fake/MATLAB/R2025b', source: 'config', exists: true }),
    ensureMcpServer: async () => ({ path: binary, source: 'config', downloaded: false }),
    serverVersion: async () => 'v9.9.9',
    probeMcpServer: async () => ({
      ok: true,
      protocolVersion: '2025-06-18',
      tools: [{ name: 'evaluate_matlab_code', description: '' }],
      resources: [{ uri: 'guidelines://coding', name: 'coding' }],
    }),
    cloneToolkit: async () => {
      throw new Error('cloneToolkit must not run when a toolkit exists')
    },
    countSkills: async () => 1,
    loadSkillProvider: async () => ({ apply: () => {}, name: 'fake-skill-filesystem' }),
    loadMcpClient: async () => ({ apply: () => {}, name: 'fake-mcp-client' }),
  }
}

test('mounts the skill provider and the MCP bridge against MathWorks artifacts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts } = fakeContext()

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), seams(binary))

  assert.equal(status.phase, 'ready')
  assert.equal(mounts.length, 2)

  const skills = mounts[0].config
  assert.equal(skills.providerName, 'matlab')
  assert.equal(skills.includeDefaultRoots, false)
  // The default selection is every group, so both fixture groups mount.
  assert.deepEqual(skills.customSkillDirs, [
    join(toolkit, 'skills-catalog', 'core'),
    join(toolkit, 'skills-catalog', 'extra'),
  ])
  assert.equal(status.skills.length, 2)
  assert.deepEqual(status.skills.map(group => group.name), ['core', 'extra'])

  const bridge = mounts[1].config
  assert.equal(bridge.transport, 'stdio')
  assert.equal(bridge.serverName, 'matlab')
  assert.equal(bridge.command, binary)
  assert.equal(bridge.toolCallTimeoutMs, 600_000)
  assert.ok(bridge.args.includes('--matlab-session-mode=auto'))
  assert.ok(bridge.args.includes('--matlab-root=/fake/MATLAB/R2025b'))
  assert.ok(bridge.args.includes('--matlab-display-mode=desktop'))
  assert.ok(bridge.args.some(arg => arg.startsWith('--log-folder=')))
  assert.equal(status.probe.ok, true)
})

test('serves the resolved state on the status route', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })

  await activate(ctx, baseConfig({ ...isolated(dir), toolkitRoots: [toolkit], mcpServerPath: binary }), seams(binary))
  assert.equal(webServer.registered.length, 1)
  assert.equal(webServer.registered[0].kind, 'exact')
  assert.equal(webServer.registered[0].path, STATUS_PATH)
  const response = await webServer.registered[0].resource()
  const body = await response.json()
  assert.equal(body.phase, 'ready')
  assert.equal(body.server.version, 'v9.9.9')
})

test('an unknown skill group fails activation and names what is available', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()

  await assert.rejects(
    () => activate(ctx, baseConfig({ ...isolated(dir), toolkitRoots: [toolkit], mcpServerPath: binary, skillGroups: ['nope'] }), seams(binary)),
    /unknown skill group\(s\) nope\. Available: core, extra/u,
  )
})

test('a shared session drops the target flags MATLAB refuses to combine', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts } = fakeContext()

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    sessionMode: 'existing',
    matlabRoot: '/fake/MATLAB/R2025b',
    displayMode: 'nodesktop',
  }), seams(binary))

  const args = mounts[1].config.args
  assert.ok(args.includes('--matlab-session-mode=existing'))
  assert.ok(!args.some(arg => arg.startsWith('--matlab-root=')))
  assert.ok(!args.some(arg => arg.startsWith('--matlab-display-mode=')))
  assert.equal(status.warnings.length, 2)
})

test('a failed connection is reported instead of aborting the profile', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, logs } = fakeContext()

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), {
    ...seams(binary),
    loadMcpClient: async () => {
      throw new Error('bridge unavailable')
    },
  })

  assert.equal(status.phase, 'failed')
  assert.match(status.error, /bridge unavailable/u)
  assert.ok(logs.some(([level, message]) => level === 'error' && message.includes('bridge unavailable')))
})

test('failOnStartupError turns the same failure into a load error', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()

  await assert.rejects(
    () => activate(ctx, baseConfig({ ...isolated(dir),
      toolkitRoots: [toolkit],
      mcpServerPath: binary,
      failOnStartupError: true,
    }), {
      ...seams(binary),
      loadMcpClient: async () => {
        throw new Error('bridge unavailable')
      },
    }),
    /bridge unavailable/u,
  )
})

test('every configured group is loaded when the user names them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts } = fakeContext()

  await activate(ctx, baseConfig({ ...isolated(dir),
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    skillGroups: ['core', 'extra'],
  }), seams(binary))
  assert.deepEqual(mounts[0].config.customSkillDirs, [
    join(toolkit, 'skills-catalog', 'core'),
    join(toolkit, 'skills-catalog', 'extra'),
  ])
})

test('rejects a duplicated group name before mounting anything', () => {
  assert.throws(
    () => resolveOptions(baseConfig({ skillGroups: ['core', 'core'] })),
    /lists core more than once/u,
  )
})

/** Keep the developer's own DSH acceleration settings out of the assertion. */
function isolatedGithubEnv(t) {
  for (const name of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSHM_GITHUB_PROXY']) {
    const previous = process.env[name]
    delete process.env[name]
    t.after(() => {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    })
  }
}

test('provisions over the configured GitHub acceleration and reports the route', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()
  let requested

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    toolkitRoots: [toolkit],
    autoProvision: true,
    githubProxy: 'https://gh-proxy.com',
    provisionWaitMs: 2_000,
  }), {
    ...seams(binary),
    ensureMcpServer: async options => {
      requested = options
      return { path: binary, source: 'download', downloaded: true, route: 'https://gh-proxy.com' }
    },
  })

  // The download and the clone share one chain, direct route last: a mirror that
  // dies must degrade to slow, never to a profile that cannot start.
  assert.deepEqual(requested.routes, ['https://gh-proxy.com', null])
  assert.equal(requested.provisionTimeoutMs, 300_000)
  assert.deepEqual(status.github, {
    region: 'global',
    regionSource: 'default',
    proxy: 'https://gh-proxy.com',
    proxySource: 'config',
    routes: ['gh-proxy.com', 'direct'],
  })
  assert.equal(status.server.downloaded, true)
  assert.equal(status.server.route, 'gh-proxy.com')
})

test('a missing toolkit is cloned over the same acceleration routes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()
  let cloned

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    autoProvision: true,
    mcpServerPath: binary,
    githubProxy: 'https://gh-proxy.com/',
    provisionTimeoutMs: 120_000,
    provisionWaitMs: 2_000,
  }), {
    ...seams(binary),
    cloneToolkit: async options => {
      cloned = options
      return { root: toolkit, route: 'https://gh-proxy.com' }
    },
  })

  assert.ok(cloned, 'cloneToolkit must run when no toolkit exists')
  assert.deepEqual(cloned.routes, ['https://gh-proxy.com', null])
  assert.equal(cloned.timeoutMs, 120_000)
  assert.equal(status.skills.length, 2)
  assert.deepEqual(status.github.routes, ['gh-proxy.com', 'direct'])
})

test('a first-time fetch never holds activation, because DSH abandons a slow start', async t => {  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const { ctx } = fakeContext()
  // A fetch that never finishes stands in for a mirror that is merely slow: the
  // 60-second host-startup limit must be somebody else's problem, not the boot's.
  const never = new Promise(() => {})

  const started = Date.now()
  const status = await activate(ctx, baseConfig({ ...isolated(dir), autoProvision: true }), {
    ...seams(binary),
    cloneToolkit: () => never,
  })

  assert.ok(Date.now() - started < 5_000, `activation took ${String(Date.now() - started)} ms`)
  assert.equal(status.phase, 'provisioning')
  assert.equal(status.skills.length, 0)
  assert.equal(status.server, undefined)
})

test('toolkit extension files reach the first connection even when the toolkit is fetched in the background', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir, ['core'])
  await writeFile(join(toolkit, 'manifest.yaml'), `display-name: "Example Agentic Toolkit"
skill-groups:
  - name: core
    display-name: "Core"
    path: skills-catalog/core
    required: true
mcp-server-extensions:
  - path: tools/tools.json
`)
  const { ctx, mounts } = fakeContext()

  const status = await activate(ctx, baseConfig({ ...isolated(dir),
    autoProvision: true,
    mcpServerPath: binary,
    provisionWaitMs: 2_000,
  }), {
    ...seams(binary),
    cloneToolkit: async () => ({ root: toolkit, route: null }),
  })

  // Binding tools before the clone would drop the toolkit's extensions from the
  // one and only connection; the background task must clone first.
  assert.equal(status.phase, 'ready')
  assert.ok(mounts[1].config.args.includes(`--extension-file=${join(toolkit, 'tools', 'tools.json')}`))
})
