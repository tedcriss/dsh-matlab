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
      installRoot: undefined,
      toolkitRoots: [],
      skillGroups: [],
      extensionFiles: [],
      watchSkills: true,
    },
    log: () => {},
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
