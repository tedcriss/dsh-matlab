import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Registered before the dynamic import below; the stub replaces only the schema
// module, so the rest of the entry graph is the real one.
register('../test-support/schemastery-hook.mjs', import.meta.url)

const plugin = await import('../lib/index.js')

const MANIFEST = `display-name: "Example Agentic Toolkit"
skill-groups:
  - name: core
    path: skills-catalog/core
    required: true
`

/** A context that records mounts and answers the two optional services. */
function fakeContext() {
  const mounts = []
  return {
    mounts,
    ctx: {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      // The skill registry must exist, or the plugin deliberately skips the catalog.
      get: name => (name === 'skills' ? {} : undefined),
      on: () => () => {},
      plugin: (module, config) => {
        mounts.push(config)
        return Promise.resolve()
      },
      effect: () => () => {},
    },
  }
}

/** A temp toolkit, a stand-in binary, and transports that never touch MATLAB. */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-entry-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const toolkit = join(dir, 'toolkit')
  await mkdir(join(toolkit, 'skills-catalog', 'core', 'core-skill'), { recursive: true })
  await writeFile(join(toolkit, 'skills-catalog', 'core', 'core-skill', 'SKILL.md'), '---\nname: core-skill\ndescription: d\n---\n')
  await writeFile(join(toolkit, 'manifest.yaml'), MANIFEST)
  const binary = join(dir, 'matlab-mcp-server.exe')
  await writeFile(binary, 'stub')
  const overrides = {
    discoverMatlabRoot: async () => ({ root: '/fake/MATLAB/R2025b', source: 'config', exists: true }),
    ensureMcpServer: async () => ({ path: binary, source: 'config', downloaded: false }),
    serverVersion: async () => 'v9.9.9',
    probeMcpServer: async () => ({ ok: true, tools: [], resources: [] }),
    cloneToolkit: async () => {
      throw new Error('cloneToolkit must not run')
    },
    countSkills: async () => 1,
    loadSkillProvider: async () => ({ apply: () => {}, name: 'fake-skill-filesystem' }),
    loadMcpClient: async () => ({ apply: () => {}, name: 'fake-mcp-client' }),
  }
  const config = {
    matlabRoot: '',
    mcpServerPath: binary,
    autoProvision: false,
    toolkitRoots: [toolkit],
    skillGroups: [],
    probe: false,
    statusRoute: false,
  }
  return { dir, binary, overrides, config }
}

test('exports the Cordis plugin contract', () => {
  assert.equal(plugin.name, 'matlab-agentic')
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  // Schemastery schemas are callable, and Cordis calls `Config(config)` during validation.
  assert.equal(typeof plugin.Config, 'function')
})

test('declares the documented configuration fields', () => {
  const fields = Object.keys(plugin.Config.fields).sort()
  assert.deepEqual(fields, [
    'agentName',
    'autoProvision',
    'disableTelemetry',
    'displayMode',
    'downloadRegion',
    'extensionFiles',
    'failOnStartupError',
    'githubProxy',
    'initialWorkingFolder',
    'initializeMatlabOnStartup',
    'matlabRoot',
    'mcpServerPath',
    'probe',
    'probeTimeoutMs',
    'provisionTimeoutMs',
    'provisionWaitMs',
    'serverName',
    'sessionMode',
    'skillGroups',
    'statusRoute',
    'toolCallTimeoutMs',
    'toolkitRoots',
    'watchSkills',
  ])
})

test('re-exports the seams documented for integrators', () => {
  for (const name of [
    'assetCandidates',
    'assetUrl',
    'buildMcpServerArgs',
    'countSkills',
    'discoverMatlabRoot',
    'discoverToolkits',
    'isNewer',
    'latestServerRelease',
    'latestToolkitHead',
    'localToolkitHead',
    'looksLikeExecutable',
    'parseVersion',
    'normalizeGithubProxy',
    'parseMcpServerExtensions',
    'parseSkillGroups',
    'probeMcpServer',
    'readToolkit',
    'releaseRank',
    'resolveDshHome',
    'resolveGithubAcceleration',
    'resolveOptions',
    'routesFor',
    'selectSkillGroups',
    'serverEnvironment',
    'throughProxy',
  ]) {
    assert.equal(typeof plugin[name], 'function', `missing export ${name}`)
  }
})

test('apply resolves to nothing, because Cordis reads a plugin result as an effect', async t => {
  const { overrides, config } = await fixture(t)
  const { ctx, mounts } = fakeContext()
  const result = await plugin.apply(ctx, plugin.Config(config), overrides)
  // A status object here throws TypeError: Invalid effect and unloads the fiber.
  assert.equal(result, undefined)
  assert.equal(mounts.length, 2)
})

test('apply still rejects when activation fails and failOnStartupError is set', async t => {
  const { overrides, config } = await fixture(t)
  const { ctx } = fakeContext()
  await assert.rejects(
    () => plugin.apply(ctx, plugin.Config({ ...config, failOnStartupError: true }), {
      ...overrides,
      loadMcpClient: async () => {
        throw new Error('no server binary')
      },
    }),
    /no server binary/u,
  )
})
