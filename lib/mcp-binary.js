/**
 * Resolve the MATLAB MCP Server executable.
 *
 * The binary is MathWorks' own program; this module only decides which copy to
 * run. A copy the user configured or that the MathWorks installer placed at
 * `~/.matlab/agentic-toolkits/bin/` always wins over a copy this plugin
 * downloaded, so switching to the official installer never leaves a stale
 * duplicate behind.
 *
 * @module dsh-plugin-matlab/mcp-binary
 */

import { join } from 'node:path'
import { binaryFileName, downloadMcpServer, isFile, readBinaryVersion } from './release.js'
import { runCommand } from './run.js'

/**
 * Ordered candidate paths for the server binary.
 * @param options - platform, home folders, and the explicit setting.
 * @returns candidate paths with the layout that produced each one.
 */
export function mcpServerCandidates(options) {
  const platform = options.platform ?? process.platform
  const name = binaryFileName(platform)
  const candidates = []
  if (options.explicit !== undefined) {
    candidates.push({ path: options.explicit, source: 'config' })
  }
  if (options.matlabInstallRoot !== undefined) {
    candidates.push({ path: join(options.matlabInstallRoot, 'bin', name), source: 'matlab-installer' })
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
      'matlab-agentic: the MATLAB MCP Server binary was not found. Install it with the MathWorks '
      + 'Agentic Toolkit installer (setupAgenticToolkit("install")), download it from '
      + 'https://github.com/matlab/matlab-mcp-server/releases/latest, or set mcpServerPath.',
    )
  }
  const downloaded = await downloadMcpServer({
    directory: join(options.dataRoot, 'bin'),
    platform: options.platform,
    arch: options.arch,
    routes: options.routes,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.provisionTimeoutMs,
    log,
  })
  return {
    path: downloaded.path,
    source: 'download',
    downloaded: true,
    asset: downloaded.asset,
    route: downloaded.route,
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
