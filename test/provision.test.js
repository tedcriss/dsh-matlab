import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cloneToolkit, proxyFromEnvironment, TOOLKIT_REPOS } from '../lib/provision.js'

/** The URL a clone invocation is pointed at, and its destination. */
function cloneTarget(args) {
  return { url: args[args.length - 2], destination: args[args.length - 1] }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function makeDataRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-clone-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('clones through the accelerated routes before going direct', async t => {
  const dataRoot = await makeDataRoot(t)
  const calls = []
  const run = async (_command, args) => {
    const { url } = cloneTarget(args)
    calls.push(url)
    if (url.startsWith('https://gh-proxy.com/')) throw new Error('proxy answered 502')
    await mkdir(join(cloneTarget(args).destination, 'skills-catalog'), { recursive: true })
  }

  const cloned = await cloneToolkit({
    kind: 'matlab',
    dataRoot,
    routes: ['https://gh-proxy.com', null],
    run,
    log: () => {},
  })

  assert.deepEqual(calls, [
    `https://gh-proxy.com/${TOOLKIT_REPOS.matlab}`,
    TOOLKIT_REPOS.matlab,
  ])
  assert.equal(cloned.route, null)
  assert.equal(cloned.root, join(dataRoot, 'toolkits', 'matlab-agentic-toolkit'))
  assert.equal(await exists(cloned.root), true)
})

test('gives the clone a shallow, prompt-free, stall-bounded transfer', async t => {
  const dataRoot = await makeDataRoot(t)
  let seen
  const run = async (command, args, options) => {
    seen = { command, args, options }
  }

  await cloneToolkit({
    kind: 'simulink',
    dataRoot,
    routes: [null],
    proxy: 'http://proxy.internal:8080',
    timeoutMs: 60_000,
    run,
    log: () => {},
  })

  assert.equal(seen.command, 'git')
  // The proxy is translated for git, and a dead route is abandoned by git's own
  // low-speed rule instead of holding the startup open.
  assert.ok(seen.args.includes('http.proxy=http://proxy.internal:8080'))
  assert.ok(seen.args.includes('https.proxy=http://proxy.internal:8080'))
  assert.ok(seen.args.includes('http.lowSpeedLimit=1024'))
  assert.ok(seen.args.includes('http.lowSpeedTime=30'))
  assert.ok(seen.args.includes('--depth'))
  assert.ok(seen.args.includes('--single-branch'))
  assert.deepEqual(seen.args.slice(-3), [
    '--single-branch',
    TOOLKIT_REPOS.simulink,
    join(dataRoot, 'toolkits', 'simulink-agentic-toolkit'),
  ])
  assert.equal(seen.options.env.GIT_TERMINAL_PROMPT, '0')
  assert.ok(seen.options.timeoutMs > 0 && seen.options.timeoutMs <= 60_000)
})

test('clears a half-written checkout before the next route', async t => {
  const dataRoot = await makeDataRoot(t)
  const destination = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')
  const sawLeftover = []
  const run = async (_command, args) => {
    sawLeftover.push(await exists(destination))
    if (cloneTarget(args).url.startsWith('https://gh-proxy.com/')) {
      // git leaves a partial `.git` behind when the transfer dies.
      await mkdir(join(destination, '.git'), { recursive: true })
      throw new Error('early EOF')
    }
  }

  await cloneToolkit({ kind: 'matlab', dataRoot, routes: ['https://gh-proxy.com', null], run, log: () => {} })
  assert.deepEqual(sawLeftover, [false, false])
})

test('reports every route it tried when the clone cannot complete', async t => {
  const dataRoot = await makeDataRoot(t)
  await assert.rejects(
    () => cloneToolkit({
      kind: 'matlab',
      dataRoot,
      routes: ['https://gh-proxy.com', 'https://ghfast.top'],
      run: async () => {
        throw new Error('early EOF')
      },
      log: () => {},
    }),
    /could not clone https:\/\/github\.com\/matlab\/matlab-agentic-toolkit\.git: gh-proxy\.com: early EOF; ghfast\.top: early EOF/u,
  )
  assert.equal(await exists(join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')), false)
})

test('gives up when the budget is spent instead of trying every route', async t => {
  const dataRoot = await makeDataRoot(t)
  let contacted = 0
  await assert.rejects(
    () => cloneToolkit({
      kind: 'matlab',
      dataRoot,
      routes: ['https://gh-proxy.com', null],
      timeoutMs: 0,
      run: async () => {
        contacted += 1
      },
      log: () => {},
    }),
    /budget of 0 ms spent with 2 route\(s\) untried/u,
  )
  assert.equal(contacted, 0)
})

test('rejects an unknown toolkit kind before touching git', async t => {
  const dataRoot = await makeDataRoot(t)
  await assert.rejects(
    () => cloneToolkit({ kind: 'octave', dataRoot, run: async () => {}, log: () => {} }),
    /unknown toolkit kind octave/u,
  )
})

test('reads a proxy URL out of the environment, ignoring blank values', () => {
  assert.equal(proxyFromEnvironment({ HTTPS_PROXY: ' http://127.0.0.1:7890 ' }), 'http://127.0.0.1:7890')
  assert.equal(proxyFromEnvironment({ HTTP_PROXY: 'http://127.0.0.1:7890' }), 'http://127.0.0.1:7890')
  assert.equal(proxyFromEnvironment({ HTTPS_PROXY: '   ' }), undefined)
  assert.equal(proxyFromEnvironment({}), undefined)
})
