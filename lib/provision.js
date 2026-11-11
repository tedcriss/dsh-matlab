/**
 * Obtain a MathWorks Agentic Toolkit from its newest release.
 *
 * MathWorks publishes the toolkits as tagged releases, and the release itself
 * carries no downloadable asset: the catalog is the source archive GitHub
 * generates for that tag. So the plugin downloads
 * `github.com/matlab/matlab-agentic-toolkit/archive/refs/tags/<tag>.tar.gz`
 * rather than cloning the repository — one HTTP response instead of a git
 * negotiation over hundreds of round trips, no `git` installation required, and
 * a version that is a published tag instead of "whatever `main` was at the
 * time".
 *
 * The archive is extracted into a staging folder and only swapped into place
 * once it is complete, so an interrupted update never leaves the profile with a
 * half-written catalog. The tag that was installed is written inside the
 * checkout ({@link RELEASE_MARKER}), which is what the update check compares
 * with the published one.
 *
 * @module dsh-plugin-matlab/provision
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractTarGz, isGzip } from './archive.js'
import { routeLabel, rankRoutes, throughProxy } from './github.js'
import { declaredBodyLength } from './integrity.js'
import { latestRelease } from './updates.js'

/**
 * The toolkit repositories this plugin can install, keyed by toolkit kind.
 *
 * `slug` is the GitHub `owner/name`; `folder` is where a release lands inside
 * the plugin data folder.
 */
export const TOOLKIT_SOURCES = {
  matlab: {
    slug: 'matlab/matlab-agentic-toolkit',
    folder: 'matlab-agentic-toolkit',
    displayName: 'MATLAB Agentic Toolkit',
  },
  simulink: {
    slug: 'matlab/simulink-agentic-toolkit',
    folder: 'simulink-agentic-toolkit',
    displayName: 'Simulink Agentic Toolkit',
  },
}

/** File inside an installed toolkit that records which release it came from. */
export const RELEASE_MARKER = '.dsh-matlab-release.json'

/** Default budget for one toolkit install across every route. */
const DEFAULT_TIMEOUT_MS = 300_000

/** How long a route may take to answer with headers. */
const HEADERS_TIMEOUT_MS = 20_000

/** How long a route may go without delivering a single byte. */
const STALL_TIMEOUT_MS = 30_000

/** A response smaller than this cannot be a toolkit archive. */
const MIN_ARCHIVE_BYTES = 1_000

/** Log progress at this granularity, so a slow route is visible while it runs. */
const PROGRESS_STEP_BYTES = 2 * 1024 * 1024

/**
 * Where one toolkit is installed inside the plugin data folder.
 * @param dataRoot - the plugin data folder (`$DSH_HOME/matlab`).
 * @param kind - `matlab` or `simulink`.
 * @returns the absolute install directory.
 */
export function toolkitDirectory(dataRoot, kind) {
  const source = TOOLKIT_SOURCES[kind]
  if (source === undefined) throw new Error(`matlab-agentic: unknown toolkit kind ${String(kind)}`)
  return join(dataRoot, 'toolkits', source.folder)
}

/**
 * Download URL of one release's source archive.
 * @param slug - GitHub `owner/name`.
 * @param tag - release tag, for example `MATK-2026.11.a`.
 * @returns an absolute URL on github.com.
 */
export function releaseArchiveUrl(slug, tag) {
  return `https://github.com/${slug}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz`
}

/**
 * Read which release an installed toolkit came from.
 *
 * A checkout installed by an older plugin release (a `git clone`) has no marker;
 * that is reported as "unknown version" rather than as a failure, so the update
 * check can still replace it with the published release.
 * @param root - installed toolkit folder.
 * @returns `{ kind, slug, tag, installedAt, files }`, or `undefined`.
 */
export async function readToolkitRelease(root) {
  let text
  try {
    text = await readFile(join(root, RELEASE_MARKER), 'utf8')
  } catch {
    return undefined
  }
  let record
  try {
    record = JSON.parse(text)
  } catch {
    return undefined
  }
  if (record === null || typeof record !== 'object' || typeof record.tag !== 'string' || record.tag === '') return undefined
  return record
}

/**
 * Install a toolkit when none is present.
 *
 * The destination is only replaced when it is absent; a concurrent install in
 * another window wins, and the downloaded copy is discarded rather than deleting
 * something the other window already mounted.
 * @param options - kind, destination root, routes, and diagnostic seams.
 * @param options.kind - `matlab` or `simulink`.
 * @param options.dataRoot - folder receiving `toolkits/<kind>-agentic-toolkit`.
 * @param options.routes - acceleration routes, direct last; defaults to direct only.
 * @param options.tag - release tag to install; defaults to the newest release.
 * @param options.timeoutMs - budget for the whole install across every route.
 * @param options.fetchImpl - fetch implementation; defaults to the global one.
 * @param options.onAttempt - told which route is being tried, for progress display.
 * @param options.onProgress - called as bytes arrive.
 * @param options.log - diagnostic sink.
 * @returns the install root, its release tag, the route, and the byte count.
 */
export async function installToolkit(options) {
  return await obtainToolkit(options, 'install')
}

/**
 * Replace a toolkit installation with the newest published release, without
 * ever leaving the profile without a catalog.
 *
 * The archive is extracted into `<destination>.incoming`; only a finished
 * extraction replaces the live folder. A failed or interrupted update therefore
 * keeps the previous catalog usable.
 * @param options - the same options {@link installToolkit} takes.
 * @returns the install root, its release tag, the route, and the byte count.
 */
export async function updateToolkit(options) {
  return await obtainToolkit(options, 'update')
}

/**
 * Download, extract, and swap one release into place.
 * @param options - see {@link installToolkit}.
 * @param mode - `install` keeps an existing folder, `update` replaces it.
 * @returns the install result.
 */
async function obtainToolkit(options, mode) {
  const source = TOOLKIT_SOURCES[options.kind]
  if (source === undefined) throw new Error(`matlab-agentic: unknown toolkit kind ${String(options.kind)}`)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const log = options.log ?? (() => {})
  const routes = options.routes ?? [null]
  const budgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + budgetMs
  const destination = toolkitDirectory(options.dataRoot, options.kind)
  const staging = `${destination}.incoming`
  await mkdir(join(options.dataRoot, 'toolkits'), { recursive: true })

  // The tag probe is part of the same budget: a route that cannot answer costs
  // seconds, not the whole install.
  const tag = options.tag ?? await latestRelease({
    slug: source.slug,
    label: source.displayName,
    routes,
    fetchImpl,
    timeoutMs: Math.max(1, Math.min(deadline - Date.now(), 30_000)),
    log,
  }).then(release => release.tag)

  const url = releaseArchiveUrl(source.slug, tag)
  // The chain's order is a guess until a route is measured: the release
  // archive is a few megabytes, so the fastest mirror is worth asking for.
  const remaining = deadline - Date.now()
  const ranked = remaining <= 0
    ? routes
    : await rankRoutes(routes, {
      url,
      fetchImpl,
      log,
      timeoutMs: Math.max(1_000, Math.min(4_000, remaining)),
    })
  const failures = []
  let installed
  try {
    for (const [index, route] of ranked.entries()) {
      if (Date.now() >= deadline) {
        failures.push(`budget of ${String(budgetMs)} ms spent with ${String(ranked.length - index)} route(s) untried`)
        break
      }
      await rm(staging, { recursive: true, force: true })
      const routed = throughProxy(route, url)
      options.onAttempt?.({ route })
      log({ level: 'info', message: `downloading ${routed}` })
      try {
        const archive = await fetchArchive({
          url: routed,
          deadline,
          fetchImpl,
          onProgress: options.onProgress,
          log,
        })
        // A GitHub source archive nests everything under `<repo>-<tag>/`, so the
        // first segment is dropped and the catalog lands at the root.
        const extracted = await extractTarGz(archive, { destination: staging, stripComponents: 1 })
        if (extracted.files === 0) throw new Error('the archive carried no files')
        const record = {
          schema: 1,
          kind: options.kind,
          slug: source.slug,
          tag,
          url,
          archiveBytes: archive.byteLength,
          files: extracted.files,
          skipped: extracted.skipped,
          installedAt: new Date().toISOString(),
        }
        await writeFile(join(staging, RELEASE_MARKER), `${JSON.stringify(record, null, 2)}\n`)
        installed = { route, bytes: archive.byteLength, files: extracted.files, skipped: extracted.skipped }
        log({ level: 'info', message: `extracted ${String(extracted.files)} file(s) from ${source.slug} ${tag} via ${routeLabel(route)}` })
        break
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        failures.push(`${routeLabel(route)}: ${message}`)
        log({ level: 'warn', message: `${routeLabel(route)} route failed for ${source.slug}: ${message}` })
      }
    }
    if (installed === undefined) throw new Error(failureMessage(source, tag, failures))

    if (mode === 'install' && await exists(destination)) {
      // Another window may have finished the same install while this one
      // downloaded. Reusing an exact copy is right; reusing an older one is not
      // — a folder named after this plugin's install target that holds files
      // from a different release is exactly what an update may overwrite, and
      // the tag marker is how the two are told apart.
      const existing = await readToolkitRelease(destination)
      if (existing?.tag === tag) {
        await rm(staging, { recursive: true, force: true })
        return { root: destination, tag, route: installed.route, bytes: installed.bytes, files: installed.files, reused: true }
      }
      log({
        level: 'info',
        message: `replacing the installed ${source.displayName} ${existing?.tag ?? 'checkout'} with ${tag}`,
      })
    }
    // The old catalog is only replaced by a complete new one.
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    return { root: destination, tag, route: installed.route, bytes: installed.bytes, files: installed.files, skipped: installed.skipped }
  } finally {
    // A partial `.incoming` must not look like a toolkit to discovery.
    await rm(staging, { recursive: true, force: true })
  }
}

/** The one error an exhausted install reports, naming every route it tried. */
function failureMessage(source, tag, failures) {
  return `matlab-agentic: could not download ${source.displayName} ${tag}: ${failures.join('; ')}. `
    + `Download it manually from https://github.com/${source.slug}/releases and set toolkitRoots, `
    + 'or set githubProxy (or DSHM_GITHUB_PROXY) to an HTTPS acceleration prefix.'
}

/**
 * Fetch one release archive over one route.
 *
 * Bounded twice — a watchdog that aborts when the connection stops producing
 * bytes, and the caller's budget for the whole install — because this runs
 * inside a first launch that DSH abandons after 60 seconds.
 * @param options - URL, deadline, progress, and seams.
 * @returns the archive bytes.
 */
async function fetchArchive(options) {
  const controller = new AbortController()
  const remaining = () => Math.max(1, options.deadline - Date.now())
  let watchdog
  let bytes = 0
  let reportAt = PROGRESS_STEP_BYTES
  const chunks = []
  /** Restart the abort timer; `reason` is what a stalled route reports. */
  const watch = (afterMs, reason) => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => controller.abort(new Error(reason)), Math.max(1, afterMs))
    watchdog.unref?.()
  }
  try {
    watch(Math.min(remaining(), HEADERS_TIMEOUT_MS), `no response headers within ${String(HEADERS_TIMEOUT_MS / 1000)} s`)
    const response = await options.fetchImpl(options.url, { redirect: 'follow', signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase()
    if (contentType.includes('text/html')) throw new Error('answered with an HTML page instead of the archive')
    const declared = declaredBodyLength(response.headers)
    const totalBytes = declared
    const body = response.body
    if (body !== null && typeof body?.[Symbol.asyncIterator] === 'function') {
      watch(Math.min(remaining(), STALL_TIMEOUT_MS), 'the route stopped sending data')
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        chunks.push(buffer)
        bytes += buffer.byteLength
        watch(Math.min(remaining(), STALL_TIMEOUT_MS), `the route stopped sending data after ${String(bytes)} bytes`)
        options.onProgress?.({ bytes, totalBytes })
        if (bytes >= reportAt) {
          reportAt += PROGRESS_STEP_BYTES
          options.log({ level: 'info', message: `${options.url}: ${String(Math.round(bytes / 1_048_576))} MB` })
        }
      }
    } else {
      const buffer = Buffer.from(await response.arrayBuffer())
      chunks.push(buffer)
      bytes = buffer.byteLength
      options.onProgress?.({ bytes, totalBytes })
    }
    const archive = Buffer.concat(chunks)
    // A source archive has no published digest to compare (GitHub generates it
    // on demand), so a complete transfer is the check available here: the
    // declared length must agree before the gzip/tar validation runs.
    if (declared !== undefined && archive.byteLength !== declared) {
      throw new Error(`incomplete download: ${String(declared)} bytes were declared, ${String(archive.byteLength)} arrived`)
    }
    if (archive.byteLength < MIN_ARCHIVE_BYTES) throw new Error(`only ${String(archive.byteLength)} bytes`)
    if (!isGzip(archive)) throw new Error('payload is not a gzip archive')
    return archive
  } finally {
    clearTimeout(watchdog)
  }
}

/** Whether a path is already present. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
