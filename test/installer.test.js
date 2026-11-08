import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installerMatlabRoot, installerServerVersion, readInstallerConfig } from '../lib/installer.js'
import { discoverMatlabRoot } from '../lib/matlab-root.js'

const INSTALLER_CONFIG = {
  mcpToolboxPath: 'C:\\Users\\u\\AppData\\Roaming\\MathWorks\\MATLAB Add-Ons\\Toolboxes\\MATLAB MCP Server Toolbox',
  toolkits: { matlab: { version: '2026.11.a', source: 'release' } },
  matlab: { root: 'C:\\Program Files\\MATLAB\\R2023b', version: 'R2023b' },
  mcpServerVersion: '0.16.0',
  sessionMode: 'auto',
  configurations: { global: { claude_code: { toolkits: ['matlab'], skillGroups: { matlab: ['matlab-core'] } } } },
}

async function makeInstallRoot(t, contents) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-installer-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  if (contents !== undefined) await writeFile(join(dir, 'config.json'), contents)
  return dir
}

test('reads the MATLAB root and server version the installer recorded', async t => {
  const root = await makeInstallRoot(t, JSON.stringify(INSTALLER_CONFIG))
  const config = await readInstallerConfig(root)
  assert.equal(installerMatlabRoot(config), 'C:\\Program Files\\MATLAB\\R2023b')
  assert.equal(installerServerVersion(config), '0.16.0')
})

test('an absent or malformed install state is simply unknown', async t => {
  assert.equal(await readInstallerConfig(await makeInstallRoot(t)), undefined)
  assert.equal(await readInstallerConfig(await makeInstallRoot(t, '{not json')), undefined)
  assert.equal(installerMatlabRoot(undefined), undefined)
  assert.equal(installerServerVersion({ mcpServerVersion: '' }), undefined)
})

test('the installer root outranks PATH but not an explicit setting', async t => {
  const root = await makeInstallRoot(t, JSON.stringify(INSTALLER_CONFIG))
  const config = await readInstallerConfig(root)
  const installerRoot = installerMatlabRoot(config)

  const fromInstaller = await discoverMatlabRoot({
    env: {},
    platform: 'win32',
    installerRoot,
    isDirectory: async path => path === installerRoot,
    run: async () => ({ code: 0, stdout: 'C:\\MATLAB\\R2020a\\bin\\matlab.exe\n', stderr: '' }),
  })
  assert.deepEqual(fromInstaller, { root: installerRoot, source: 'matlab-installer' })

  const explicit = await discoverMatlabRoot({
    env: {},
    platform: 'win32',
    explicit: 'C:\\MATLAB\\R2025a',
    installerRoot,
    isDirectory: async () => true,
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
  })
  assert.deepEqual(explicit, { root: 'C:\\MATLAB\\R2025a', source: 'config', exists: true })
})

test('an installer root that no longer exists falls through to discovery', async t => {
  const root = await makeInstallRoot(t, JSON.stringify(INSTALLER_CONFIG))
  const installerRoot = installerMatlabRoot(await readInstallerConfig(root))
  const found = await discoverMatlabRoot({
    env: {},
    platform: 'win32',
    installerRoot,
    isDirectory: async () => false,
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
    readdir: async () => [],
  })
  assert.equal(found, undefined)
})
