/**
 * MATLAB MCP Server release artifacts.
 *
 * Asset names come from MathWorks: the current spelling is
 * `matlab-mcp-server-<platform>-<arch>` and releases before 2026-06-18 used
 * `matlab-mcp-core-server-<matlab-arch>`. Both are attempted so a pinned older
 * release still resolves.
 *
 * Every attempt runs over one route from {@link module:dsh-plugin-matlab/github}
 * and is bounded twice — a watchdog that aborts when the connection stops
 * producing bytes, and a budget for the whole download — because this runs
 * inside DSH's startup: a dead mirror must fail quickly instead of holding the
 * first launch open.
 *
 * @module dsh-plugin-matlab/release
 */

import { chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { routeLabel, throughProxy } from './github.js'

/** Release download base; `latest` redirects to the newest tag. */
export const RELEASE_BASE = 'https://github.com/matlab/matlab-mcp-server/releases'

/** How long a route may take to answer with headers. */
const HEADERS_TIMEOUT_MS = 20_000

/** How long a route may go without delivering a single byte. */
const STALL_TIMEOUT_MS = 30_000

/** A response smaller than this cannot be the server binary. */
const MIN_BINARY_BYTES = 1_000_000

/** Log progress at this granularity, so a slow route is visible while it runs. */
const PROGRESS_STEP_BYTES = 5 * 1024 * 1024

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])
/** Thin and fat Mach-O magics, little- and big-endian. */
const MACHO_MAGICS = [
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
]

/** Binary file name inside a toolkit `bin/` folder. */
export function binaryFileName(platform) {
  return platform === 'win32' ? 'matlab-mcp-server.exe' : 'matlab-mcp-server'
}

/**
 * Candidate release asset names for one platform and architecture, newest spelling first.
 * @param platform - `process.platform` value.
 * @param arch - `process.arch` value.
 * @returns asset names to try in order; empty when MathWorks publishes no binary for the target.
 */
export function assetCandidates(platform, arch) {
  if (platform === 'win32' && arch === 'x64') {
    return ['matlab-mcp-server-windows-x64.exe', 'matlab-mcp-core-server-win64.exe']
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return ['matlab-mcp-server-macos-arm64', 'matlab-mcp-core-server-maca64']
  }
  if (platform === 'darwin' && arch === 'x64') {
    return ['matlab-mcp-server-macos-x64', 'matlab-mcp-core-server-maci64']
  }
  if (platform === 'linux' && arch === 'x64') {
    return ['matlab-mcp-server-linux-x64', 'matlab-mcp-core-server-glnxa64']
  }
  return []
}

/**
 * Build the download URL for one asset.
 * @param asset - release asset name.
 * @param tag - release tag, or `latest`.
 * @returns an absolute URL.
 */
export function assetUrl(asset, tag = 'latest') {
  return `${RELEASE_BASE}/${tag === 'latest' ? 'latest/download' : `download/${tag}`}/${asset}`
}

/**
 * Whether a payload starts like a program this platform can run.
 *
 * A public GitHub prefix that has lost its upstream answers with its own
 * branded page, sometimes larger than the size floor below; installing that as
 * the MATLAB MCP Server would replace "download failed" with "server starts and
 * exits immediately". A Windows executable is always PE, so its `MZ` header is
 * required; on POSIX an ELF/Mach-O binary or a `#!` script is accepted.
 * @param platform - `process.platform` value.
 * @param head - first bytes of the response.
 * @returns true when the payload is plausible for this platform.
 */
export function looksLikeExecutable(platform, head) {
  if (head === undefined || head.byteLength < 2) return false
  const text = head.subarray(0, 64).toString('latin1').trimStart().toLowerCase()
  if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('<?xml')) return false
  if (text.startsWith('{') || text.startsWith('[')) return false
  if (platform === 'win32') return head[0] === 0x4d && head[1] === 0x5a
  if (head.byteLength < 4) return false
  if (head.subarray(0, 4).equals(ELF_MAGIC)) return true
  if (MACHO_MAGICS.some(magic => head.subarray(0, 4).equals(magic))) return true
  return text.startsWith('#!')
}

/**
 * Download and install the MATLAB MCP Server binary.
 *
 * One attempt per asset and route, accelerated routes first. The first attempt
 * that yields a plausible binary wins and the winner is reported, so the status
 * route can explain which route the install came through.
 * @param options - destination directory, platform seams, routes, and fetch implementation.
 * @param options.directory - folder that receives the binary.
 * @param options.platform - `process.platform` value.
 * @param options.arch - `process.arch` value.
 * @param options.tag - release tag to download; defaults to `latest`.
 * @param options.routes - acceleration routes, direct last; defaults to direct only.
 * @param options.fetchImpl - fetch implementation; defaults to the global one, which DSH already proxies.
 * @param options.timeoutMs - budget for the whole download across routes and asset spellings.
 * @param options.onProgress - called as bytes arrive, so a settings page can show a bar.
 * @param options.log - diagnostic sink receiving `{ level, message }`.
 * @returns the installed path, asset name, byte count, and route that served it.
 */
export async function downloadMcpServer(options) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const log = options.log ?? (() => {})
  const candidates = assetCandidates(platform, arch)
  if (candidates.length === 0) {
    throw new Error(`MathWorks publishes no matlab-mcp-server binary for ${platform}-${arch}`)
  }
  const routes = options.routes ?? [null]
  const budgetMs = options.timeoutMs ?? 300_000
  const deadline = Date.now() + budgetMs
  await mkdir(options.directory, { recursive: true })
  const destination = join(options.directory, binaryFileName(platform))
  const attempts = candidates.flatMap(asset => routes.map(route => ({ asset, route })))
  const failures = []
  for (const [index, attempt] of attempts.entries()) {
    if (Date.now() >= deadline) {
      failures.push(`budget of ${String(budgetMs)} ms spent with ${String(attempts.length - index)} attempt(s) untried`)
      break
    }
    const url = throughProxy(attempt.route, assetUrl(attempt.asset, options.tag))
    log({ level: 'info', message: `downloading ${url}` })
    try {
      const installed = await fetchAsset({
        url, destination, platform, deadline, fetchImpl, log,
        onProgress: options.onProgress,
      })
      log({ level: 'info', message: `installed ${destination} (${String(installed.bytes)} bytes via ${routeLabel(attempt.route)})` })
      return { path: destination, asset: attempt.asset, bytes: installed.bytes, route: attempt.route }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      failures.push(`${attempt.asset} via ${routeLabel(attempt.route)}: ${message}`)
      log({ level: 'warn', message: `${routeLabel(attempt.route)} route failed for ${attempt.asset}: ${message}` })
    }
  }
  throw new Error(
    `could not download the MATLAB MCP Server binary for ${platform}-${arch}: ${failures.join('; ')}. `
    + `Download it manually from ${RELEASE_BASE}/latest and set mcpServerPath, `
    + `or set githubProxy (or DSHM_GITHUB_PROXY) to an HTTPS acceleration prefix.`,
  )
}

/**
 * Fetch one asset over one route, writing it through a temporary file.
 * @param options - resolved URL, destination, platform, deadline, progress, and seams.
 * @returns the installed byte count.
 */
async function fetchAsset(options) {
  const temp = `${options.destination}.download`
  const controller = new AbortController()
  const remaining = () => Math.max(1, options.deadline - Date.now())
  let watchdog
  let bytes = 0
  let reportAt = PROGRESS_STEP_BYTES
  let head
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
    if (contentType.includes('text/html')) throw new Error('answered with an HTML page instead of a binary')
    // The mirror's own length, when it states one, is the denominator a progress bar needs.
    const declared = Number(response.headers?.get?.('content-length'))
    const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : undefined
    const handle = await open(temp, 'w')
    try {
      const body = response.body
      if (body !== null && typeof body?.[Symbol.asyncIterator] === 'function') {
        watch(Math.min(remaining(), STALL_TIMEOUT_MS), 'the route stopped sending data')
        for await (const chunk of body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          // Keep up to the first 64 bytes whatever the transport's chunk size is.
          if (head === undefined || head.byteLength < 64) {
            head = Buffer.concat([head ?? Buffer.alloc(0), buffer.subarray(0, 64)])
          }
          await handle.write(buffer)
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
        head = buffer
        await handle.write(buffer)
        bytes = buffer.byteLength
        options.onProgress?.({ bytes, totalBytes })
      }
    } finally {
      await handle.close()
    }
    if (bytes < MIN_BINARY_BYTES) throw new Error(`only ${String(bytes)} bytes`)
    if (!looksLikeExecutable(options.platform, head)) throw new Error('payload is not a runnable program for this platform')
    await chmod(temp, 0o755)
    await rename(temp, options.destination)
    return { bytes }
  } finally {
    clearTimeout(watchdog)
    // Success renamed the file away; a failure must not leave a partial one.
    await rm(temp, { force: true })
  }
}

/**
 * Read the version a server binary reports.
 * @param run - command runner.
 * @param path - binary path.
 * @returns the version line, or `undefined` when the binary cannot run.
 */
export async function readBinaryVersion(run, path) {
  const result = await run(path, ['--version'], { allowFailure: true, timeoutMs: 20_000 })
  if (result.code !== 0) return undefined
  const line = result.stdout.split(/\r?\n/u).map(entry => entry.trim()).find(entry => entry.length > 0)
  return line
}

/**
 * Whether a path exists and looks like an executable file.
 * @param path - candidate path.
 * @returns true when the file is present.
 */
export async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
