/**
 * Version checks for the two artifacts this plugin owns.
 *
 * The plugin now treats `$DSH_HOME/matlab` as the only place its dependencies
 * live, so "is there a newer one?" has to be answerable without downloading
 * 19.9 MB. Two cheap probes do it, both over the same acceleration routes the
 * install uses:
 *
 * - the MCP Server's newest release tag, from GitHub's `releases/latest` (and,
 *   for a mirror that refuses the API host, from `git ls-remote --tags` on the
 *   repository — the same git route a clone already proves);
 * - the toolkit's newest commit, from `git ls-remote <repo> HEAD`, compared with
 *   the checkout's own `HEAD`.
 *
 * @module dsh-plugin-matlab/updates
 */

import { routeLabel, throughProxy } from './github.js'
import { runCommand } from './run.js'

/** Repository the MATLAB MCP Server releases from. */
export const MCP_SERVER_REPO = 'https://github.com/matlab/matlab-mcp-server.git'

/** `owner/name` of the same repository, for the GitHub API. */
const MCP_SERVER_SLUG = 'matlab/matlab-mcp-server'

/** One git advertisement is small; this bounds a route that never answers. */
const PROBE_TIMEOUT_MS = 20_000

/**
 * Read a `major.minor.patch` triple out of any string that carries one.
 *
 * Release tags (`v0.16.0`), GitHub's `tag_name`, and the server's own
 * `--version` line (`github.com/matlab/matlab-mcp-server v0.16.0`) all reduce
 * to the same triple.
 * @param text - version text.
 * @returns the triple, or `undefined` when the text carries no version.
 */
export function parseVersion(text) {
  if (text === undefined || text === null) return undefined
  const match = /(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/u.exec(String(text))
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Render a triple the way MathWorks tags releases.
 * @param version - `[major, minor, patch]`.
 * @returns `v<major>.<minor>.<patch>`.
 */
export function formatVersion(version) {
  return `v${version.join('.')}`
}

/**
 * Compare two triples.
 * @param left - `[major, minor, patch]`.
 * @param right - `[major, minor, patch]`.
 * @returns `1` when left is newer, `-1` when older, `0` when equal.
 */
export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta > 0 ? 1 : -1
  }
  return 0
}

/**
 * Whether a published version is newer than an installed one.
 * @param latest - published version text or triple.
 * @param current - installed version text or triple; `undefined` means not installed.
 * @returns true when an update exists.
 */
export function isNewer(latest, current) {
  const next = Array.isArray(latest) ? latest : parseVersion(latest)
  const installed = Array.isArray(current) ? current : parseVersion(current)
  if (next === undefined) return false
  if (installed === undefined) return true
  return compareVersions(next, installed) > 0
}

/**
 * Pick the newest release tag out of `git ls-remote --tags` output.
 * @param text - `git ls-remote` stdout.
 * @returns the newest `{ tag, version }`, or `undefined` when there is no version tag.
 */
export function versionFromLsRemote(text) {
  let best
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const match = /^[0-9a-f]{40}\s+refs\/tags\/(v?\d+\.\d+\.\d+)(?:\^\{\})?\s*$/u.exec(line)
    if (match === null) continue
    const version = parseVersion(match[1])
    if (version === undefined) continue
    if (best === undefined || compareVersions(version, best.value) > 0) {
      best = { tag: match[1].startsWith('v') ? match[1] : `v${match[1]}`, version: formatVersion(version), value: version }
    }
  }
  if (best === undefined) return undefined
  return { tag: best.tag, version: best.version }
}

/**
 * Ask GitHub which MATLAB MCP Server release is newest.
 *
 * `releases/latest` is what `releases/latest/download/...` resolves to, so the
 * answer matches the asset an install would fetch. A mirror that refuses
 * `api.github.com` falls back to the repository's tags over git.
 * @param options - acceleration routes and seams.
 * @param options.routes - routes from {@link module:dsh-plugin-matlab/github}.
 * @param options.fetchImpl - fetch implementation; defaults to the global one.
 * @param options.run - command runner; defaults to the real one.
 * @param options.timeoutMs - budget for one probe.
 * @param options.log - diagnostic sink.
 * @returns the newest tag, its version, and the route that answered.
 */
export async function latestServerRelease(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const run = options.run ?? runCommand
  const log = options.log ?? (() => {})
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const failures = []
  for (const route of options.routes ?? [null]) {
    try {
      const response = await fetchImpl(throughProxy(route, `https://api.github.com/repos/${MCP_SERVER_SLUG}/releases/latest`), {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugin-matlab' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const body = await response.json()
      const version = parseVersion(body?.tag_name)
      if (version === undefined) throw new Error('the release carries no version tag')
      return { tag: String(body.tag_name), version: formatVersion(version), route }
    } catch (cause) {
      failures.push(`api via ${routeLabel(route)}: ${messageOf(cause)}`)
    }
    try {
      const result = await run('git', ['ls-remote', '--tags', throughProxy(route, MCP_SERVER_REPO)], { allowFailure: true, timeoutMs })
      if (result.code !== 0) throw new Error(firstLine(result.stderr) ?? `git exited with ${String(result.code)}`)
      const newest = versionFromLsRemote(result.stdout)
      if (newest === undefined) throw new Error('the repository publishes no version tags')
      return { ...newest, route }
    } catch (cause) {
      failures.push(`tags via ${routeLabel(route)}: ${messageOf(cause)}`)
    }
  }
  log({ level: 'warn', message: `could not read the newest MATLAB MCP Server release (${failures.join('; ')})` })
  throw new Error(`could not read the newest MATLAB MCP Server release: ${failures.join('; ')}`)
}

/**
 * Ask the repository which commit the toolkit's default branch points at.
 * @param options - repository, routes, and seams.
 * @param options.repo - git URL of the toolkit.
 * @param options.routes - acceleration routes.
 * @param options.run - command runner; defaults to the real one.
 * @param options.timeoutMs - budget for one route.
 * @returns the newest commit sha and the route that answered.
 */
export async function latestToolkitHead(options = {}) {
  const run = options.run ?? runCommand
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const failures = []
  for (const route of options.routes ?? [null]) {
    try {
      const result = await run('git', ['ls-remote', throughProxy(route, options.repo), 'HEAD'], { allowFailure: true, timeoutMs })
      if (result.code !== 0) throw new Error(firstLine(result.stderr) ?? `git exited with ${String(result.code)}`)
      const sha = /^([0-9a-f]{40})\s+HEAD\s*$/mu.exec(result.stdout)?.[1]
      if (sha === undefined) throw new Error('the repository advertised no HEAD')
      return { sha, route }
    } catch (cause) {
      failures.push(`via ${routeLabel(route)}: ${messageOf(cause)}`)
    }
  }
  throw new Error(`could not read the toolkit's newest commit: ${failures.join('; ')}`)
}

/**
 * Read the commit a checkout is on.
 * @param options - checkout root and runner.
 * @param options.root - toolkit checkout.
 * @param options.run - command runner; defaults to the real one.
 * @returns the commit sha, or `undefined` when the folder is not a git checkout.
 */
export async function localToolkitHead(options = {}) {
  const run = options.run ?? runCommand
  const result = await run('git', ['-C', options.root, 'rev-parse', 'HEAD'], { allowFailure: true, timeoutMs: 10_000 })
  if (result.code !== 0) return undefined
  return /^([0-9a-f]{40})/mu.exec(result.stdout)?.[1]
}



function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

function firstLine(text) {
  const line = String(text ?? '').split(/\r?\n/u).map(entry => entry.trim()).find(entry => entry.length > 0)
  return line
}
