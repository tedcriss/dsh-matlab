/**
 * Version checks for the two artifacts this plugin owns.
 *
 * The plugin treats `$DSH_HOME/matlab` as the only place its dependencies live,
 * so "is there a newer one?" has to be answerable without downloading 20 MB.
 * Two cheap probes do it, both over the same acceleration routes an install
 * uses:
 *
 * - GitHub's `releases/latest` API, the smallest answer when a route serves it;
 * - the release page itself, when a route refuses or rate-limits the API host.
 *   The newest tag is in that page's `og:url` (and its title), so the probe
 *   reads one attribute rather than scraping a release list.
 *
 * Both artifacts are release-based: the MCP Server publishes binaries as release
 * assets, and the toolkits publish their skill catalogs as the source archive of
 * their release tag. So one probe answers for both, and no `git` is involved.
 *
 * @module dsh-matlab/updates
 */

import { parseAssetDigest } from './integrity.js'
import { routeLabel, throughProxy } from './github.js'

/** `owner/name` of the MATLAB MCP Server repository, for the GitHub API. */
export const MCP_SERVER_SLUG = 'matlab/matlab-mcp-server'

/** One probe is small; this bounds a route that never answers. */
const PROBE_TIMEOUT_MS = 20_000

/** A release page is a few hundred kilobytes; this bounds what is read from one. */
const MAX_PAGE_CHARS = 2_000_000

/** Matches a release tag inside a URL or a page attribute. */
const TAG_PATH = /\/releases\/tag\/([^/?#"'\s<>]+)/u

/**
 * Read a `major.minor.patch` triple out of any string that carries one.
 *
 * Release tags (`v0.16.0`), GitHub's `tag_name`, and the server's own
 * `--version` line (`github.com/matlab/matlab-mcp-server v0.16.0`) all reduce
 * to the same triple. The toolkits tag their releases by month
 * (`MATK-2026.11.a`) instead, so they are compared by tag identity.
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
 * Read the release tag a page or URL names.
 *
 * GitHub's release page carries the canonical tag in `og:url`; the direct route
 * also lands on `/releases/tag/<tag>` after its redirect. Both spellings come
 * back through one parser so a mirror that follows the redirect server-side and
 * one that does not behave the same.
 * @param text - page HTML, or a final response URL.
 * @returns the decoded tag, or `undefined` when nothing names one.
 */
export function releaseTagFromText(text) {
  const value = String(text ?? '')
  const candidates = []
  const ogFirst = /(?:property|name)=["']og:url["'][^>]*content=["']([^"']+)["']/u.exec(value)
  if (ogFirst !== null) candidates.push(ogFirst[1])
  const ogLast = /content=["']([^"']+)["'][^>]*(?:property|name)=["']og:url["']/u.exec(value)
  if (ogLast !== null) candidates.push(ogLast[1])
  const title = /<title>\s*Release\s+([^<·]+?)\s*(?:·|<\/title>)/u.exec(value)
  if (title !== null) {
    try {
      candidates.push(`/releases/tag/${encodeURIComponent(title[1].trim())}`)
    } catch {
      // An unencodable title simply yields no candidate.
    }
  }
  candidates.push(value)
  for (const candidate of candidates) {
    const match = TAG_PATH.exec(candidate)
    if (match === null) continue
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return undefined
}

/** Turn an unknown thrown value into a message. */
function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Ask GitHub which release of a repository is newest.
 *
 * Routes are tried in the order the caller resolved: the API first, then the
 * release page, then the next route. Nothing is downloaded beyond one page, and
 * a mirror that serves neither spelling fails its route instead of the whole
 * check.
 * @param options - repository slug, routes, and seams.
 * @param options.slug - `owner/name` on github.com.
 * @param options.label - what the artifact is called in errors.
 * @param options.routes - routes from {@link module:dsh-matlab/github}.
 * @param options.fetchImpl - fetch implementation; defaults to the global one.
 * @param options.timeoutMs - budget for one request.
 * @param options.log - diagnostic sink.
 * @returns the newest tag, the route that answered, and how it answered.
 */
export async function latestRelease(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const log = options.log ?? (() => {})
  const slug = options.slug
  const label = options.label ?? slug
  const failures = []
  for (const route of options.routes ?? [null]) {
    try {
      const response = await fetchImpl(throughProxy(route, `https://api.github.com/repos/${slug}/releases/latest`), {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-matlab' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const body = await response.json()
      const tag = typeof body?.tag_name === 'string' && body.tag_name.trim() !== '' ? body.tag_name.trim() : undefined
      if (tag === undefined) throw new Error('the release carries no tag')
      return { tag, route, source: 'api' }
    } catch (cause) {
      failures.push(`api via ${routeLabel(route)}: ${messageOf(cause)}`)
    }
    try {
      // A shared public route can be rate-limited on the API host by people
      // other than this user, so the page itself is the fallback rather than a
      // failure: it states the same tag and is served from github.com.
      const response = await fetchImpl(throughProxy(route, `https://github.com/${slug}/releases/latest`), {
        headers: { accept: 'text/html', 'user-agent': 'dsh-matlab' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const tag = releaseTagFromText(String(response.url ?? '')) ?? releaseTagFromText((await response.text()).slice(0, MAX_PAGE_CHARS))
      if (tag === undefined) throw new Error('the release page names no tag')
      return { tag, route, source: 'page' }
    } catch (cause) {
      failures.push(`page via ${routeLabel(route)}: ${messageOf(cause)}`)
    }
  }
  const message = `could not read the newest ${label} release: ${failures.join('; ')}`
  log({ level: 'warn', message })
  throw new Error(message)
}

/**
 * Ask GitHub which MATLAB MCP Server release is newest.
 *
 * `releases/latest` is what `releases/latest/download/...` resolves to, so the
 * answer matches the asset an install would fetch.
 * @param options - acceleration routes and seams.
 * @param options.routes - routes from {@link module:dsh-matlab/github}.
 * @param options.fetchImpl - fetch implementation; defaults to the global one.
 * @param options.timeoutMs - budget for one probe.
 * @param options.log - diagnostic sink.
 * @returns the newest tag, its version, and the route that answered.
 */
export async function latestServerRelease(options = {}) {
  const release = await latestRelease({ ...options, slug: MCP_SERVER_SLUG, label: 'MATLAB MCP Server' })
  const version = parseVersion(release.tag)
  if (version === undefined) throw new Error(`could not read the newest MATLAB MCP Server release: the tag "${release.tag}" carries no version`)
  return { tag: release.tag, version: formatVersion(version), route: release.route, source: release.source }
}

/**
 * Read one release's assets and their published SHA-256 digests.
 *
 * This is the release metadata an install verifies against, so the direct
 * `api.github.com` route is tried first: a mirror may serve the bytes, but it
 * must not also be the only source of the hash that vouches for them. When the
 * direct API cannot answer — mainland China often cannot reach it — the same
 * acceleration routes the download uses are tried, and the caller is told the
 * answer came through a mirror. A digest fetched that way is weaker than one
 * fetched directly, but it still catches a truncated or corrupted transfer.
 * @param options - repository slug, tag, and seams.
 * @param options.slug - `owner/name` on github.com.
 * @param options.tag - release tag; `undefined` or `latest` asks for the newest.
 * @param options.routes - acceleration routes from {@link module:dsh-matlab/github}.
 * @param options.fetchImpl - fetch implementation; defaults to the global one.
 * @param options.timeoutMs - budget for one route.
 * @param options.log - diagnostic sink.
 * @returns the resolved tag, a `Map` of asset name to `{ digest, size }`, and
 *   the route that answered.
 */
export async function releaseAssets(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const log = options.log ?? (() => {})
  const slug = options.slug
  if (typeof slug !== 'string' || slug === '') throw new Error('releaseAssets needs a repository slug')
  const pinned = typeof options.tag === 'string' && options.tag !== '' && options.tag !== 'latest'
  const suffix = pinned ? `tags/${encodeURIComponent(options.tag)}` : 'latest'
  const url = `https://api.github.com/repos/${slug}/releases/${suffix}`
  // Direct first; a null already in `routes` must not be tried twice.
  const routes = [null, ...(options.routes ?? []).filter(route => route !== null)]
  const failures = []
  for (const route of routes) {
    try {
      const response = await fetchImpl(throughProxy(route, url), {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'dsh-matlab',
          'x-github-api-version': '2022-11-28',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const body = await response.json()
      const tag = typeof body?.tag_name === 'string' && body.tag_name.trim() !== '' ? body.tag_name.trim() : undefined
      if (tag === undefined) throw new Error('the release carries no tag')
      const assets = new Map()
      for (const asset of Array.isArray(body.assets) ? body.assets : []) {
        if (typeof asset?.name !== 'string' || asset.name === '') continue
        assets.set(asset.name, {
          digest: parseAssetDigest(asset.digest),
          size: Number.isFinite(asset.size) && asset.size > 0 ? asset.size : undefined,
        })
      }
      if (route !== null) {
        log({ level: 'warn', message: `release checksums for ${slug} came through ${routeLabel(route)}, not api.github.com` })
      }
      return { tag, assets, route }
    } catch (cause) {
      failures.push(`${routeLabel(route)}: ${messageOf(cause)}`)
    }
  }
  throw new Error(`could not read ${slug} release metadata: ${failures.join('; ')}`)
}

