import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { PACKAGE_NAME, VERSION } from '../lib/version.js'
import { CLIENT_INFO } from '../lib/probe.js'

// The entry graph imports the schema module, which only the DSH runtime provides;
// the stub lets this test read the package's public exports.
register('../test-support/schemastery-hook.mjs', import.meta.url)
const plugin = await import('../lib/index.js')

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('package.json is the only place the plugin version is written', () => {
  assert.equal(VERSION, manifest.version)
  assert.equal(PACKAGE_NAME, manifest.name)
  assert.equal(plugin.VERSION, VERSION)
  assert.equal(plugin.PACKAGE_NAME, PACKAGE_NAME)
})

test('the MCP probe announces the identity the manifest declares', () => {
  assert.deepEqual({ ...CLIENT_INFO }, { name: manifest.name, version: manifest.version })
})

test('the manifest names the author', () => {
  assert.deepEqual(manifest.author, { name: '小涛29', email: 'xuyuntao@189.cn' })
})
