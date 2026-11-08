import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Registered before the dynamic import below; the stub replaces only the schema
// module, so the rest of the entry graph is the real one.
register('../test-support/schemastery-hook.mjs', import.meta.url)

const plugin = await import('../lib/index.js')

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
    'autoProvision',
    'disableTelemetry',
    'displayMode',
    'extensionFiles',
    'failOnStartupError',
    'initialWorkingFolder',
    'initializeMatlabOnStartup',
    'installRoot',
    'matlabRoot',
    'mcpServerPath',
    'probe',
    'probeTimeoutMs',
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
    'installerMatlabRoot',
    'installerServerVersion',
    'parseMcpServerExtensions',
    'parseSkillGroups',
    'probeMcpServer',
    'readInstallerConfig',
    'readToolkit',
    'releaseRank',
    'resolveDshHome',
    'resolveOptions',
    'selectSkillGroups',
    'serverEnvironment',
  ]) {
    assert.equal(typeof plugin[name], 'function', `missing export ${name}`)
  }
})

test('the plugin applies through the exported entry point', async () => {
  const mounts = []
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    plugin: (module, config) => {
      mounts.push(config)
      return Promise.resolve()
    },
    effect: () => () => {},
  }
  // No toolkit and no binary here: activation must report rather than throw when
  // failOnStartupError is false.
  const status = await plugin.apply(ctx, plugin.Config({ autoProvision: false, probe: false, statusRoute: false, mcpServerPath: '' }))
  assert.equal(typeof status.phase, 'string')
})
