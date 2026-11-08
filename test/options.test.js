import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveOptions } from '../lib/options.js'

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
    autoProvision: true,
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

test('treats an empty string as "discover it", not as a value', () => {
  const options = resolveOptions(baseConfig())
  assert.equal(options.matlabRoot, undefined)
  assert.equal(options.mcpServerPath, undefined)
  assert.equal(options.initialWorkingFolder, undefined)
  assert.equal(options.installRoot, undefined)
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
