import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { activate, STATUS_PATH } from '../lib/activate.js'
import { API_PATHS } from '../lib/api.js'
import { resolveOptions } from '../lib/options.js'
import { VERSION } from '../lib/version.js'

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
  const listeners = []
  return {
    mounts,
    routes,
    logs,
    listeners,
    ctx: {
      logger: {
        info: message => logs.push(['info', message]),
        warn: message => logs.push(['warn', message]),
        error: message => logs.push(['error', message]),
        debug: () => {},
      },
      get: name => services[name],
      on: (name, callback) => {
        listeners.push({ name, callback })
        return () => {}
      },
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

/** Invoke a registered mutation the way the carrier's handler receives it. */
async function postJson(route, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body ?? {}))])
  request.method = 'POST'
  request.headers = { host: '127.0.0.1', 'content-type': 'application/json' }
  const record = {}
  const response = {
    writableEnded: false,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(text) {
      record.body = text
      this.writableEnded = true
    },
    destroy() {},
  }
  await route.handler(request, response)
  return { status: record.status, json: record.body === '' ? undefined : JSON.parse(record.body) }
}

/** Six-byte placeholder standing in for the downloaded server binary. */
async function makeBinary(directory) {
  const path = join(directory, process.platform === 'win32' ? 'matlab-mcp-server.exe' : 'matlab-mcp-server')
  await writeFile(path, 'stub')
  return path
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
    installToolkit: async () => {
      throw new Error('installToolkit must not run when a toolkit exists')
    },
    readToolkitRelease: async () => undefined,
    latestToolkitRelease: async () => {
      throw new Error('latestToolkitRelease must not run without an explicit check')
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

  const status = await activate(ctx, baseConfig({ toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), seams(binary))

  assert.equal(status.phase, 'ready')
  assert.equal(status.plugin, 'dsh-matlab')
  assert.equal(status.version, VERSION)
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
  // The client runs the naming bridge, which in turn runs the server binary.
  assert.equal(bridge.command, process.execPath)
  assert.match(String(bridge.args[0]), /mcp-bridge\.js$/u)
  assert.equal(bridge.args[4], binary)
  assert.equal(bridge.toolCallTimeoutMs, 600_000)
  assert.ok(bridge.args.includes('--matlab-session-mode=auto'))
  assert.ok(bridge.args.includes('--matlab-root=/fake/MATLAB/R2025b'))
  assert.ok(bridge.args.includes('--matlab-display-mode=desktop'))
  assert.ok(bridge.args.some(arg => arg.startsWith('--log-folder=')))
  assert.equal(status.probe.ok, true)
})

/** Wait for the off-path server diagnosis to finish, which activation does not. */
async function diagnosed(status) {
  for (let attempt = 0; attempt < 200 && status.diagnostics !== 'done'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return status
}

test('activation does not wait for the server version or the startup probe', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()

  // Both answers are held open: a host that measures activation (the market's
  // live mount allows ten seconds) must be able to mount this plugin while the
  // server is still being interrogated.
  let finishVersion
  let finishProbe
  const versionGate = new Promise(resolve => { finishVersion = resolve })
  const probeGate = new Promise(resolve => { finishProbe = resolve })
  const status = await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), {
    ...seams(binary),
    serverVersion: async () => {
      await versionGate
      return 'v9.9.9'
    },
    probeMcpServer: async () => {
      await probeGate
      return { ok: true, tools: [{ name: 'evaluate_matlab_code', description: '' }], resources: [] }
    },
  })

  assert.equal(status.phase, 'ready')
  assert.equal(status.diagnostics, 'pending')
  assert.equal(status.server.version, undefined)
  assert.equal(status.probe, undefined)

  finishVersion()
  finishProbe()
  await diagnosed(status)
  assert.equal(status.server.version, 'v9.9.9')
  assert.equal(status.probe.ok, true)
})

test('a diagnosis that throws is a warning, not a failed activation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()

  const status = await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), {
    ...seams(binary),
    serverVersion: async () => {
      throw new Error('binary cannot start')
    },
  })
  await diagnosed(status)

  assert.equal(status.phase, 'ready')
  assert.equal(status.diagnostics, 'done')
  assert.ok(status.warnings.some(warning => /server diagnosis failed: binary cannot start/u.test(warning)))
})

test('runs the MCP server through the naming bridge, with the agent name MATLAB shows', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts } = fakeContext()
  const probed = []
  const status = await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    agentName: 'DeepSeek Harness',
  }), {
    ...seams(binary),
    probeMcpServer: async options => {
      probed.push(options)
      return { ok: true, tools: [], resources: [] }
    },
  })

  const bridge = mounts[1].config
  assert.equal(bridge.command, process.execPath)
  assert.match(String(bridge.args[0]), /mcp-bridge\.js$/u)
  assert.deepEqual(bridge.args.slice(1, 5), ['--client-title', 'DeepSeek Harness', '--', binary])
  assert.equal(bridge.args[5], '--matlab-session-mode=auto')
  assert.equal(bridge.env.ELECTRON_RUN_AS_NODE, '1')

  // The startup probe goes through the same bridge, so it cannot greet MATLAB
  // under the MCP client's package name either.
  assert.equal(probed.length, 1)
  assert.equal(probed[0].command, process.execPath)
  assert.deepEqual(probed[0].args.slice(0, 5), bridge.args.slice(0, 5))
  assert.equal(status.phase, 'ready')
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

  await activate(ctx, baseConfig({ toolkitRoots: [toolkit], mcpServerPath: binary }), seams(binary))
  const status = webServer.registered.find(route => route.path === STATUS_PATH)
  assert.ok(status, 'the status route must be registered')
  assert.equal(status.kind, 'exact')
  const response = await status.resource()
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
    () => activate(ctx, baseConfig({ toolkitRoots: [toolkit], mcpServerPath: binary, skillGroups: ['nope'] }), seams(binary)),
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

  const status = await activate(ctx, baseConfig({ toolkitRoots: [toolkit],
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

  const status = await activate(ctx, baseConfig({ toolkitRoots: [toolkit],
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
    () => activate(ctx, baseConfig({ toolkitRoots: [toolkit],
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

  await activate(ctx, baseConfig({ toolkitRoots: [toolkit],
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

  const status = await activate(ctx, baseConfig({ toolkitRoots: [toolkit],
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

test('a missing toolkit is installed from its newest release over the same routes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx } = fakeContext()
  let installed

  const status = await activate(ctx, baseConfig({ autoProvision: true,
    mcpServerPath: binary,
    githubProxy: 'https://gh-proxy.com/',
    provisionTimeoutMs: 120_000,
    provisionWaitMs: 2_000,
  }), {
    ...seams(binary),
    installToolkit: async options => {
      installed = options
      return { root: toolkit, tag: 'MATK-2026.11.a', route: 'https://gh-proxy.com' }
    },
    readToolkitRelease: async () => ({ tag: 'MATK-2026.11.a', installedAt: '2026-11-05T23:18:23.000Z' }),
  })

  assert.ok(installed, 'installToolkit must run when no toolkit exists')
  assert.deepEqual(installed.routes, ['https://gh-proxy.com', null])
  assert.equal(installed.timeoutMs, 120_000)
  assert.equal(typeof installed.onProgress, 'function')
  assert.equal(status.skills.length, 2)
  assert.equal(status.toolkitRelease.tag, 'MATK-2026.11.a')
  assert.deepEqual(status.github.routes, ['gh-proxy.com', 'direct'])
})

test('the install button fetches even when automatic provisioning is off', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })
  let installed = 0

  await activate(ctx, baseConfig({ autoProvision: false, mcpServerPath: binary }), {
    ...seams(binary),
    installToolkit: async () => {
      installed += 1
      return { root: await makeToolkit(dir), tag: 'MATK-2026.11.a', route: null }
    },
  })
  // Activation obeys autoProvision: no fetch while it is off.
  assert.equal(installed, 0)

  const response = await postJson(webServer.registered.find(entry => entry.path === API_PATHS.provision), {})
  assert.equal(response.status, 202)
  assert.equal(response.json.started, true)
  assert.deepEqual(response.json.missing, ['toolkit'])

  for (let attempt = 0; attempt < 60 && installed === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(installed, 1, 'the explicit install action must not be vetoed by autoProvision')

  // Let the background mount finish before the temporary folder is removed.
  const stateRoute = webServer.registered.find(entry => entry.path === API_PATHS.state)
  const view = async () => (await stateRoute.resource(new Request(`http://127.0.0.1${API_PATHS.state}`))).json()
  let current = await view()
  for (let attempt = 0; attempt < 60 && current.progress.stage !== 'done'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50))
    current = await view()
  }
  assert.equal(current.progress.stage, 'done')
  assert.equal(current.phase, 'ready')
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
  const status = await activate(ctx, baseConfig({ autoProvision: true }), {
    ...seams(binary),
    installToolkit: () => never,
  })

  assert.ok(Date.now() - started < 5_000, `activation took ${String(Date.now() - started)} ms`)
  assert.equal(status.phase, 'provisioning')
  assert.equal(status.skills.length, 0)
  assert.equal(status.server, undefined)
})

test('toolkit extension files reach the first connection even when the toolkit is fetched in the background', async t => {  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
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

  const status = await activate(ctx, baseConfig({ autoProvision: true,
    mcpServerPath: binary,
    provisionWaitMs: 2_000,
  }), {
    ...seams(binary),
    installToolkit: async () => ({ root: toolkit, tag: 'MATK-2026.11.a', route: null }),
  })

  // Binding tools before the install would drop the toolkit's extensions from the
  // one and only connection; the background task must fetch the catalog first.
  assert.equal(status.phase, 'ready')
  assert.ok(mounts[1].config.args.includes(`--extension-file=${join(toolkit, 'tools', 'tools.json')}`))
})

test('the settings page can read the groups it toggles', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })

  await activate(ctx, baseConfig({ toolkitRoots: [toolkit], mcpServerPath: binary }), seams(binary))

  const route = webServer.registered.find(entry => entry.path === API_PATHS.state)
  assert.ok(route, 'the state route must be registered')
  const view = await (await route.resource(new Request('http://127.0.0.1' + API_PATHS.state))).json()
  assert.deepEqual(view.groups.map(group => group.name), ['core', 'extra'])
  assert.ok(view.groups.every(group => group.selected), 'every group is loaded by default')
  assert.equal(view.groups[0].skills, 1)
  assert.equal(view.config.sessionMode, 'auto')
})

test('a settings change remounts the catalog with the new selection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts, listeners } = fakeContext()
  // Stands in for the live wrappers DSH refreshes without restarting the plugin.
  let skillGroups = []
  const config = baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    skillGroups: { get: () => skillGroups },
  })

  await activate(ctx, config, seams(binary))
  assert.equal(mounts.length, 2)

  skillGroups = ['core']
  const listener = listeners.find(entry => entry.name === 'loader/volatile-update')
  assert.ok(listener, 'the plugin must follow volatile config updates')
  listener.callback([['skillGroups']])
  await new Promise(resolve => setTimeout(resolve, 400))

  assert.equal(mounts.length, 4, 'both halves remount against the new config')
  assert.deepEqual(mounts[2].config.customSkillDirs, [join(toolkit, 'skills-catalog', 'core')])
})

test('a settings change re-resolves the MATLAB root and the download route', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts, listeners } = fakeContext()
  let matlabRoot = ''
  let githubProxy = ''
  const config = baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    matlabRoot: { get: () => matlabRoot },
    githubProxy: { get: () => githubProxy },
  })
  const resolution = []
  await activate(ctx, config, {
    ...seams(binary),
    discoverMatlabRoot: async options => {
      resolution.push({ root: options.explicit })
      return { root: options.explicit ?? '/auto/MATLAB', source: 'config', exists: true }
    },
    resolveGithubAcceleration: async options => {
      resolution.push({ proxy: options.githubProxy })
      return { region: 'china', regionSource: 'config', proxy: null, source: 'none', routes: [null] }
    },
  })

  matlabRoot = '/new/MATLAB/R2026a'
  githubProxy = 'https://gh-proxy.com'
  const listener = listeners.find(entry => entry.name === 'loader/volatile-update')
  listener.callback([['matlabRoot'], ['githubProxy']])
  await new Promise(resolve => setTimeout(resolve, 400))

  // A remount must not reuse the activation-time root or route: the MCP bridge
  // would otherwise keep starting the old MATLAB over the old acceleration.
  assert.equal(resolution.filter(entry => entry.root !== undefined).at(-1).root, '/new/MATLAB/R2026a')
  assert.equal(resolution.filter(entry => entry.proxy !== undefined).at(-1).proxy, 'https://gh-proxy.com')
  const args = mounts.at(-1).config.args
  assert.ok(args.includes('--matlab-root=/new/MATLAB/R2026a'), args.join(' '))
})

test('a background download reports its progress to the dialog', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })

  const status = await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    autoProvision: true,
    provisionWaitMs: 5_000,
  }), {
    ...seams(binary),
    ensureMcpServer: async options => {
      options.onProgress({ bytes: 5_000_000, totalBytes: 10_000_000 })
      return { path: binary, source: 'download', downloaded: true, route: 'https://gh-proxy.com' }
    },
  })

  assert.equal(status.phase, 'ready')
  assert.equal(status.progress.stage, 'done')
  const route = webServer.registered.find(entry => entry.path === API_PATHS.progress)
  const view = await (await route.resource(new Request('http://127.0.0.1' + API_PATHS.progress))).json()
  assert.equal(view.percent, 50)
  assert.equal(view.route, 'gh-proxy.com')
})

test('ignores MathWorks installer artifacts outside the DSH home', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // A home that looks like a MathWorks install: ~/.matlab/agentic-toolkits with
  // both artifacts. The plugin must not find them, because they are not its own.
  const installerRoot = join(dir, '.matlab', 'agentic-toolkits')
  await mkdir(join(installerRoot, 'bin'), { recursive: true })
  await writeFile(join(installerRoot, 'bin', process.platform === 'win32' ? 'matlab-mcp-server.exe' : 'matlab-mcp-server'), 'stub')
  const installedToolkit = join(installerRoot, 'matlab')
  await mkdir(join(installedToolkit, 'skills-catalog', 'core', 'core-skill'), { recursive: true })
  await writeFile(join(installedToolkit, 'skills-catalog', 'core', 'core-skill', 'SKILL.md'), '---\nname: core-skill\ndescription: d\n---\n')
  await writeFile(join(installedToolkit, 'manifest.yaml'), MANIFEST)

  const previous = {}
  for (const name of ['USERPROFILE', 'HOME', 'DSH_HOME']) {
    previous[name] = process.env[name]
    if (name === 'DSH_HOME') process.env.DSH_HOME = join(dir, 'dsh-home')
    else process.env[name] = dir
    t.after(() => {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    })
  }
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const { ctx } = fakeContext()

  // With the external artifacts ignored, nothing is found and only an explicit
  // path (or provisioning) can satisfy the requirement.
  await assert.rejects(
    () => activate(ctx, baseConfig({ autoProvision: false, toolkitRoots: [installedToolkit] }), seams(binary)),
    /the MATLAB MCP Server binary was not found/u,
  )
})

test('an update replaces only the outdated artifact and remounts it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  // A catalog the plugin manages: only that one is replaceable by a release.
  const toolkit = await makeToolkit(join(dir, 'dsh-home', 'matlab', 'toolkits'))
  const webServer = recordingWebServer()
  const { ctx, mounts } = fakeContext({ skills: {}, webServer })
  const calls = []

  const status = await activate(ctx, baseConfig({
    mcpServerPath: binary,
  }), {
    ...seams(binary),
    serverVersion: async () => 'github.com/matlab/matlab-mcp-server v0.16.0',
    latestServerRelease: async () => ({ tag: 'v0.17.0', version: 'v0.17.0', route: 'https://gh-proxy.com' }),
    readToolkitRelease: async () => ({ tag: 'MATK-2026.10.a', installedAt: '2026-10-22T00:00:00.000Z' }),
    latestToolkitRelease: async () => ({ tag: 'MATK-2026.11.a', route: 'https://gh-proxy.com' }),
    updateMcpServer: async () => {
      calls.push('download')
      return { path: binary, source: 'download', downloaded: true, route: 'https://gh-proxy.com' }
    },
    updateToolkit: async () => {
      calls.push('update-toolkit')
      return { root: toolkit, tag: 'MATK-2026.11.a', route: 'https://gh-proxy.com' }
    },
  })
  assert.equal(status.phase, 'ready')
  assert.equal(mounts.length, 2)

  const route = path => webServer.registered.find(entry => entry.path === path)
  const post = body => postJson(route(API_PATHS.update), body)
  const state = async () => (await route(API_PATHS.state).resource(new Request(`http://127.0.0.1${API_PATHS.state}`))).json()

  const check = (await post({ check: true })).json
  assert.equal(check.server.current, 'v0.16.0')
  assert.equal(check.server.latest, 'v0.17.0')
  assert.equal(check.server.outdated, true)
  assert.equal(check.toolkit.current, 'MATK-2026.10.a')
  assert.equal(check.toolkit.latest, 'MATK-2026.11.a')
  assert.equal(check.toolkit.outdated, true)
  assert.deepEqual(calls, [], 'checking must not download')

  const accepted = await post()
  assert.equal(accepted.status, 202)
  let view = await state()
  for (let attempt = 0; attempt < 60 && view.progress.stage !== 'done'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50))
    view = await state()
  }

  assert.deepEqual(calls, ['update-toolkit', 'download'])
  assert.equal(mounts.length, 4, 'both halves are remounted around the update')
  assert.equal(view.phase, 'ready')
  assert.equal(view.progress.kind, 'update')
  assert.equal(view.progress.stage, 'done')
})

test('a toolkit the user configured is never compared with a release or replaced', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })

  await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
  }), {
    ...seams(binary),
    latestServerRelease: async () => ({ tag: 'v0.16.0', version: 'v0.16.0', route: null }),
    updateToolkit: async () => {
      throw new Error('an explicit toolkit must not be replaced')
    },
  })

  const route = path => webServer.registered.find(entry => entry.path === path)
  const check = (await postJson(route(API_PATHS.update), { check: true })).json
  assert.equal(check.toolkit.installed, true)
  assert.equal(check.toolkit.latest, undefined)
  assert.equal(check.toolkit.outdated, false)
  // The probe the plugin would use for its own install is never asked about a
  // folder the user pointed at, so nothing offers to overwrite it.
  const outcome = (await postJson(route(API_PATHS.update), {})).json
  assert.equal(outcome.started, false)
})

test('workspace mode drops the start folder and records the conversation folder per call', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const binary = await makeBinary(dir)
  const toolkit = await makeToolkit(dir)
  const { ctx, mounts, listeners } = fakeContext({
    skills: {},
    // The service a live host publishes: one folder per session.
    workingDirectory: { get: () => 'C:\\work\\project' },
  })

  await activate(ctx, baseConfig({
    toolkitRoots: [toolkit],
    mcpServerPath: binary,
    initialWorkingFolder: 'C:\\ignored',
    useWorkspaceFolder: true,
  }), seams(binary))

  const bridge = mounts[1].config
  const index = bridge.args.indexOf('--workspace-file')
  assert.ok(index > 0, 'the bridge must be told where the record lives')
  const workspaceFile = bridge.args[index + 1]
  assert.equal(workspaceFile, join(dir, 'dsh-home', 'matlab', 'workspace-folder.json'))
  // One MATLAB serves every conversation, so a start-time folder would be a lie.
  assert.equal(bridge.args.some(arg => String(arg).startsWith('--initial-working-folder=')), false)

  const listener = listeners.find(entry => entry.name === 'tools/pre-execute')
  assert.ok(listener, 'the host must see tool calls to know the conversation folder')
  const verdict = await listener.callback(
    { name: 'mcp__matlab__evaluate_matlab_code', agent: { session: {} } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(verdict, { kind: 'allow' })
  const record = JSON.parse(await readFile(workspaceFile, 'utf8'))
  assert.equal(record.cwd, 'C:\\work\\project')

  // A tool outside this server leaves the record alone.
  await writeFile(workspaceFile, JSON.stringify({ cwd: 'C:\\previous' }))
  await listener.callback({ name: 'pwsh', agent: { session: {} } }, async () => ({ kind: 'allow' }))
  assert.deepEqual(JSON.parse(await readFile(workspaceFile, 'utf8')), { cwd: 'C:\\previous' })
})

/** Whether a path exists, whatever kind it is. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('the remove action deletes only the plugin-managed artifacts and clears the status', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const dataRoot = join(dir, 'dsh-home', 'matlab')
  await mkdir(join(dataRoot, 'bin'), { recursive: true })
  const binary = await makeBinary(join(dataRoot, 'bin'))
  const toolkit = await makeToolkit(join(dataRoot, 'toolkits'))
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })

  await activate(ctx, baseConfig({ mcpServerPath: binary }), seams(binary))
  const route = path => webServer.registered.find(entry => entry.path === path)

  const removed = await postJson(route(API_PATHS.dependencies), { action: 'remove' })
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.json.artifacts, ['toolkit', 'server'])
  assert.equal(await exists(binary), false)
  assert.equal(await exists(toolkit), false)

  const view = await (await route(API_PATHS.state).resource(new Request(`http://127.0.0.1${API_PATHS.state}`))).json()
  assert.deepEqual(view.toolkit, [])
  assert.equal(view.server, null)
  assert.equal(view.toolkitRelease, null)
  assert.equal(view.updates, null)
})

test('the download action cleans the old artifacts before fetching the newest ones', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-activate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => delete process.env.DSH_HOME)
  isolatedGithubEnv(t)
  const dataRoot = join(dir, 'dsh-home', 'matlab')
  await mkdir(join(dataRoot, 'bin'), { recursive: true })
  const oldBinary = await makeBinary(join(dataRoot, 'bin'))
  const oldToolkit = await makeToolkit(join(dataRoot, 'toolkits'))
  const webServer = recordingWebServer()
  const { ctx } = fakeContext({ skills: {}, webServer })
  const calls = []
  let requested

  await activate(ctx, baseConfig({ mcpServerPath: oldBinary }), {
    ...seams(oldBinary),
    readToolkitRelease: async () => ({ tag: 'MATK-2026.11.a', installedAt: '2026-11-05T23:18:23.000Z' }),
    installToolkit: async () => {
      calls.push('install-toolkit')
      // The promised behaviour: the old copy is gone before the fetch starts.
      assert.equal(await exists(oldToolkit), false, 'the old toolkit must be removed first')
      const root = await makeToolkit(join(dataRoot, 'toolkits'), ['core'])
      return { root, tag: 'MATK-2026.11.a', route: 'https://gh-proxy.com' }
    },
    ensureMcpServer: async options => {
      calls.push('ensure-server')
      requested = options
      assert.equal(await exists(oldBinary), false, 'the old binary must be removed first')
      return { path: oldBinary, source: 'download', downloaded: true, route: 'https://gh-proxy.com' }
    },
  })

  const route = path => webServer.registered.find(entry => entry.path === path)
  const accepted = await postJson(route(API_PATHS.dependencies), { action: 'download' })
  assert.equal(accepted.status, 202)

  let view = await (await route(API_PATHS.state).resource(new Request(`http://127.0.0.1${API_PATHS.state}`))).json()
  for (let attempt = 0; attempt < 60 && view.phase !== 'ready'; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50))
    view = await (await route(API_PATHS.state).resource(new Request(`http://127.0.0.1${API_PATHS.state}`))).json()
  }
  assert.deepEqual(calls, ['install-toolkit', 'ensure-server'])
  assert.equal(requested.autoProvision, true, 'the explicit download must work even with autoProvision off')
  assert.equal(view.phase, 'ready')
  assert.equal(view.toolkitRelease.tag, 'MATK-2026.11.a')
  assert.equal(view.server.downloaded, true)
})
