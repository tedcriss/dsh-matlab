import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register('../test-support/schemastery-hook.mjs', import.meta.url)

// Real Cordis is an optional development dependency; without it this file has
// nothing to prove and skips rather than failing a checkout that has no install.
let Context
try {
  ({ Context } = await import('@deepseek-ai/cordis'))
} catch {
  Context = undefined
}
const skip = Context === undefined
  ? 'run `pnpm add -D @deepseek-ai/cordis` to enable the activation-contract test'
  : false

const plugin = await import('../lib/index.js')

/**
 * A toolkit, a stand-in binary, and transports that never touch MATLAB.
 * Everything else — the entry point, the schema, and Cordis — is production code.
 */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-cordis-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'dsh-home')
  t.after(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })
  const toolkit = join(dir, 'toolkit')
  await mkdir(join(toolkit, 'skills-catalog', 'core', 'core-skill'), { recursive: true })
  await writeFile(
    join(toolkit, 'skills-catalog', 'core', 'core-skill', 'SKILL.md'),
    '---\nname: core-skill\ndescription: A skill\n---\n',
  )
  await writeFile(
    join(toolkit, 'manifest.yaml'),
    'display-name: "Example"\nskill-groups:\n  - name: core\n    path: skills-catalog/core\n    required: true\n',
  )
  const binary = join(dir, 'matlab-mcp-server.exe')
  await writeFile(binary, 'stub')
  const mounts = []
  const overrides = {
    discoverMatlabRoot: async () => ({ root: '/fake/MATLAB', source: 'config', exists: true }),
    ensureMcpServer: async () => ({ path: binary, source: 'config', downloaded: false }),
    serverVersion: async () => 'v1',
    probeMcpServer: async () => ({ ok: true, tools: [], resources: [] }),
    countSkills: async () => 1,
    loadSkillProvider: async () => ({
      name: 'fake-skill-provider',
      apply: (_ctx, config) => { mounts.push(['skills', config]) },
    }),
    loadMcpClient: async () => ({
      name: 'fake-mcp-client',
      apply: async (_ctx, config) => { mounts.push(['tools', config]) },
    }),
  }
  const config = {
    serverName: 'matlab',
    toolCallTimeoutMs: 600_000,
    failOnStartupError: true,
    matlabRoot: '',
    displayMode: 'desktop',
    sessionMode: 'auto',
    initialWorkingFolder: '',
    initializeMatlabOnStartup: false,
    disableTelemetry: false,
    mcpServerPath: binary,
    autoProvision: false,
    toolkitRoots: [toolkit],
    skillGroups: [],
    extensionFiles: [],
    watchSkills: false,
    probe: true,
    probeTimeoutMs: 1_000,
    statusRoute: true,
  }
  return { mounts, overrides, config }
}

/** The plugin with only its transports replaced; the entry point stays the published one. */
function wired(overrides) {
  return {
    name: plugin.name,
    inject: plugin.inject,
    Config: plugin.Config,
    apply: (ctx, config) => plugin.apply(ctx, config, overrides),
  }
}

/** A root context carrying the two services the plugin looks up. */
function host() {
  const ctx = new Context()
  ctx.provide('skills', {})
  ctx.provide('webServer', { register: () => () => {} })
  return ctx
}

test('activates under real Cordis fiber rules', { skip }, async t => {
  const { mounts, overrides, config } = await fixture(t)
  const ctx = host()
  const fiber = ctx.plugin(wired(overrides), config)
  // Rejects with `TypeError: Invalid effect` when activation resolves to a value.
  await fiber
  assert.equal(mounts.length, 2)
  assert.equal(mounts[0][0], 'skills')
  assert.equal(mounts[0][1].providerName, 'matlab')
  assert.equal(mounts[1][0], 'tools')
  assert.equal(mounts[1][1].serverName, 'matlab')
})

test('the harness reproduces the reported failure for a value-returning activation', { skip }, async () => {
  const ctx = host()
  const fiber = ctx.plugin({
    name: 'returns-a-value',
    apply: async () => ({ phase: 'ready' }),
  })
  // `assert.rejects` needs a real Promise; a Fiber is only thenable.
  await assert.rejects(async () => { await fiber }, /Invalid effect/u)
})

test('disposing the entry unmounts both transports', { skip }, async t => {
  const { mounts, overrides, config } = await fixture(t)
  const ctx = host()
  let disposed = 0
  const tracked = {
    ...overrides,
    loadSkillProvider: async () => ({
      name: 'fake-skill-provider',
      apply: inner => {
        mounts.push(['skills', {}])
        inner.effect(() => () => { disposed += 1 })
      },
    }),
    loadMcpClient: async () => ({
      name: 'fake-mcp-client',
      apply: async inner => {
        mounts.push(['tools', {}])
        inner.effect(() => () => { disposed += 1 })
      },
    }),
  }
  const fiber = ctx.plugin(wired(tracked), config)
  await fiber
  fiber.dispose()
  await fiber
  assert.equal(disposed, 2)
})
