/**
 * GitHub acceleration: the routes DSH already resolved, reused instead of a
 * private copy of them.
 *
 * Both artifacts this plugin fetches live on github.com: the MATLAB MCP Server
 * release asset (19.9 MB for v0.16.0) and the Agentic Toolkit checkout. From
 * mainland China the origin delivers a few kilobytes per second — measured on
 * 2026-11-10, 7 KB/s direct against 250 KB/s through the prefix DSH's own
 * market uses — so the first DSH start sits inside that download for most of
 * an hour and never reaches a usable profile.
 *
 * So this module invents no proxy and pins no mirror of its own. It reads the
 * acceleration DSH has already decided, with the same precedence DSH applies:
 *
 *   1. the plugin's `githubProxy` / `downloadRegion` — the most specific
 *      statement, and the only one a profile with no market can make;
 *   2. `DSHM_GITHUB_PROXY`, the operator-owned environment override;
 *   3. `<profile>/.dsh-market/state.json` — where DSH's market persists the
 *      custom prefix and the selected download region (`china` / `global`).
 *
 * A route is either `null` (direct) or an HTTPS prefix that receives the whole
 * destination URL as its path, which is how every public GitHub prefix works.
 * Every chain ends with the direct route: a mirror that dies must degrade to
 * slow, never to broken.
 *
 * @module dsh-plugin-matlab/github
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Public prefixes DSH's market ships for its China download region, best first. */
export const CHINA_GITHUB_ROUTES = Object.freeze(['https://gh-proxy.com', 'https://ghfast.top'])

/** Environment override DSH's market honours; the operator owns it there too. */
export const GITHUB_PROXY_ENV = 'DSHM_GITHUB_PROXY'

/** Folder inside a profile that holds DSH's market state. */
export const MARKET_STATE_DIR = '.dsh-market'

/** File inside {@link MARKET_STATE_DIR} that records the region and prefix. */
export const MARKET_STATE_FILE = 'state.json'

/** Accepted values of the `downloadRegion` setting. */
export const DOWNLOAD_REGIONS = Object.freeze(['auto', 'china', 'global'])

/**
 * Normalize one HTTPS acceleration prefix.
 *
 * Public prefixes take the complete destination URL in their path, so only a
 * bare origin plus an optional path is meaningful: credentials, a query, a
 * fragment, or a backslash cannot be part of one, and an `http:` prefix would
 * let a middlebox rewrite the binary this plugin is about to execute.
 * @param value - candidate prefix, from configuration, environment, or state.
 * @returns the prefix without a trailing slash, or `null` when unusable.
 */
export function normalizeGithubProxy(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '' || raw.includes('\\')) return null
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, '')}`
}

/**
 * Wrap a GitHub URL in a prefix route.
 * @param route - prefix, or `null` to go direct.
 * @param url - absolute URL on a github.com-family host.
 * @returns the routed URL.
 */
export function throughProxy(route, url) {
  return route === null ? url : `${route}/${url}`
}

/**
 * Name a route for logs and the status route.
 * @param route - prefix, or `null` for the direct route.
 * @returns `direct`, or the prefix without its scheme.
 */
export function routeLabel(route) {
  return route === null ? 'direct' : route.replace(/^https:\/\//u, '').replace(/\/$/u, '')
}

/**
 * Whether a name follows DSH's profile directory-name contract.
 * @param name - candidate profile name.
 * @returns true when the name can be a directory segment under `profiles/`.
 */
export function isDshProfileName(name) {
  return typeof name === 'string'
    && name !== ''
    && name !== '.'
    && name !== '..'
    && name !== 'node_modules'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0')
}

/**
 * Read what DSH's market recorded for this profile.
 *
 * The file is the market's, so an unreadable or hand-edited one is not an
 * error here: the plugin simply falls back to the next fact source.
 * @param profileDirectory - absolute profile directory.
 * @returns the recorded region and prefix, or `undefined` when neither exists.
 */
export async function readMarketState(profileDirectory) {
  let text
  try {
    text = await readFile(join(profileDirectory, MARKET_STATE_DIR, MARKET_STATE_FILE), 'utf8')
  } catch {
    return undefined
  }
  let state
  try {
    state = JSON.parse(text)
  } catch {
    return undefined
  }
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return undefined
  const region = state.region === 'china' || state.region === 'global' ? state.region : undefined
  const githubProxy = normalizeGithubProxy(state.githubProxy) ?? undefined
  return region === undefined && githubProxy === undefined ? undefined : { region, githubProxy }
}

/**
 * Resolve the profile whose market state describes this host.
 *
 * The launcher owns the directory, so `profileContext` (the same service DSH's
 * market reads) wins over anything derived from a name. The environment is
 * next, and only a host that publishes neither is scanned — newest market
 * state first, because that is the profile somebody last used.
 * @param options - launcher facts and injected seams.
 * @param options.profileDirectory - `profileContext.dir`, when the host has one.
 * @param options.dshHome - Harness home folder.
 * @param options.env - environment map.
 * @returns the profile directory, or `undefined` when none is identifiable.
 */
export async function resolveProfileDirectory(options = {}) {
  const env = options.env ?? process.env
  const explicit = options.profileDirectory
  if (typeof explicit === 'string' && explicit.trim() !== '') return resolve(explicit.trim())
  const fromEnv = env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv.trim())
  const dshHome = options.dshHome
  if (typeof dshHome !== 'string' || dshHome.trim() === '') return undefined
  const name = env.DSH_PROFILE
  if (isDshProfileName(name)) return join(dshHome, 'profiles', name)
  const profiles = join(dshHome, 'profiles')
  let entries
  try {
    entries = await readdir(profiles, { withFileTypes: true })
  } catch {
    return undefined
  }
  let newest
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const directory = join(profiles, entry.name)
    const file = join(directory, MARKET_STATE_DIR, MARKET_STATE_FILE)
    let modified
    try {
      modified = (await stat(file)).mtimeMs
    } catch {
      continue
    }
    if (newest === undefined || modified > newest.modified) newest = { directory, modified }
  }
  return newest?.directory
}

/**
 * Build the ordered route chain for one region and prefix.
 *
 * Accelerated routes come first for both downloads and clones: the payload a
 * clone transfers is the same pack a release download transfers, so the
 * question "is the origin fast here?" has one answer for both. DSH's market
 * starts its git chain direct because it only reads ref advertisements; a
 * `git clone` moves the repository body, which is exactly the slow part.
 * @param options - resolved region and custom prefix.
 * @param options.region - `china` or `global`.
 * @param options.proxy - normalised prefix, or `null`.
 * @returns ordered routes ending in the direct one.
 */
export function routesFor(options) {
  const base = options.region === 'china' ? [...CHINA_GITHUB_ROUTES] : []
  const proxy = options.proxy ?? null
  const accelerated = proxy === null ? base : [proxy, ...base.filter(route => route !== proxy)]
  return [...accelerated, null]
}

/**
 * Resolve the acceleration this process should use.
 * @param options - configured statement, DSH facts, and seams.
 * @param options.githubProxy - normalised `githubProxy` setting, or `null`.
 * @param options.downloadRegion - `auto`, `china`, or `global`.
 * @param options.profileDirectory - the profile whose market state to read.
 * @param options.env - environment map.
 * @param options.log - diagnostic sink receiving `{ level, message }`.
 * @returns the effective region, prefix, where each came from, and the routes.
 */
export async function resolveGithubAcceleration(options = {}) {
  const env = options.env ?? process.env
  const log = options.log ?? (() => {})
  const state = options.profileDirectory === undefined
    ? undefined
    : await readMarketState(options.profileDirectory)
  const configured = typeof options.githubProxy === 'string' ? normalizeGithubProxy(options.githubProxy) : null
  const envRaw = env[GITHUB_PROXY_ENV]
  const envProxy = typeof envRaw === 'string' && envRaw.trim() !== '' ? normalizeGithubProxy(envRaw) : null
  if (envProxy === null && typeof envRaw === 'string' && envRaw.trim() !== '') {
    // The operator's variable is not this plugin's configuration, so a value
    // it cannot use is reported and skipped rather than fatal.
    log({ level: 'warn', message: `ignoring ${GITHUB_PROXY_ENV}=${envRaw.trim()}: not an HTTPS prefix without credentials or query` })
  }
  const proxy = configured ?? envProxy ?? state?.githubProxy ?? null
  const source = configured !== null ? 'config' : envProxy !== null ? 'environment' : state?.githubProxy !== undefined ? 'market' : 'none'
  const configuredRegion = options.downloadRegion
  const explicitRegion = configuredRegion === 'china' || configuredRegion === 'global'
  const region = explicitRegion ? configuredRegion : state?.region ?? 'global'
  const regionSource = explicitRegion ? 'config' : state?.region !== undefined ? 'market' : 'default'
  return { region, regionSource, proxy, source, routes: routesFor({ region, proxy }) }
}
