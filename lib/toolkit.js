/**
 * Discover MathWorks Agentic Toolkits and the skill groups they declare.
 *
 * The toolkit checkout stays the authority: the plugin reads the file
 * `manifest.yaml` that MathWorks ships, so a new skill group in a future
 * toolkit release appears without a plugin change.
 *
 * @module dsh-plugin-matlab/toolkit
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseDisplayName, parseMcpServerExtensions, parseSkillGroups } from './yaml-mini.js'

/** Folder name of one toolkit inside a checkout or install root. */
const MANIFEST_FILE = 'manifest.yaml'

/** How a toolkit is classified from its own manifest metadata. */
function classify(displayName, directory) {
  const text = `${displayName ?? ''} ${directory}`.toLowerCase()
  if (text.includes('simulink')) return 'simulink'
  if (text.includes('matlab')) return 'matlab'
  return 'other'
}

/**
 * Read one toolkit checkout.
 * @param root - directory containing `manifest.yaml`.
 * @param isDirectory - directory probe used to confirm group folders.
 * @returns the toolkit record, or `undefined` when the manifest is unreadable.
 */
export async function readToolkit(root, isDirectory = defaultIsDirectory) {
  let text
  try {
    text = await readFile(join(root, MANIFEST_FILE), 'utf8')
  } catch {
    // A trimmed checkout without a manifest is still a toolkit: its catalog folders are the groups.
    text = ''
  }
  const displayName = parseDisplayName(text)
  const declared = parseSkillGroups(text)
  const groups = []
  if (declared !== undefined) {
    for (const group of declared) {
      const path = resolve(root, group.path)
      if (await isDirectory(path)) {
        groups.push({ ...group, path, toolkit: root })
        continue
      }
      // A manifest that names a folder a checkout does not carry is stale, not fatal.
      continue
    }
  }
  if (groups.length === 0) {
    // Older or hand-trimmed checkouts have no manifest: every catalog folder is a group.
    for (const entry of await safeReaddir(join(root, 'skills-catalog'))) {
      const path = join(root, 'skills-catalog', entry)
      if (await isDirectory(path)) {
        groups.push({
          name: entry,
          displayName: entry,
          description: '',
          path,
          required: entry.endsWith('-core'),
          requiresProducts: [],
          toolkit: root,
        })
      }
    }
  }
  const extensionFiles = (parseMcpServerExtensions(text) ?? []).map(path => resolve(root, path))
  return {
    root,
    displayName: displayName ?? basename(root),
    kind: classify(displayName, root),
    groups,
    extensionFiles,
  }
}

/**
 * Find toolkit checkouts under one folder without assuming MathWorks' directory names.
 * @param parent - install root that may contain toolkits directly or one level down.
 * @param isDirectory - directory probe.
 * @returns toolkit records for every `manifest.yaml` found at depth one or two.
 */
export async function scanToolkits(parent, isDirectory = defaultIsDirectory) {
  const found = []
  const seen = new Set()
  for (const entry of await safeReaddir(parent)) {
    const direct = join(parent, entry)
    if (!await isDirectory(direct)) continue
    if (await isDirectory(join(direct, 'skills-catalog'))) {
      if (!seen.has(direct)) {
        seen.add(direct)
        const toolkit = await readToolkit(direct, isDirectory)
        if (toolkit !== undefined) found.push(toolkit)
      }
      continue
    }
    for (const nested of await safeReaddir(direct)) {
      const candidate = join(direct, nested)
      if (seen.has(candidate)) continue
      if (!await isDirectory(join(candidate, 'skills-catalog'))) continue
      seen.add(candidate)
      const toolkit = await readToolkit(candidate, isDirectory)
      if (toolkit !== undefined) found.push(toolkit)
    }
  }
  return found
}

/**
 * Collect toolkits from explicit roots, the MathWorks install layout, and the plugin data folder.
 * @param options - sources in priority order and dependency seams.
 * @returns unique toolkits ordered config, installer, then plugin data.
 */
export async function discoverToolkits(options = {}) {
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const installRoot = options.installRoot
  const dataRoots = options.dataRoots ?? []
  const toolkits = []
  const seen = new Set()
  const push = toolkit => {
    if (toolkit === undefined || seen.has(toolkit.root)) return
    seen.add(toolkit.root)
    toolkits.push(toolkit)
  }
  for (const root of options.explicitRoots ?? []) {
    if (!await isDirectory(root)) {
      throw new Error(`matlab-agentic: toolkitRoots entry is not a directory: ${root}`)
    }
    push(await readToolkit(root, isDirectory))
  }
  if (installRoot !== undefined) {
    for (const toolkit of await scanToolkits(installRoot, isDirectory)) push(toolkit)
  }
  for (const root of dataRoots) {
    for (const toolkit of await scanToolkits(root, isDirectory)) push(toolkit)
  }
  return toolkits
}

/**
 * Apply the configured group selection.
 * @param toolkits - discovered toolkits.
 * @param requested - configured group names; empty or `*` selects every group.
 * @returns selected groups with a stable `source` label, plus the names that matched nothing.
 */
export function selectSkillGroups(toolkits, requested) {
  const all = toolkits.flatMap(toolkit => toolkit.groups)
  if (requested.length === 0) {
    return { groups: [...all], unknown: [] }
  }
  if (requested.includes('*')) {
    const extra = requested.filter(name => name !== '*')
    const groups = [...all]
    const unknown = []
    for (const name of extra) {
      const matches = all.filter(group => group.name === name)
      if (matches.length === 0) unknown.push(name)
      else if (!groups.includes(matches[0])) groups.push(...matches)
    }
    return { groups, unknown }
  }
  const groups = []
  const unknown = []
  for (const name of requested) {
    const matches = all.filter(group => group.name === name)
    if (matches.length === 0) unknown.push(name)
    else groups.push(...matches)
  }
  return { groups, unknown }
}

/**
 * Count the skills a group contributes.
 * @param directory - group folder.
 * @returns the number of `<skill>/SKILL.md` bundles, or `0` when unreadable.
 */
export async function countSkills(directory) {
  // A trimmed catalog links individual skills as roots, so the directory itself
  // may already be a skill bundle rather than a group of bundles.
  try {
    if ((await stat(join(directory, 'SKILL.md'))).isFile()) return 1
  } catch {
    // Not a skill bundle; count the bundles beneath it.
  }
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return 0
  }
  let count = 0
  for (const entry of entries) {
    // Symlinks count: MathWorks documents linking skills into an agent folder,
    // and a Dirent reports a link rather than a directory.
    try {
      if (!(await isDirectoryOrLink(directory, entry))) continue
    } catch {
      continue
    }
    try {
      if ((await stat(join(directory, entry.name, 'SKILL.md'))).isFile()) count += 1
    } catch {
      // A group may carry non-skill folders such as `scripts`; they are not skills.
    }
  }
  return count
}

/** Whether a directory entry resolves to a folder, following a symlink or junction. */
async function isDirectoryOrLink(parent, entry) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  return (await stat(join(parent, entry.name))).isDirectory()
}

async function safeReaddir(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    // Links stay in the list; the caller's `stat`-based probe decides whether the
    // target is a folder, so a symlinked group or skill is not silently dropped.
    return entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name)
  } catch {
    return []
  }
}

async function defaultIsDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
