#!/usr/bin/env node
/**
 * Publish one release of this plugin.
 *
 * The store installs the plugin from a prebuilt tarball attached to a GitHub
 * Release (`releases/latest/download/dsh-plugin-matlab.tgz`), not from the
 * repository source. That makes the asset part of the release, not an optional
 * extra: a tag without it points the store at a 404. So one command does the
 * whole thing — test, pack, verify the archive's shape, tag, push to both
 * remotes, create the Release, upload the asset, and read the floating URL back
 * to prove it resolves.
 *
 * The version is bumped by hand, before this runs: a release script that also
 * decides the number hides the one decision a maintainer should make on
 * purpose. The command refuses to release unless `package.json` and the tag
 * agree.
 *
 * Usage:
 *   node scripts/release.mjs            # release the version in package.json
 *   node scripts/release.mjs --dry-run  # test and pack, touch no remote
 *
 * Environment:
 *   PNPM           pnpm executable (defaults to `pnpm` on PATH)
 *   GH             gh executable (defaults to `gh` on PATH)
 *   RELEASE_REMOTES  remotes to push the tag to (defaults to `origin gitee`)
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file so the command works from anywhere. */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Where the packed `package/` tarball is written. */
const DIST = join(ROOT, 'dist')
/** The asset name the store entry points at; it must carry no version. */
const ASSET = 'dsh-plugin-matlab.tgz'
/** Files a store install cannot work without. */
const REQUIRED = ['package/package.json', 'package/lib/index.js', 'package/client/client.js', 'package/cordis.patch.yml']
/** A package this close to 60 KB is not this plugin; a bigger one means the trim regressed. */
const MAX_TARBALL_BYTES = 512 * 1024

/** The floating URL a market entry uses; version-free by contract. */
export const TARBALL_URL = 'https://github.com/tedcriss/dsh-matlab/releases/latest/download/dsh-plugin-matlab.tgz'

/**
 * Run one command, inheriting stdio so progress and failures are visible.
 * @param {string} command - executable.
 * @param {readonly string[]} args - arguments.
 * @param {string} [cwd] - working directory.
 * @returns the trimmed stdout.
 */
function run(command, args, cwd = ROOT) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

/** Run one command with its stdout streamed to this terminal as well. */
function runLive(command, args, cwd = ROOT) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

/**
 * Run one command and return stdout even when it fails.
 * @returns the trimmed stdout; the caller decides whether the failure matters.
 */
function attempt(command, args, cwd = ROOT) {
  try {
    return run(command, args, cwd)
  } catch {
    return ''
  }
}

/**
 * The pnpm invocation to use.
 *
 * `PNPM` may name an executable on PATH or the `pnpm.cjs` entry of a bundled
 * pnpm (which is how a DSH install ships it, with no global shim); the latter is
 * run through this Node so no PATH setup is required.
 * @returns the command and the arguments that precede `pack`.
 */
function pnpmInvocation() {
  const configured = process.env.PNPM ?? 'pnpm'
  return /\.(?:cjs|mjs)$/iu.test(configured)
    ? { command: process.execPath, prefix: [configured] }
    : { command: configured, prefix: [] }
}

/** Read the version and name of the package being released. */
async function readManifest() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = String(manifest.version)
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`package.json version is not a stable semver: ${version}`)
  return { name: String(manifest.name), version }
}

/** Refuse to release a tree with uncommitted changes: the tag must name exactly what was tested. */
function assertCleanTree() {
  const status = run('git', ['status', '--porcelain'])
  if (status !== '') {
    throw new Error(`the working tree has uncommitted changes; commit them first so the tag names what was tested:\n${status}`)
  }
}

/** The previous tag, or an empty string when this is the first release. */
function previousTag() {
  return attempt('git', ['describe', '--tags', '--abbrev=0', 'HEAD^'])
}

/** Notes for the Release: the commit subjects since the previous tag. */
function releaseNotes(version, previous) {
  const range = previous === '' ? 'HEAD' : `${previous}..HEAD`
  const subjects = attempt('git', ['log', '--no-merges', '--pretty=format:- %s', range])
  return [
    `dsh-plugin-matlab ${version}`,
    '',
    'Install (store and CLI):',
    TARBALL_URL,
    '',
    subjects === '' ? '- release' : subjects,
  ].join('\n')
}

/** Run the test suite with the Node that runs this script. */
function test() {
  console.log('running the test suite…')
  runLive(process.execPath, ['--test'])
}

/**
 * Pack the package with pnpm, so `files` behaves exactly as it will when a
 * market installs it.
 * @param name - package name, which prefixes the tarball's file name.
 * @param version - the version being released.
 * @returns the absolute path of the packed tarball.
 */
async function pack(name, version) {
  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })
  const pnpm = pnpmInvocation()
  console.log(`packing ${version} with ${pnpm.command}…`)
  runLive(pnpm.command, [...pnpm.prefix, 'pack', '--pack-destination', DIST])
  const packed = join(DIST, `${name}-${version}.tgz`)
  await stat(packed)
  return packed
}

/**
 * Read the archive's file list and check the shape a store install needs.
 * @param tarball - packed `.tgz`.
 * @returns the file names inside.
 */
async function verifyArchive(tarball) {
  const { gunzipSync } = await import('node:zlib')
  const { listTarEntries } = await import('../lib/archive.js')
  const entries = listTarEntries(gunzipSync(await readFile(tarball)))
  const files = entries.filter(entry => entry.type === 'file').map(entry => entry.path)
  const missing = REQUIRED.filter(path => !files.includes(path))
  if (missing.length > 0) throw new Error(`the tarball is missing ${missing.join(', ')}`)
  // The screenshot belongs to the repository's storefront material; shipping it
  // would put 700 KB into every install for no runtime reason.
  if (files.some(path => path.startsWith('package/assets/'))) {
    throw new Error('the tarball ships package/assets/: the package must stay runtime-only')
  }
  if (files.some(path => path.startsWith('package/test'))) {
    throw new Error('the tarball ships package/test/: the package must stay runtime-only')
  }
  return files
}

/** Rename to the version-free asset name, and report its size. */
async function renameAsset(packed) {
  const target = join(DIST, ASSET)
  const { rename } = await import('node:fs/promises')
  await rename(packed, target)
  const size = (await stat(target)).size
  if (size > MAX_TARBALL_BYTES) throw new Error(`${ASSET} is ${String(size)} bytes, above the ${String(MAX_TARBALL_BYTES)}-byte ceiling`)
  return { path: target, size }
}

/** Push the commits and the tag to every configured remote. */
function push(tag) {
  const remotes = (process.env.RELEASE_REMOTES ?? 'origin gitee').split(/\s+/u).filter(Boolean)
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === 'HEAD') throw new Error('detached HEAD: check out the release branch before releasing')
  for (const remote of remotes) {
    console.log(`pushing ${branch} and ${tag} to ${remote}…`)
    runLive('git', ['push', remote, branch])
    runLive('git', ['push', remote, tag])
  }
  return remotes
}

/** Create or refresh the GitHub Release and its tarball asset. */
function publish(tag, notes, assetPath) {
  const gh = process.env.GH ?? 'gh'
  const exists = attempt(gh, ['release', 'view', tag]) !== ''
  if (!exists) {
    console.log(`creating the ${tag} release…`)
    runLive(gh, ['release', 'create', tag, '--title', tag, '--notes', notes])
  }
  console.log(`uploading ${ASSET} to ${tag}…`)
  runLive(gh, ['release', 'upload', tag, assetPath, '--clobber'])
  return exists
}

/**
 * Read the published asset back through its floating URL, which is what the
 * store uses.
 *
 * `releases/latest` and the asset CDN trail the Release by seconds, so the read
 * is retried a few times instead of failing a release whose bytes are fine.
 */
async function verifyPublished() {
  console.log(`reading back ${TARBALL_URL}…`)
  let lastStatus = 0
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(TARBALL_URL, { method: 'GET', redirect: 'follow' })
    lastStatus = response.status
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      console.log(`published ${String(bytes.byteLength)} bytes (sha256 ${digest})`)
      return { bytes: bytes.byteLength, digest }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  throw new Error(`${TARBALL_URL} answered HTTP ${String(lastStatus)} after 6 attempts`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const { name, version } = await readManifest()
  const tag = `v${version}`
  const existing = attempt('git', ['rev-parse', '--verify', '--quiet', tag])
  if (existing !== '') throw new Error(`${tag} already exists; bump package.json before releasing`)
  // A dry run is a packaging check, not a release: allow it on a dirty tree so
  // the archive can be inspected before the commit exists.
  if (!dryRun) assertCleanTree()

  test()
  const packed = await pack(name, version)
  const files = await verifyArchive(packed)
  console.log(`archive: ${String(files.length)} file(s)`)
  const asset = await renameAsset(packed)
  console.log(`asset: ${asset.path} (${String(Math.round(asset.size / 1024))} KB)`)

  if (dryRun) {
    console.log('dry run: no tag, no push, no release')
    return
  }

  const previous = previousTag()
  const notes = releaseNotes(version, previous)
  run('git', ['tag', '-a', tag, '-m', `dsh-plugin-matlab ${version}`])
  push(tag)
  publish(tag, notes, asset.path)
  await verifyPublished()
  console.log(`released ${tag}. The store entry can point at ${TARBALL_URL}`)
}

await main()
