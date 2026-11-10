/**
 * Obtain a toolkit checkout when none is installed.
 *
 * A clone is a copy of MathWorks' published repository at its own `main`; the
 * plugin never rewrites, patches, or republishes the skill content. When `git`
 * is unavailable the plugin reports that instead of substituting a partial copy.
 *
 * The clone runs over the same acceleration routes as the binary download. DSH's
 * market puts the direct route first for git because it only reads ref
 * advertisements; `git clone` moves the repository body, so here the accelerated
 * routes lead and the direct one remains the escape hatch.
 *
 * @module dsh-plugin-matlab/provision
 */

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { routeLabel, throughProxy } from './github.js'
import { runCommand } from './run.js'

/** Git URLs of the toolkits this plugin can fetch, keyed by toolkit kind. */
export const TOOLKIT_REPOS = {
  matlab: 'https://github.com/matlab/matlab-agentic-toolkit.git',
  simulink: 'https://github.com/matlab/simulink-agentic-toolkit.git',
}

/** Default budget for one toolkit checkout across every route. */
const DEFAULT_TIMEOUT_MS = 300_000

/** Give up on a route below this transfer rate… */
const LOW_SPEED_BYTES_PER_SECOND = 1024

/** …for this many seconds, instead of waiting out the whole budget. */
const LOW_SPEED_SECONDS = 30

/**
 * Clone one toolkit into the plugin data folder.
 * @param options - kind, destination root, routes, proxy, and diagnostic seams.
 * @param options.kind - `matlab` or `simulink`.
 * @param options.dataRoot - folder receiving `<kind>-agentic-toolkit`.
 * @param options.routes - acceleration routes, direct last; defaults to direct only.
 * @param options.proxy - proxy URL for git, when the environment defines one.
 * @param options.timeoutMs - budget for the whole clone across every route.
 * @param options.run - command runner.
 * @param options.log - diagnostic sink.
 * @returns the checkout root and the route that served it.
 */
export async function cloneToolkit(options) {
  const repo = TOOLKIT_REPOS[options.kind]
  if (repo === undefined) throw new Error(`matlab-agentic: unknown toolkit kind ${String(options.kind)}`)
  const run = options.run ?? runCommand
  const log = options.log ?? (() => {})
  const parent = join(options.dataRoot, 'toolkits')
  const destination = join(parent, `${options.kind}-agentic-toolkit`)
  await mkdir(parent, { recursive: true })
  const routes = options.routes ?? [null]
  const budgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + budgetMs
  const failures = []
  for (const [index, route] of routes.entries()) {
    if (Date.now() >= deadline) {
      failures.push(`budget of ${String(budgetMs)} ms spent with ${String(routes.length - index)} route(s) untried`)
      break
    }
    // A failed attempt leaves a half-written `.git` that git refuses to clone into.
    await rm(destination, { recursive: true, force: true })
    const url = throughProxy(route, repo)
    const args = gitArguments(options.proxy)
    args.push('clone', '--depth', '1', '--single-branch', url, destination)
    log({ level: 'info', message: `cloning ${url}` })
    try {
      await run('git', args, {
        timeoutMs: Math.max(1, deadline - Date.now()),
        // A missing credential prompt must fail the route, not wait forever.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      log({ level: 'info', message: `cloned ${repo} via ${routeLabel(route)}` })
      return { root: destination, route }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      failures.push(`${routeLabel(route)}: ${message}`)
      log({ level: 'warn', message: `${routeLabel(route)} route failed: ${message}` })
    }
  }
  await rm(destination, { recursive: true, force: true })
  throw new Error(
    `matlab-agentic: could not clone ${repo}: ${failures.join('; ')}. `
    + 'Install the toolkit with setupAgenticToolkit("install") or set toolkitRoots, '
    + 'or set githubProxy (or DSHM_GITHUB_PROXY) to an HTTPS acceleration prefix.',
  )
}

/**
 * Git options for one clone attempt.
 * @param proxy - HTTP(S) proxy URL from the environment, when defined.
 * @returns config and command arguments, ending before `clone`.
 */
function gitArguments(proxy) {
  const args = []
  // A git subprocess does not inherit DSH's fetch proxy policy, so translate it to git config.
  if (typeof proxy === 'string' && proxy.length > 0) {
    args.push('-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`)
  }
  // git aborts its own transfer when throughput collapses, which ends a dead
  // route in seconds instead of at the attempt budget.
  args.push(
    '-c', `http.lowSpeedLimit=${String(LOW_SPEED_BYTES_PER_SECOND)}`,
    '-c', `http.lowSpeedTime=${String(LOW_SPEED_SECONDS)}`,
  )
  return args
}

/**
 * Read the proxy URL DSH's launcher resolved from the environment, if any.
 * @param env - environment map.
 * @returns a proxy URL for git, or `undefined`.
 */
export function proxyFromEnvironment(env = process.env) {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const value = env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}
