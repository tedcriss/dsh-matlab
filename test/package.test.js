import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Read the manifest the published package is built from. */
async function manifest() {
  return JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
}

/**
 * Turn one `files` entry into a matcher.
 *
 * The published list uses a handful of shapes (`dir/*.js`, `dir/**\/*.d.ts`,
 * `dir/sub/*.json`), so a full glob implementation would be more code than the
 * question needs. `**` matches any number of path segments, `*` one segment.
 * @param pattern - one `files` entry.
 * @returns a predicate over a POSIX-style relative path.
 */
function matcher(pattern) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)
    .replaceAll('**/', '\u0000')
    .replaceAll('**', '\u0001')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '(?:.*/)?')
    .replaceAll('\u0001', '.*')
  const expression = new RegExp(`^${source}$`, 'u')
  return path => expression.test(path)
}

/**
 * Whether the published package contains a repository path.
 * @param path - repository-relative POSIX path.
 * @param patterns - the manifest's `files` list.
 * @returns true when npm/pnpm would include it.
 */
function included(path, patterns) {
  // npm always includes these regardless of `files`.
  if (['package.json', 'README.md', 'LICENSE'].includes(path)) return true
  return patterns.some(pattern => matcher(pattern)(path))
}

/** Collect relative module specifiers from one JavaScript file. */
async function relativeImports(file) {
  const text = await readFile(file, 'utf8')
  const specifiers = new Set()
  for (const pattern of [
    /\bfrom\s+['"](\.[^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gu,
  ]) {
    for (const match of text.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers].map(specifier => resolve(dirname(file), specifier))
}

/** Every JavaScript file that ships in the package. */
async function runtimeFiles() {
  const files = []
  for (const entry of await readdir(join(ROOT, 'lib'))) {
    if (entry.endsWith('.js')) files.push(join(ROOT, 'lib', entry))
  }
  files.push(join(ROOT, 'client', 'client.js'))
  files.push(join(ROOT, 'lib', 'mcp-bridge.js'))
  return files
}

test('every file the runtime imports is inside the published package', async () => {
  const { files: patterns } = await manifest()
  const missing = []
  for (const file of await runtimeFiles()) {
    for (const imported of await relativeImports(file)) {
      const path = relative(ROOT, imported).split('\\').join('/')
      // A specifier resolves to a file or, for `../package.json`, a file with no
      // extension; this runtime has no directory imports.
      const exists = await stat(imported).then(() => true, () => false)
      if (!exists) {
        missing.push(`${path} (imported by ${relative(ROOT, file)}) does not exist`)
        continue
      }
      if (!included(path, patterns)) missing.push(`${path} is imported but not listed in files`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the bundle patch the manifest declares is published', async () => {
  const { dsh, files } = await manifest()
  const patch = dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  const path = patch.replace(/^\.\//u, '')
  assert.equal(await stat(join(ROOT, path)).then(() => true, () => false), true)
  assert.ok(included(path, files), `${path} must be in files`)
})

test('the client entry the manifest exports is published', async () => {
  const { dsh, exports, files } = await manifest()
  assert.equal(dsh?.client?.platform, 'web')
  const entry = exports['./client']
  assert.equal(await stat(join(ROOT, entry)).then(() => true, () => false), true)
  assert.ok(included(entry.replace(/^\.\//u, ''), files))
})

test('the package ships no screenshot and no test file', async () => {
  const { files } = await manifest()
  for (const dir of ['assets', 'docs', 'test', 'test-support', 'scripts']) {
    // A directory-level entry would drag in the repository's storefront and test
    // material, which the runtime never reads.
    assert.equal(files.some(pattern => pattern.split('/')[0] === dir), false, `${dir}/ must not ship`)
  }
})
