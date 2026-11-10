import test from 'node:test'
import assert from 'node:assert/strict'

import { API_PATHS, applyConfigPatch, mountPluginApi, progressView, stateView } from '../lib/api.js'

/** A context with the two services the API reaches for, recording registrations. */
function fakeContext({ settings, webServer } = {}) {
  const registered = []
  const disposers = []
  const ctx = {
    get: name => (name === 'settings' ? settings : name === 'webServer' ? webServer : undefined),
    effect: factory => {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
  }
  if (webServer !== undefined) {
    webServer.register = route => {
      registered.push(route)
      return () => {
        const index = registered.indexOf(route)
        if (index >= 0) registered.splice(index, 1)
      }
    }
  }
  return { ctx, registered, disposers }
}

/** An activation state with every field the API reads. */
function fakeState(overrides = {}) {
  const status = {
    plugin: 'dsh-plugin-matlab',
    phase: 'ready',
    matlab: undefined,
    server: { path: 'C:\\bin\\matlab-mcp-server.exe', source: 'download', version: 'v0.16.0', downloaded: true, route: 'gh-proxy.com' },
    toolkit: [{ root: 'C:\\t', displayName: 'MATLAB', kind: 'matlab', groups: ['core'], extensionFiles: [] }],
    github: { region: 'china', regionSource: 'market', proxy: null, proxySource: 'none', routes: ['gh-proxy.com', 'direct'] },
    progress: { active: false, stage: 'idle' },
    skills: [],
    probe: { ok: true, tools: [{ name: 'evaluate_matlab_code' }], resources: [{ uri: 'guidelines://coding' }] },
    warnings: [],
    error: undefined,
    installer: { root: 'C:\\i', configFound: false },
    ...overrides.status,
  }
  return {
    ctx: undefined,
    ns: 'matlab-agentic',
    status,
    progress: { active: false, stage: 'idle', bytes: 0, totalBytes: undefined, route: undefined, startedAt: undefined },
    groups: [
      { name: 'core', displayName: 'Core', description: '', required: true, skills: 6, toolkit: 'MATLAB', selected: true },
      { name: 'radar', displayName: 'Radar', description: '', required: false, skills: 4, toolkit: 'MATLAB', selected: false },
    ],
    matlab: { root: 'C:\\Program Files\\MATLAB\\R2023b', source: 'registry', exists: true },
    options: {
      serverName: 'matlab',
      toolCallTimeoutMs: 600_000,
      matlabRoot: undefined,
      mcpServerPath: undefined,
      displayMode: 'desktop',
      sessionMode: 'auto',
      initialWorkingFolder: undefined,
      initializeMatlabOnStartup: false,
      disableTelemetry: false,
      githubProxy: undefined,
      downloadRegion: 'auto',
      provisionTimeoutMs: 300_000,
      provisionWaitMs: 0,
      toolkitRoots: [],
      skillGroups: [],
      extensionFiles: [],
      watchSkills: true,
    },
    log: () => {},
    updates: null,
    startProvisioning: async () => ({ started: false, phase: 'ready', missing: [] }),
    ...overrides,
  }
}

test('reports the live state the Settings page renders', () => {
  const state = fakeState()
  state.ctx = fakeContext().ctx
  const view = stateView(state)
  assert.equal(view.phase, 'ready')
  assert.equal(view.config.matlabRoot, '')
  assert.equal(view.config.sessionMode, 'auto')
  assert.equal(view.groups.length, 2)
  assert.equal(view.groups[0].selected, true)
  assert.equal(view.server.route, 'gh-proxy.com')
  assert.deepEqual(view.probe.tools, ['evaluate_matlab_code'])
  assert.deepEqual(view.github.routes, ['gh-proxy.com', 'direct'])
  assert.equal(view.editable, false)
  assert.equal(view.revision, null)
})

test('reads the schema revision DSH holds for this plugin', () => {
  const settings = {
    describe: () => [
      { ns: 'other', revision: 1 },
      { ns: 'matlab-agentic', revision: 7 },
    ],
  }
  const state = fakeState({ ctx: fakeContext({ settings }).ctx })
  const view = stateView(state)
  assert.equal(view.editable, true)
  assert.equal(view.revision, 7)
})

test('turns a download into a percentage the dialog can draw', () => {
  const progress = progressView({ active: true, stage: 'download', bytes: 5_000_000, totalBytes: 19_905_376, startedAt: Date.now() - 1000 })
  assert.equal(progress.active, true)
  assert.equal(progress.percent, 25)
  assert.equal(progress.stage, 'download')
  // No declared length keeps the bar indeterminate rather than inventing one.
  assert.equal(progressView({ active: true, stage: 'clone', bytes: 10 }).percent, null)
})

test('writes only volatile fields through the settings service', async () => {
  const calls = []
  const settings = { update: async (ns, patch, revision) => calls.push({ ns, patch, revision }) }
  const state = fakeState({ ctx: fakeContext({ settings }).ctx })

  assert.deepEqual(await applyConfigPatch(state, { skillGroups: ['core'] }, 3), { status: 200 })
  assert.deepEqual(calls, [{ ns: 'matlab-agentic', patch: { skillGroups: ['core'] }, revision: 3 }])

  assert.equal((await applyConfigPatch(state, { statusRoute: false }, 3)).status, 400)
  assert.equal((await applyConfigPatch(state, 'nope', 3)).status, 400)
  assert.equal(calls.length, 1)
})

test('reports a missing settings service and a stale revision', async () => {
  const withoutSettings = fakeState({ ctx: fakeContext().ctx })
  assert.equal((await applyConfigPatch(withoutSettings, { skillGroups: [] }, 1)).status, 503)

  const settings = {
    update: async () => {
      throw new Error('settings changed since revision 2')
    },
  }
  const conflicted = fakeState({ ctx: fakeContext({ settings }).ctx })
  const outcome = await applyConfigPatch(conflicted, { skillGroups: [] }, 2)
  assert.equal(outcome.status, 409)
  assert.match(outcome.error, /changed since revision/u)
})

test('serves state, progress, config, and provision routes', async () => {
  const settings = { update: async () => {}, describe: () => [{ ns: 'matlab-agentic', revision: 1 }] }
  const webServer = {}
  const { ctx, registered } = fakeContext({ settings, webServer })
  const state = fakeState({ ctx })
  let provisioned = 0
  state.startProvisioning = async () => {
    provisioned += 1
    return { started: true, phase: 'provisioning', missing: ['tools'] }
  }

  mountPluginApi(state)
  assert.deepEqual(registered.map(route => route.path).sort(), Object.values(API_PATHS).sort())
  assert.ok(registered.every(route => route.kind === 'exact'))

  const byPath = path => registered.find(route => route.path === path)
  const stateResponse = await byPath(API_PATHS.state).resource(new Request('http://127.0.0.1/plugin/matlab/state'))
  assert.equal(stateResponse.status, 200)
  assert.equal((await stateResponse.json()).phase, 'ready')

  const progressResponse = await byPath(API_PATHS.progress).resource(new Request('http://127.0.0.1/plugin/matlab/progress'))
  assert.equal((await progressResponse.json()).stage, 'idle')

  const configResponse = await byPath(API_PATHS.config).resource(new Request('http://127.0.0.1/plugin/matlab/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: { provisionWaitMs: 5000 }, revision: 1 }),
  }))
  assert.equal(configResponse.status, 200)

  const provisionResponse = await byPath(API_PATHS.provision).resource(new Request('http://127.0.0.1/plugin/matlab/provision', { method: 'POST' }))
  assert.equal(provisionResponse.status, 202)
  assert.equal(provisioned, 1)

  const wrongMethod = await byPath(API_PATHS.config).resource(new Request('http://127.0.0.1/plugin/matlab/config'))
  assert.equal(wrongMethod.status, 405)
})

test('skips the routes when the profile has no web server', () => {
  const state = fakeState({ ctx: fakeContext().ctx })
  assert.equal(mountPluginApi(state), undefined)
})

test('a check reports both artifacts without downloading anything', async () => {
  const webServer = {}
  const { ctx, registered } = fakeContext({ webServer })
  const state = fakeState({ ctx })
  const check = {
    checkedAt: 1,
    server: { installed: true, current: 'v0.16.0', latest: 'v0.17.0', outdated: true },
    toolkit: { installed: true, current: '1234567', latest: '89abcde', outdated: true },
  }
  let checks = 0
  state.checkDependencies = async () => {
    checks += 1
    return check
  }
  mountPluginApi(state)
  const route = registered.find(entry => entry.path === API_PATHS.update)
  const response = await route.resource(new Request('http://127.0.0.1/plugin/matlab/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ check: true }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.server.outdated, true)
  assert.equal(body.toolkit.latest, '89abcde')
  assert.equal(checks, 1)
})

test('an update starts the replacement and reports it as accepted', async () => {
  const webServer = {}
  const { ctx, registered } = fakeContext({ webServer })
  const state = fakeState({ ctx })
  state.updateDependencies = async () => ({ started: true, check: { checkedAt: 1 } })
  mountPluginApi(state)
  const route = registered.find(entry => entry.path === API_PATHS.update)
  const response = await route.resource(new Request('http://127.0.0.1/plugin/matlab/update', { method: 'POST' }))
  assert.equal(response.status, 202)
  assert.equal((await response.json()).started, true)

  const wrongMethod = await route.resource(new Request('http://127.0.0.1/plugin/matlab/update'))
  assert.equal(wrongMethod.status, 405)
})

test('state carries the last update check and the progress kind', () => {
  const state = fakeState({ ctx: fakeContext().ctx })
  state.updates = {
    checkedAt: 2,
    server: { installed: true, current: 'v0.16.0', latest: 'v0.16.0', outdated: false },
    toolkit: { installed: true, current: '1234567', latest: '1234567', outdated: false },
  }
  state.progress = { kind: 'update', active: true, stage: 'download', bytes: 1, totalBytes: 2, startedAt: 1 }
  const view = stateView(state)
  assert.deepEqual(view.updates, state.updates)
  assert.equal(view.progress.kind, 'update')
  assert.equal(view.progress.percent, 50)
})
test('waits for the web carrier when it is mounted after the plugin', async () => {
  // The production symptom: activation happens before webServer exists, so a
  // plain ctx.get('webServer') check registers nothing and the page sees 404.
  const pending = []
  const state = fakeState({})
  state.ctx = {
    get: () => undefined,
    inject: (deps, callback) => {
      pending.push({ deps, callback })
    },
    effect: factory => factory(),
  }
  mountPluginApi(state)
  assert.equal(pending.length, 1, 'the plugin must inject the carrier instead of giving up')
  assert.deepEqual(pending[0].deps, ['webServer'])

  const registered = []
  const webServer = {
    register: route => {
      registered.push(route)
      return () => {}
    },
  }
  pending[0].callback({
    webServer,
    effect: factory => factory(),
  })

  assert.deepEqual(registered.map(route => route.path).sort(), Object.values(API_PATHS).sort())
  const response = await registered.find(route => route.path === API_PATHS.state).resource(new Request(`http://127.0.0.1${API_PATHS.state}`))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).plugin, 'dsh-plugin-matlab')
})

test('disposes its routes with the carrier', async () => {
  const registered = []
  const disposed = []
  const webServer = {
    register: route => {
      registered.push(route)
      return () => disposed.push(route.path)
    },
  }
  let cleanup
  const state = fakeState({})
  state.ctx = {
    get: () => webServer,
    effect: factory => {
      cleanup = factory()
      return cleanup
    },
  }
  mountPluginApi(state)
  assert.equal(registered.length, 5)
  cleanup()
  assert.equal(disposed.length, 5)
})
