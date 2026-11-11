/**
 * Resolve the MATLAB MCP Server executable.
 *
 * The binary is MathWorks' own program; this module only decides which copy to
 * run. The plugin's data folder is the only automatic location — a MathWorks
 * installer copy under `~/.matlab` is not read — so `$DSH_HOME/matlab/bin` is
 * the one answer to "which binary does DSH run", and an explicit `mcpServerPath`
 * is the user's own override.
 *
 * @module dsh-plugin-matlab/mcp-binary
 */

import { join } from 'node:path'
import { binaryFileName, downloadMcpServer, isFile, readBinaryVersion } from './release.js'
import { runCommand } from './run.js'

/**
 * Ordered candidate paths for the server binary.
 * @param options - platform, plugin data folder, and the explicit setting.
 * @returns candidate paths with the layout that produced each one.
 */
export function mcpServerCandidates(options) {
  const platform = options.platform ?? process.platform
  const name = binaryFileName(platform)
  const candidates = []
  if (options.explicit !== undefined) {
    candidates.push({ path: options.explicit, source: 'config' })
  }
  if (options.dataRoot !== undefined) {
    candidates.push({ path: join(options.dataRoot, 'bin', name), source: 'plugin-data' })
  }
  return candidates
}

/**
 * Find the first runnable server binary.
 * @param options - candidates plus a file probe.
 * @returns the chosen binary, or `undefined` when no candidate exists.
 */
export async function findMcpServer(options) {
  const isFileProbe = options.isFile ?? isFile
  for (const candidate of mcpServerCandidates(options)) {
    if (await isFileProbe(candidate.path)) return candidate
  }
  return undefined
}

/**
 * Resolve a binary to run, downloading it when allowed and nothing exists yet.
 * @param options - candidates, provisioning policy, and diagnostic seams.
 * @returns the binary path with its source and reported version.
 */
export async function ensureMcpServer(options) {
  const log = options.log ?? (() => {})
  const found = await findMcpServer(options)
  if (found !== undefined) {
    return { path: found.path, source: found.source, downloaded: false }
  }
  if (options.explicit !== undefined) {
    throw new Error(`matlab-agentic: mcpServerPath does not point at a file: ${options.explicit}`)
  }
  if (options.autoProvision !== true || options.dataRoot === undefined) {
    throw new Error(
      'matlab-agentic: the MATLAB MCP Server binary was not found in the plugin data folder. '
      + 'Install it from Settings → MATLAB, enable autoProvision, or set mcpServerPath.',
    )
  }
  const downloaded = await downloadMcpServer({
    directory: join(options.dataRoot, 'bin'),
    platform: options.platform,
    arch: options.arch,
    routes: options.routes,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.provisionTimeoutMs,
    onProgress: options.onProgress,
    log,
  })
  return {
    path: downloaded.path,
    source: 'download',
    downloaded: true,
    asset: downloaded.asset,
    route: downloaded.route,
    tag: downloaded.tag,
    digest: downloaded.digest,
    verified: downloaded.verified,
  }
}

/**
 * Download the newest server binary over the acceleration routes, replacing the
 * installed copy.
 *
 * The caller disposes the running child first: Windows refuses to replace a file
 * a process has open, and the old server would keep answering with its old
 * version even if the bytes on disk changed.
 * @param options - destination root, platform, routes, and progress seams.
 * @returns the new binary path with its route and asset name.
 */
export async function updateMcpServer(options) {
  const log = options.log ?? (() => {})
  const downloaded = await downloadMcpServer({
    directory: join(options.dataRoot, 'bin'),
    platform: options.platform,
    arch: options.arch,
    routes: options.routes,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.provisionTimeoutMs,
    onProgress: options.onProgress,
    log,
  })
  return {
    path: downloaded.path,
    source: 'download',
    downloaded: true,
    asset: downloaded.asset,
    route: downloaded.route,
    tag: downloaded.tag,
    digest: downloaded.digest,
    verified: downloaded.verified,
  }
}

/**
 * Read the server version, tolerating a binary that cannot start here.
 * @param path - server binary.
 * @param run - command runner.
 * @returns the version line, if the binary answered.
 */
export async function serverVersion(path, run = runCommand) {
  return await readBinaryVersion(run, path)
}
