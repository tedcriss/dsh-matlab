import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveOptions } from '../lib/options.js'

function baseConfig(overrides = {}) {
  return {
    serverName: 'matlab',
    agentName: 'DeepSeek',
    toolCallTimeoutMs: 600_000,
    failOnStartupError: false,
    matlabRoot: '',
    displayMode: 'desktop',
    sessionMode: 'auto',
    initialWorkingFolder: '',
    useWorkspaceFolder: false,
    initializeMatlabOnStartup: false,
    disableTelemetry: false,
    mcpServerPath: '',
    autoProvision: true,
    githubProxy: '',
    downloadRegion: 'auto',
    provisionTimeoutMs: 300_000,
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

test('treats an empty string as "discover it", not as a value', () => {
  const options = resolveOptions(baseConfig())
  assert.equal(options.matlabRoot, undefined)
  assert.equal(options.mcpServerPath, undefined)
  assert.equal(options.initialWorkingFolder, undefined)
  assert.equal(options.useWorkspaceFolder, false)
  assert.equal(resolveOptions(baseConfig({ useWorkspaceFolder: true })).useWorkspaceFolder, true)
})

test('keeps a non-boolean workspace flag off instead of trusting it', () => {
  assert.equal(resolveOptions(baseConfig({ useWorkspaceFolder: 'yes' })).useWorkspaceFolder, false)
})

test('trims whitespace-only settings to absence', () => {
  const options = resolveOptions(baseConfig({ matlabRoot: '   ' }))
  assert.equal(options.matlabRoot, undefined)
})

test('keeps real values and trims them', () => {
  const options = resolveOptions(baseConfig({
    matlabRoot: ' /opt/MATLAB/R2025b ',
    skillGroups: [' matlab-core ', ''],
    extensionFiles: [' /tools/a.json '],
    toolkitRoots: [' /srv/toolkit '],
  }))
  assert.equal(options.matlabRoot, '/opt/MATLAB/R2025b')
  assert.deepEqual(options.skillGroups, ['matlab-core'])
  assert.deepEqual(options.extensionFiles, ['/tools/a.json'])
  assert.deepEqual(options.toolkitRoots, ['/srv/toolkit'])
})

test('unwraps volatile fields instead of ignoring the live value', () => {
  // A `.volatile()` field arrives as an object exposing get(); reading it as a
  // plain value would silently drop the user's setting.
  const volatile = current => ({ get: () => current })
  const options = resolveOptions(baseConfig({
    matlabRoot: volatile('C:\\MATLAB\\R2025b'),
    skillGroups: volatile(['matlab-core', 'signal-processing']),
    sessionMode: volatile('existing'),
    probe: volatile(false),
  }))
  assert.equal(options.matlabRoot, 'C:\\MATLAB\\R2025b')
  assert.deepEqual(options.skillGroups, ['matlab-core', 'signal-processing'])
  assert.equal(options.sessionMode, 'existing')
  assert.equal(options.probe, false)
})

test('rejects a duplicated group name', () => {
  assert.throws(() => resolveOptions(baseConfig({ skillGroups: ['core', 'core'] })), /more than once/u)
})

test('normalizes a githubProxy prefix and rejects one it cannot use', () => {
  assert.equal(resolveOptions(baseConfig()).githubProxy, undefined)
  assert.equal(
    resolveOptions(baseConfig({ githubProxy: ' https://gh-proxy.com/ ' })).githubProxy,
    'https://gh-proxy.com',
  )
  // A configured prefix is a statement the plugin can check, so a broken one
  // must fail activation instead of quietly downloading direct.
  for (const broken of ['http://gh-proxy.com', 'ftp://mirror.example', 'https://user:pw@mirror.example', 'https://mirror.example/?a=1']) {
    assert.throws(() => resolveOptions(baseConfig({ githubProxy: broken })), /githubProxy must be one or more HTTPS prefixes/u)
  }
})

test('accepts several GitHub prefixes and keeps them in order', () => {
  const options = resolveOptions(baseConfig({ githubProxy: 'https://gh-proxy.com, https://ghfast.top/' }))
  assert.equal(options.githubProxy, 'https://gh-proxy.com')
  assert.deepEqual(options.githubProxies, ['https://gh-proxy.com', 'https://ghfast.top'])
})

test('names the agent MATLAB displays, and rejects a name that could break the greeting', () => {
  assert.equal(resolveOptions(baseConfig()).agentName, 'DeepSeek')
  assert.equal(resolveOptions(baseConfig({ agentName: '  DeepSeek Harness  ' })).agentName, 'DeepSeek Harness')
  assert.equal(resolveOptions(baseConfig({ agentName: '' })).agentName, 'DeepSeek')
  assert.throws(() => resolveOptions(baseConfig({ agentName: 'two\nlines' })), /single line of at most 80 characters/u)
  assert.throws(() => resolveOptions(baseConfig({ agentName: 'x'.repeat(81) })), /single line of at most 80 characters/u)
})

test('bounds a first-time transfer with a positive budget', () => {
  assert.equal(resolveOptions(baseConfig({ provisionTimeoutMs: undefined })).provisionTimeoutMs, 300_000)
  assert.equal(resolveOptions(baseConfig({ provisionTimeoutMs: 0 })).provisionTimeoutMs, 300_000)
  assert.equal(resolveOptions(baseConfig({ provisionTimeoutMs: 90_000 })).provisionTimeoutMs, 90_000)
})

test('keeps every default the schema supplies', () => {
  const options = resolveOptions(baseConfig())
  assert.equal(options.serverName, 'matlab')
  assert.equal(options.toolCallTimeoutMs, 600_000)
  assert.equal(options.displayMode, 'desktop')
  assert.equal(options.sessionMode, 'auto')
  assert.equal(options.autoProvision, true)
  assert.equal(options.watchSkills, true)
  assert.equal(options.probeTimeoutMs, 20_000)
})
