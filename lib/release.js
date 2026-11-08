/**
 * MATLAB MCP Server release artifacts.
 *
 * Asset names come from MathWorks: the current spelling is
 * `matlab-mcp-server-<platform>-<arch>` and releases before 2026-06-18 used
 * `matlab-mcp-core-server-<matlab-arch>`. Both are attempted so a pinned older
 * release still resolves.
 *
 * @module dsh-plugin-matlab/release
 */

import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Release download base; `latest` redirects to the newest tag. */
export const RELEASE_BASE = 'https://github.com/matlab/matlab-mcp-server/releases'

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
 * Download and install the MATLAB MCP Server binary.
 * @param options - destination directory, platform seams, and fetch implementation.
 * @param options.directory - folder that receives the binary.
 * @param options.platform - `process.platform` value.
 * @param options.arch - `process.arch` value.
 * @param options.tag - release tag to download; defaults to `latest`.
 * @param options.fetchImpl - fetch implementation; defaults to the global one, which DSH already proxies.
 * @param options.timeoutMs - whole-download budget.
 * @param options.log - diagnostic sink receiving `{ level, message }`.
 * @returns the installed path, asset name, and byte count.
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
  await mkdir(options.directory, { recursive: true })
  const destination = join(options.directory, binaryFileName(platform))
  const failures = []
  for (const asset of candidates) {
    const url = assetUrl(asset, options.tag)
    log({ level: 'info', message: `downloading ${url}` })
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      })
      if (!response.ok) {
        failures.push(`${asset}: HTTP ${String(response.status)}`)
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      // A 404 HTML page or a truncated redirect body must never be installed as the server.
      if (bytes.byteLength < 1_000_000) {
        failures.push(`${asset}: only ${String(bytes.byteLength)} bytes`)
        continue
      }
      const temp = `${destination}.download`
      await writeFile(temp, bytes)
      await chmod(temp, 0o755)
      await rename(temp, destination)
      log({ level: 'info', message: `installed ${destination} (${String(bytes.byteLength)} bytes)` })
      return { path: destination, asset, bytes: bytes.byteLength }
    } catch (cause) {
      failures.push(`${asset}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  await rm(`${destination}.download`, { force: true })
  throw new Error(
    `could not download the MATLAB MCP Server binary for ${platform}-${arch}: ${failures.join('; ')}. `
    + `Download it manually from ${RELEASE_BASE}/latest and set mcpServerPath.`,
  )
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
