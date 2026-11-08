/**
 * Obtain a toolkit checkout when none is installed.
 *
 * A clone is a copy of MathWorks' published repository at its own `main`; the
 * plugin never rewrites, patches, or republishes the skill content. When `git`
 * is unavailable the plugin reports that instead of substituting a partial copy.
 *
 * @module dsh-plugin-matlab/provision
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './run.js'

/** Git URLs of the toolkits this plugin can fetch, keyed by toolkit kind. */
export const TOOLKIT_REPOS = {
  matlab: 'https://github.com/matlab/matlab-agentic-toolkit.git',
  simulink: 'https://github.com/matlab/simulink-agentic-toolkit.git',
}

/**
 * Clone one toolkit into the plugin data folder.
 * @param options - kind, destination root, proxy, and diagnostic seams.
 * @param options.kind - `matlab` or `simulink`.
 * @param options.dataRoot - folder receiving `<kind>-agentic-toolkit`.
 * @param options.proxy - proxy URL for git, when the environment defines one.
 * @param options.run - command runner.
 * @param options.log - diagnostic sink.
 * @returns the checkout root.
 */
export async function cloneToolkit(options) {
  const repo = TOOLKIT_REPOS[options.kind]
  if (repo === undefined) throw new Error(`matlab-agentic: unknown toolkit kind ${String(options.kind)}`)
  const run = options.run ?? runCommand
  const log = options.log ?? (() => {})
  const parent = join(options.dataRoot, 'toolkits')
  const destination = join(parent, `${options.kind}-agentic-toolkit`)
  await mkdir(parent, { recursive: true })
  const args = []
  // A git subprocess does not inherit DSH's fetch proxy policy, so translate it to git config.
  if (typeof options.proxy === 'string' && options.proxy.length > 0) {
    args.push('-c', `http.proxy=${options.proxy}`, '-c', `https.proxy=${options.proxy}`)
  }
  args.push('clone', '--depth', '1', '--single-branch', repo, destination)
  log({ level: 'info', message: `cloning ${repo}` })
  try {
    await run('git', args, { timeoutMs: options.timeoutMs ?? 300_000 })
  } catch (cause) {
    throw new Error(
      `matlab-agentic: could not clone ${repo}: ${cause instanceof Error ? cause.message : String(cause)}. `
      + 'Install the toolkit with setupAgenticToolkit("install") or set toolkitRoots.',
    )
  }
  return { root: destination }
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
