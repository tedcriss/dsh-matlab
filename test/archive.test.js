import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extractTarGz, isGzip, listTarEntries } from '../lib/archive.js'
import { buildTar, buildTarGz } from '../test-support/tar.js'

async function makeDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-archive-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('reads a gzip magic and rejects anything else', () => {
  assert.equal(isGzip(Buffer.from([0x1f, 0x8b, 0x08])), true)
  assert.equal(isGzip(Buffer.from('<!DOCTYPE html>')), false)
  assert.equal(isGzip(Buffer.alloc(0)), false)
})

test('extracts a release archive under one top folder, stripping it', async t => {
  const destination = await makeDir(t)
  const archive = buildTarGz([
    { path: 'matlab-agentic-toolkit-MATK-2026.11.a/', type: '5' },
    { path: 'matlab-agentic-toolkit-MATK-2026.11.a/manifest.yaml', content: 'display-name: "MATLAB"\n' },
    { path: 'matlab-agentic-toolkit-MATK-2026.11.a/skills-catalog/core/a/SKILL.md', content: '# a\n' },
    { path: 'matlab-agentic-toolkit-MATK-2026.11.a/tools/run.sh', content: '#!/bin/sh\n', mode: 0o755 },
  ])

  const result = await extractTarGz(archive, { destination, stripComponents: 1 })

  assert.equal(result.files, 3)
  assert.equal((await readFile(join(destination, 'manifest.yaml'), 'utf8')).startsWith('display-name'), true)
  assert.equal((await readFile(join(destination, 'skills-catalog', 'core', 'a', 'SKILL.md'), 'utf8')), '# a\n')
  assert.equal((await stat(join(destination, 'tools', 'run.sh'))).isFile(), true)
})

test('lists entries without writing them', () => {
  const entries = listTarEntries(buildTar([
    { path: 'top/', type: '5' },
    { path: 'top/file.txt', content: 'x' },
  ]))
  assert.deepEqual(entries.map(entry => [entry.path, entry.type]), [['top/', 'directory'], ['top/file.txt', 'file']])
})

test('keeps a long pax path instead of truncating it', async t => {
  const destination = await makeDir(t)
  const long = `top/skills-catalog/${'very-long-folder-name-'.repeat(6)}skill/SKILL.md`
  const archive = buildTarGz([
    { path: 'top/', type: '5' },
    { path: long, content: '# long\n', longPath: true },
  ])

  await extractTarGz(archive, { destination, stripComponents: 1 })
  assert.equal(await readFile(join(destination, long.slice(4)), 'utf8'), '# long\n')
})

test('refuses an entry that escapes the destination', async t => {
  const destination = await makeDir(t)
  const archive = buildTarGz([
    { path: 'top/ok.txt', content: 'ok' },
    { path: 'top/../escaped.txt', content: 'no' },
  ])

  await assert.rejects(
    () => extractTarGz(archive, { destination, stripComponents: 1 }),
    /escapes the destination: top\/\.\.\/escaped\.txt/u,
  )
})

test('drops a symlink that points outside the toolkit', async t => {
  const destination = await makeDir(t)
  const archive = buildTarGz([
    { path: 'top/link', type: '2', link: '../../outside' },
    { path: 'top/ok.txt', content: 'ok' },
  ])

  const result = await extractTarGz(archive, { destination, stripComponents: 1 })
  assert.equal(result.files, 1)
  assert.equal(result.skipped, 1)
})

test('rejects a payload that is not gzip', async t => {
  const destination = await makeDir(t)
  await assert.rejects(
    () => extractTarGz(Buffer.from('<html>not an archive</html>'), { destination }),
    /not a gzip archive/u,
  )
})

test('rejects a truncated tar payload', async t => {
  const destination = await makeDir(t)
  const complete = buildTarGz([{ path: 'top/big.txt', content: 'x'.repeat(2048) }])
  // Corrupt the header's size field so the body appears to run past the end.
  const { gunzipSync, gzipSync } = await import('node:zlib')
  const tar = gunzipSync(complete)
  tar.write('00000077777\0', 124, 'latin1')
  let sum = 0
  for (let index = 0; index < 512; index += 1) sum += (index >= 148 && index < 156) ? 0x20 : tar[index]
  tar.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1')

  await assert.rejects(
    () => extractTarGz(gzipSync(tar), { destination }),
    /truncated|escapes/u,
  )
})
