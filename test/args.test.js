import test from 'node:test'
import assert from 'node:assert/strict'

import { buildMcpServerArgs, serverEnvironment } from '../lib/args.js'

test('passes the installation root and desktop mode in a fresh session', () => {
  const { args, warnings } = buildMcpServerArgs({
    matlabRoot: 'C:\\Program Files\\MATLAB\\R2025b',
    sessionMode: 'auto',
    displayMode: 'desktop',
    initialWorkingFolder: 'C:\\work',
  })
  assert.deepEqual(args, [
    '--matlab-session-mode=auto',
    '--matlab-root=C:\\Program Files\\MATLAB\\R2025b',
    '--matlab-display-mode=desktop',
    '--initial-working-folder=C:\\work',
  ])
  assert.deepEqual(warnings, [])
})

test('omits the target flags the shared-session mode rejects', () => {
  const { args, warnings } = buildMcpServerArgs({
    matlabRoot: '/opt/MATLAB/R2025b',
    sessionMode: 'existing',
    displayMode: 'nodesktop',
    initialWorkingFolder: '/work',
  })
  assert.deepEqual(args, ['--matlab-session-mode=existing'])
  assert.equal(warnings.length, 3)
  assert.match(warnings[0], /matlabRoot/u)
  assert.match(warnings[1], /initialWorkingFolder/u)
  assert.match(warnings[2], /displayMode/u)
})

test('keeps desktop mode omitted from warnings, which are about losing an explicit choice', () => {
  const { warnings } = buildMcpServerArgs({ sessionMode: 'existing', displayMode: 'desktop' })
  assert.deepEqual(warnings, [])
})

test('repeats --extension-file once per file', () => {
  const { args } = buildMcpServerArgs({
    sessionMode: 'new',
    extensionFiles: ['/a/tools.json', '/b/more.json'],
  })
  assert.deepEqual(args.filter(arg => arg.startsWith('--extension-file')), [
    '--extension-file=/a/tools.json',
    '--extension-file=/b/more.json',
  ])
})

test('adds opt-in flags only when enabled', () => {
  const plain = buildMcpServerArgs({ sessionMode: 'auto' })
  assert.deepEqual(plain.args, ['--matlab-session-mode=auto', '--matlab-display-mode=desktop'])

  const opted = buildMcpServerArgs({
    sessionMode: 'auto',
    initializeMatlabOnStartup: true,
    disableTelemetry: true,
    logFolder: '/logs',
    logLevel: 'warn',
  })
  assert.deepEqual(opted.args.slice(2), [
    '--initialize-matlab-on-startup=true',
    '--disable-telemetry=true',
    '--log-folder=/logs',
    '--log-level=warn',
  ])
})

test('re-declares WINDIR only where MATLAB needs it', () => {
  assert.deepEqual(serverEnvironment('win32', { WINDIR: 'C:\\Windows' }), { WINDIR: 'C:\\Windows' })
  assert.deepEqual(serverEnvironment('linux', { WINDIR: 'C:\\Windows' }), {})
  assert.deepEqual(serverEnvironment('win32', {}), {})
})
