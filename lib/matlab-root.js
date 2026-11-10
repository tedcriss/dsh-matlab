/**
 * Locate the MATLAB installation the MCP server should start.
 *
 * The plugin never starts MATLAB itself: it only names the root that
 * `matlab-mcp-server --matlab-root` receives. Detection follows the order a
 * MathWorks user would expect — explicit setting, environment, PATH, the
 * platform's installer registry or application folders — and returns the
 * newest release.
 *
 * @module dsh-plugin-matlab/matlab-root
 */

import { readdir, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { runCommand } from './run.js'

/** Environment variables MathWorks and the MCP server honour. */
const ROOT_ENV_NAMES = ['MW_MCP_SERVER_MATLAB_ROOT', 'MATLAB_ROOT']

/** Well-known parent folders per platform. */
const PLATFORM_PARENTS = {
  win32: ['C:\\Program Files\\MATLAB'],
  darwin: ['/Applications'],
  linux: ['/usr/local/MATLAB', '/opt/MATLAB'],
}

/** Path rules of the platform being inspected, not of the host running the inspection. */
function pathRules(platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * Rank a MATLAB release directory or registry version for newest-first ordering.
 * @param name - directory name (`R2025b`) or registry version (`25.2`).
 * @returns a sortable rank; unversioned names rank lowest.
 */
export function releaseRank(name) {
  const release = /R(\d{4})([ab])/iu.exec(name)
  if (release !== null) return Number(release[1]) * 10 + (release[2].toLowerCase() === 'b' ? 1 : 0)
  const numeric = /^(\d{2})\.(\d)$/u.exec(name)
  if (numeric !== null) return (2000 + Number(numeric[1])) * 10 + (Number(numeric[2]) === 2 ? 1 : 0)
  const bare = /^(\d{4})$/u.exec(name)
  if (bare !== null) return Number(bare[1]) * 10
  return -1
}

/** Newest first, then by name so ties are deterministic. */
function newestFirst(entries) {
  return [...entries].sort((left, right) => {
    const rank = releaseRank(right.name) - releaseRank(left.name)
    return rank !== 0 ? rank : left.name.localeCompare(right.name)
  })
}

/**
 * Read MATLAB roots from the Windows installer registry.
 * @param run - command runner.
 * @returns candidate roots in query order.
 */
export async function windowsRegistryRoots(run) {
  const roots = []
  for (const hive of ['HKLM', 'HKCU']) {
    const key = `${hive}\\SOFTWARE\\MathWorks\\MATLAB`
    const result = await run('reg', ['query', key, '/s'], { allowFailure: true })
    if (result.code !== 0) continue
    for (const line of result.stdout.split(/\r?\n/u)) {
      const match = /^\s*MATLABROOT\s+REG_[A-Z_]+\s+(.+?)\s*$/u.exec(line)
      if (match !== null) roots.push(match[1])
    }
  }
  return [...new Set(roots)].map(root => ({ name: win32.basename(root), root }))
}

/**
 * Resolve the installation root from a `matlab` executable on PATH.
 * @param run - command runner.
 * @param platform - `process.platform` value.
 * @returns the installation root above `bin`.
 */
async function pathExecutableRoot(run, platform) {
  const locator = platform === 'win32' ? 'where' : 'which'
  const result = await run(locator, ['matlab'], { allowFailure: true })
  if (result.code !== 0) return undefined
  const first = result.stdout.split(/\r?\n/u).map(line => line.trim()).find(line => line.length > 0)
  if (first === undefined) return undefined
  // <root>/bin/matlab[.exe]
  const paths = pathRules(platform)
  const root = paths.dirname(paths.dirname(first))
  return paths.basename(first).startsWith('matlab') ? root : undefined
}

/**
 * List candidate roots under a parent folder.
 * @param parent - parent folder such as `C:\\Program Files\\MATLAB`.
 * @param isDirectory - directory probe.
 * @param readdirImpl - folder listing seam.
 * @param paths - path rules of the inspected platform.
 * @returns candidate roots, newest first.
 */
async function childrenOf(parent, isDirectory, readdirImpl, paths) {
  let entries
  try {
    entries = await readdirImpl(parent)
  } catch {
    // An absent parent folder is the normal state on a machine without that layout.
    return []
  }
  const roots = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const root = paths.join(parent, entry.name)
    if (await isDirectory(root)) roots.push({ name: entry.name, root })
  }
  return newestFirst(roots)
}

/**
 * Discover the MATLAB root to hand to the MCP server.
 * @param options - explicit setting and injected platform seams.
 * @param options.explicit - configured `matlabRoot`, if any.
 * @param options.env - environment map; defaults to `process.env`.
 * @param options.platform - `process.platform` value.
 * @param options.isDirectory - directory probe.
 * @param options.readdir - folder listing seam.
 * @param options.run - command runner.
 * @returns the chosen root with the source that produced it, or `undefined`.
 */
export async function discoverMatlabRoot(options = {}) {
  const platform = options.platform ?? process.platform
  const paths = pathRules(platform)
  const env = options.env ?? process.env
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const readdirImpl = options.readdir ?? (async directory => await readdir(directory, { withFileTypes: true }))
  const run = options.run ?? runCommand

  if (options.explicit !== undefined) {
    return { root: options.explicit, source: 'config', exists: await isDirectory(options.explicit) }
  }
  for (const name of ROOT_ENV_NAMES) {
    const value = env[name]
    if (typeof value === 'string' && value.trim().length > 0) {
      return { root: value.trim(), source: `env:${name}` }
    }
  }
  // A root the user chose inside the MathWorks installer is not consulted: this
  // plugin owns its own artifacts and treats the machine's PATH, registry, and
  // platform folders as the machine's facts, nothing else.
  const fromPath = await pathExecutableRoot(run, platform)
  if (fromPath !== undefined && await isDirectory(fromPath)) {
    return { root: fromPath, source: 'PATH' }
  }
  if (platform === 'win32') {
    const found = await firstExisting(newestFirst(await windowsRegistryRoots(run)), isDirectory)
    if (found !== undefined) return { root: found.root, source: 'registry' }
  }
  const candidates = []
  for (const parent of PLATFORM_PARENTS[platform] ?? []) {
    candidates.push(...await childrenOf(parent, isDirectory, readdirImpl, paths))
  }
  // On macOS the installation root is the `.app` bundle itself, which the
  // /Applications listing already returns.
  const found = await firstExisting(newestFirst(candidates), isDirectory)
  return found === undefined ? undefined : { root: found.root, source: 'platform-folder' }
}

async function firstExisting(entries, isDirectory) {
  for (const entry of entries) {
    if (await isDirectory(entry.root)) return entry
  }
  return undefined
}

async function defaultIsDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
