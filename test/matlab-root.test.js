import test from 'node:test'
import assert from 'node:assert/strict'

import { discoverMatlabRoot, releaseRank, windowsRegistryRoots } from '../lib/matlab-root.js'

const present = async path => path === '/opt/MATLAB/R2025b'

test('ranks releases newest first, tolerant of the registry spelling', () => {
  assert.ok(releaseRank('R2025b') > releaseRank('R2025a'))
  assert.ok(releaseRank('R2025a') > releaseRank('R2024b'))
  assert.equal(releaseRank('25.1'), releaseRank('R2025a'))
  assert.equal(releaseRank('25.2'), releaseRank('R2025b'))
  assert.equal(releaseRank('bin'), -1)
})

test('prefers the configured root and reports whether it exists', async () => {
  const found = await discoverMatlabRoot({ explicit: '/opt/MATLAB/R2025b', isDirectory: present })
  assert.deepEqual(found, { root: '/opt/MATLAB/R2025b', source: 'config', exists: true })

  const missing = await discoverMatlabRoot({ explicit: '/nowhere', isDirectory: async () => false })
  assert.equal(missing.exists, false)
})

test('reads the environment before any discovery', async () => {
  const found = await discoverMatlabRoot({
    env: { MW_MCP_SERVER_MATLAB_ROOT: '/opt/MATLAB/R2025b' },
    platform: 'linux',
    isDirectory: present,
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
  })
  assert.deepEqual(found, { root: '/opt/MATLAB/R2025b', source: 'env:MW_MCP_SERVER_MATLAB_ROOT' })
})

test('resolves the installation above bin from PATH', async () => {
  const found = await discoverMatlabRoot({
    env: {},
    platform: 'linux',
    isDirectory: async () => true,
    run: async command => {
      assert.equal(command, 'which')
      return { code: 0, stdout: '/usr/local/MATLAB/R2025b/bin/matlab\n', stderr: '' }
    },
  })
  assert.deepEqual(found, { root: '/usr/local/MATLAB/R2025b', source: 'PATH' })
})

test('parses MATLABROOT values out of reg query output', async () => {
  const output = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\MathWorks\\MATLAB\\25.1',
    '    MATLABROOT    REG_SZ    C:\\Program Files\\MATLAB\\R2025a',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\MathWorks\\MATLAB\\25.2',
    '    MATLABROOT    REG_SZ    C:\\Program Files\\MATLAB\\R2025b',
  ].join('\r\n')
  const roots = await windowsRegistryRoots(async () => ({ code: 0, stdout: output, stderr: '' }))
  assert.deepEqual(roots.map(entry => entry.root).sort(), [
    'C:\\Program Files\\MATLAB\\R2025a',
    'C:\\Program Files\\MATLAB\\R2025b',
  ])
})

test('falls back to the platform installer folder', async () => {
  const found = await discoverMatlabRoot({
    env: {},
    platform: 'linux',
    isDirectory: async path => path === '/opt/MATLAB/R2025b',
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
    readdir: async directory => {
      assert.equal(directory, '/opt/MATLAB')
      return [
        { name: 'R2024b', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'R2025b', isDirectory: () => true, isSymbolicLink: () => false },
      ]
    },
  })
  assert.equal(found.source, 'installer')
  assert.equal(found.root, '/opt/MATLAB/R2025b')
})

test('reports nothing when no installation exists', async () => {
  const found = await discoverMatlabRoot({
    env: {},
    platform: 'linux',
    isDirectory: async () => false,
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
  })
  assert.equal(found, undefined)
})
