import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { API_PATHS, applyConfigPatch, mountPluginApi, progressView, stateView } from '../lib/api.js'

/** A Node request carrying an optional JSON body, as the carrier's handler receives. */
function nodeRequest({ method = 'POST', body, headers = {} } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  stream.method = method
  stream.headers = { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers }
  return stream
}

/** A Node response recording what the handler wrote. */
function nodeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  return {
    record,
    response: {
      writableEnded: false,
      writeHead(status, headers) {
        record.status = status
        record.headers = headers
        return this
      },
      end(text) {
        record.body = text ?? ''
        this.writableEnded = true
      },
      destroy() {},
    },
  }
}

/** Run one registered handler the way the carrier does over HTTP. */
async function invoke(route, options) {
  const { response, record } = nodeResponse()
  await route.handler(nodeRequest(options), response)
  return { ...record, json: record.body === '' ? undefined : JSON.parse(record.body) }
}

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
    toolkitRelease: { root: 'C:\\t', tag: 'MATK-2026.11.a', installedAt: '2026-11-05T23:18:23.000Z', managed: true },
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
  // The page shows which release the local catalog came from; the update table
  // needs it for its "local tag" column.
  assert.equal(view.toolkitRelease.tag, 'MATK-2026.11.a')
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
  assert.equal(progressView({ active: true, stage: 'toolkit', bytes: 10 }).percent, null)
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

  const configResponse = await invoke(byPath(API_PATHS.config), {
    body: JSON.stringify({ patch: { provisionWaitMs: 5000 }, revision: 1 }),
  })
  assert.equal(configResponse.status, 200)
  assert.equal(configResponse.json.ok, true)

  const provisionResponse = await invoke(byPath(API_PATHS.provision), { body: '{}' })
  assert.equal(provisionResponse.status, 202)
  assert.equal(provisioned, 1)

  const wrongMethod = await invoke(byPath(API_PATHS.config), { method: 'GET' })
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')
})

test('mutations are handlers and reads are resources, the two carrier shapes', () => {
  const settings = { update: async () => {}, describe: () => [{ ns: 'matlab-agentic', revision: 1 }] }
  const { ctx, registered } = fakeContext({ settings, webServer: {} })
  mountPluginApi(fakeState({ ctx }))
  const byPath = path => registered.find(route => route.path === path)
  assert.equal(typeof byPath(API_PATHS.state).resource, 'function')
  assert.equal(typeof byPath(API_PATHS.progress).resource, 'function')
  // The carrier answers any method but GET/HEAD with its own 405 before a
  // resource runs, so a POST route must be a handler or it can never be called.
  for (const path of [API_PATHS.config, API_PATHS.provision, API_PATHS.update]) {
    assert.equal(typeof byPath(path).handler, 'function', `${path} must be a handler`)
    assert.equal(byPath(path).resource, undefined, `${path} must not be a resource`)
  }
})

test('a mutation rejects the wrong content type, a foreign origin, and a missing body', async () => {
  const settings = { update: async () => {}, describe: () => [{ ns: 'matlab-agentic', revision: 1 }] }
  const { ctx, registered } = fakeContext({ settings, webServer: {} })
  mountPluginApi(fakeState({ ctx }))
  const config = registered.find(route => route.path === API_PATHS.config)

  const wrongType = await invoke(config, { body: '{}', headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 415)

  const crossOrigin = await invoke(config, {
    body: '{}',
    headers: { origin: 'https://evil.example', host: '127.0.0.1:3000' },
  })
  assert.equal(crossOrigin.status, 403)

  const malformed = await invoke(config, { body: '{' })
  assert.equal(malformed.status, 400)
  assert.match(malformed.json.error, /JSON/u)
})

test('a real HTTP POST reaches the handler through the carrier contract', async t => {
  const saved = []
  const settings = {
    update: async (ns, patch, revision) => {
      saved.push({ ns, patch, revision })
    },
    describe: () => [{ ns: 'matlab-agentic', revision: 4 }],
  }
  const { createServer } = await import('node:http')
  const { ctx, registered } = fakeContext({ settings, webServer: {} })
  mountPluginApi(fakeState({ ctx }))

  // The carrier's rule the plugin must live within: only GET/HEAD reaches a
  // resource; everything else reaches the handler (or its own 405 for a
  // resource). Reproducing it here is what makes a POST regression fail.
  const server = createServer((request, response) => {
    const route = registered.find(entry => entry.path === new URL(request.url, 'http://127.0.0.1').pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    if (route.resource !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      Promise.resolve(route.resource(new Request(`http://127.0.0.1${request.url}`, { method: request.method }))).then(async answer => {
        response.writeHead(answer.status, Object.fromEntries(answer.headers))
        response.end(Buffer.from(await answer.arrayBuffer()))
      }).catch(error => {
        response.writeHead(500)
        response.end(String(error))
      })
      return
    }
    void route.handler(request, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    // fetch keeps its socket in a pool; without this the close callback waits
    // on the idle keep-alive connection and the test never finishes.
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  const read = await fetch(`${base}${API_PATHS.state}`)
  assert.equal(read.status, 200)
  assert.equal((await read.json()).revision, 4)

  const write = await fetch(`${base}${API_PATHS.config}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: { disableTelemetry: true }, revision: 4 }),
  })
  assert.equal(write.status, 200)
  assert.deepEqual(await write.json(), { ok: true })
  assert.deepEqual(saved, [{ ns: 'matlab-agentic', patch: { disableTelemetry: true }, revision: 4 }])

  const wrongMethod = await fetch(`${base}${API_PATHS.config}`)
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
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
  const response = await invoke(route, { body: JSON.stringify({ check: true }) })
  assert.equal(response.status, 200)
  const body = response.json
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
  const response = await invoke(route, { body: '{}' })
  assert.equal(response.status, 202)
  assert.equal(response.json.started, true)

  const wrongMethod = await invoke(route, { method: 'GET' })
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
