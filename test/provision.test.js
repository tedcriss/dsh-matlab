import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  installToolkit,
  readToolkitRelease,
  releaseArchiveUrl,
  TOOLKIT_SOURCES,
  updateToolkit,
} from '../lib/provision.js'
import { discoverToolkits } from '../lib/toolkit.js'
import { releaseArchive } from '../test-support/tar.js'

const TAGS = { tag: 'MATK-2026.11.a' }

/** A toolkit archive shaped like GitHub's for one release tag. */
function archiveFor(tag = TAGS.tag) {
  return releaseArchive({
    'manifest.yaml': `display-name: "MATLAB Agentic Toolkit"\nskill-groups:\n  - name: core\n    display-name: "Core"\n    path: skills-catalog/core\n    required: true\n`,
    'skills-catalog/core/core-skill/SKILL.md': '---\nname: core-skill\ndescription: d\n---\n',
    // Real archives are megabytes; this keeps the fixture above the "too small
    // to be a toolkit" floor the download applies, with content gzip cannot
    // shrink to nothing.
    'README.md': `# MATLAB Agentic Toolkit\n${Array.from({ length: 400 }, (_, index) => ((index * 2654435761) >>> 0).toString(16)).join(' ')}`,
  }, `matlab-agentic-toolkit-${tag}`)
}

/**
 * A fake GitHub: `releases/latest` answers the tag, the archive URL answers the
 * bytes. `onRequest` may throw to fail one route.
 */
function fakeGithub(options = {}) {
  const requests = []
  const fetchImpl = async (url, init) => {
    requests.push(String(url))
    options.onRequest?.(String(url))
    if (String(url).includes('/api.github.com/')) {
      return new Response(JSON.stringify({ tag_name: options.tag ?? TAGS.tag }), { status: 200 })
    }
    if (String(url).includes('/releases/latest')) {
      return new Response('<html><meta property="og:url" content="/matlab/matlab-agentic-toolkit/releases/tag/MATK-2026.11.a"></html>', { status: 200 })
    }
    return new Response(options.archive ?? archiveFor(options.tag ?? TAGS.tag), {
      status: 200,
      headers: { 'content-type': 'application/x-gzip' },
    })
  }
  return { fetchImpl, requests }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function makeDataRoot(t) {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-release-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('installs the newest release archive through the accelerated routes', async t => {
  const dataRoot = await makeDataRoot(t)
  const github = fakeGithub({
    onRequest: url => {
      if (url.startsWith('https://gh-proxy.com/') && url.endsWith('.tar.gz')) throw new Error('proxy answered 502')
    },
  })

  const installed = await installToolkit({
    kind: 'matlab',
    dataRoot,
    routes: ['https://gh-proxy.com', null],
    fetchImpl: github.fetchImpl,
    log: () => {},
  })

  assert.equal(installed.tag, TAGS.tag)
  assert.equal(installed.route, null)
  assert.equal(installed.root, join(dataRoot, 'toolkits', 'matlab-agentic-toolkit'))
  assert.equal(await exists(join(installed.root, 'manifest.yaml')), true)
  // The top folder of the archive is stripped, so the catalog sits at the root.
  assert.equal(await exists(join(installed.root, 'skills-catalog', 'core', 'core-skill', 'SKILL.md')), true)
  assert.deepEqual(github.requests.filter(url => url.endsWith('.tar.gz')), [
    `https://gh-proxy.com/${releaseArchiveUrl(TOOLKIT_SOURCES.matlab.slug, TAGS.tag)}`,
    releaseArchiveUrl(TOOLKIT_SOURCES.matlab.slug, TAGS.tag),
  ])
})

test('records the installed release so the update check can compare tags', async t => {
  const dataRoot = await makeDataRoot(t)
  const github = fakeGithub()
  const installed = await installToolkit({ kind: 'matlab', dataRoot, routes: [null], fetchImpl: github.fetchImpl, log: () => {} })

  const record = await readToolkitRelease(installed.root)
  assert.equal(record.tag, TAGS.tag)
  assert.equal(record.slug, TOOLKIT_SOURCES.matlab.slug)
  assert.equal(record.files > 0, true)
  assert.equal(typeof record.installedAt, 'string')

  const toolkits = await discoverToolkits({ dataRoots: [dataRoot] })
  assert.equal(toolkits.length, 1)
  assert.equal(toolkits[0].groups[0].name, 'core')
})

test('reports an unknown release for a checkout the plugin did not install', async t => {
  const dataRoot = await makeDataRoot(t)
  const root = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')
  await mkdir(root, { recursive: true })
  assert.equal(await readToolkitRelease(root), undefined)
})

test('reports every route it tried when the archive cannot be fetched', async t => {
  const dataRoot = await makeDataRoot(t)
  const github = fakeGithub({
    onRequest: url => {
      if (url.endsWith('.tar.gz')) throw new Error('HTTP 502')
    },
  })

  await assert.rejects(
    () => installToolkit({
      kind: 'matlab',
      dataRoot,
      routes: ['https://gh-proxy.com', 'https://ghfast.top'],
      fetchImpl: github.fetchImpl,
      log: () => {},
    }),
    /could not download MATLAB Agentic Toolkit MATK-2026\.11\.a: gh-proxy\.com: HTTP 502; ghfast\.top: HTTP 502/u,
  )
  assert.equal(await exists(join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')), false)
  assert.equal(await exists(join(dataRoot, 'toolkits', 'matlab-agentic-toolkit.incoming')), false)
})

test('gives up when the budget is spent instead of trying every route', async t => {
  const dataRoot = await makeDataRoot(t)
  let contacted = 0
  await assert.rejects(
    () => installToolkit({
      kind: 'matlab',
      dataRoot,
      tag: TAGS.tag,
      routes: ['https://gh-proxy.com', null],
      timeoutMs: 0,
      fetchImpl: async () => {
        contacted += 1
        throw new Error('should not be reached')
      },
      log: () => {},
    }),
    /could not download MATLAB Agentic Toolkit MATK-2026\.11\.a: budget of 0 ms spent with 2 route\(s\) untried/u,
  )
  assert.equal(contacted, 0)
})

test('rejects an unknown toolkit kind before any request', async t => {
  const dataRoot = await makeDataRoot(t)
  let contacted = 0
  await assert.rejects(
    () => installToolkit({
      kind: 'octave',
      dataRoot,
      fetchImpl: async () => {
        contacted += 1
        return new Response('')
      },
      log: () => {},
    }),
    /unknown toolkit kind octave/u,
  )
  assert.equal(contacted, 0)
})

test('rejects a payload that is not a toolkit archive', async t => {
  const dataRoot = await makeDataRoot(t)
  const github = fakeGithub({ archive: Buffer.from('<html>rate limited</html>') })
  await assert.rejects(
    () => installToolkit({ kind: 'matlab', dataRoot, routes: [null], fetchImpl: github.fetchImpl, log: () => {} }),
    /not a gzip archive|only 25 bytes/u,
  )
})

test('an update replaces the catalog only after a complete extraction', async t => {
  const dataRoot = await makeDataRoot(t)
  const destination = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')
  // The previous install: a file the new one must not inherit.
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'old.txt'), 'old')
  const incoming = `${destination}.incoming`

  const github = fakeGithub()
  const installed = await updateToolkit({
    kind: 'matlab',
    dataRoot,
    routes: [null],
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('.tar.gz')) assert.equal(await exists(incoming), false, 'the live catalog is never the extraction target')
      return await github.fetchImpl(url, init)
    },
    log: () => {},
  })

  assert.equal(installed.root, destination)
  assert.equal(await exists(join(destination, 'manifest.yaml')), true)
  assert.equal(await exists(join(destination, 'old.txt')), false)
  assert.equal(await exists(incoming), false)
})

test('a failed update keeps the previous catalog and its files', async t => {
  const dataRoot = await makeDataRoot(t)
  const destination = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'old.txt'), 'old')

  const github = fakeGithub({
    onRequest: url => {
      if (url.endsWith('.tar.gz')) throw new Error('early EOF')
    },
  })
  await assert.rejects(
    () => updateToolkit({
      kind: 'matlab',
      dataRoot,
      routes: ['https://gh-proxy.com', null],
      fetchImpl: github.fetchImpl,
      log: () => {},
    }),
    /gh-proxy\.com: early EOF; direct: early EOF/u,
  )

  assert.equal(await exists(join(destination, 'old.txt')), true)
  assert.equal(await exists(`${destination}.incoming`), false)
})

test('an install leaves an existing catalog alone', async t => {
  const dataRoot = await makeDataRoot(t)
  const destination = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit')
  await mkdir(destination, { recursive: true })
  await writeFile(join(destination, 'old.txt'), 'old')
  await writeFile(join(destination, '.dsh-matlab-release.json'), JSON.stringify({ tag: 'MATK-2026.10.a' }))

  const github = fakeGithub()
  const installed = await installToolkit({ kind: 'matlab', dataRoot, routes: [null], fetchImpl: github.fetchImpl, log: () => {} })

  assert.equal(installed.reused, true)
  assert.equal(installed.tag, 'MATK-2026.10.a')
  assert.equal(await exists(join(destination, 'old.txt')), true)
  assert.equal(await exists(`${destination}.incoming`), false)
})

test('a half-written incoming catalog is not a toolkit', async t => {
  const dataRoot = await makeDataRoot(t)
  const incoming = join(dataRoot, 'toolkits', 'matlab-agentic-toolkit.incoming')
  await mkdir(join(incoming, 'skills-catalog', 'core', 'core-skill'), { recursive: true })
  await writeFile(join(incoming, 'skills-catalog', 'core', 'core-skill', 'SKILL.md'), '---\nname: core-skill\ndescription: d\n---\n')
  await writeFile(join(incoming, 'manifest.yaml'), 'display-name: "MATLAB"\nskill-groups:\n  - name: core\n    path: skills-catalog/core\n')

  const toolkits = await discoverToolkits({ dataRoots: [dataRoot] })
  assert.deepEqual(toolkits, [])
})

test('reads the archive URL for a tag with dots and dashes', () => {
  assert.equal(
    releaseArchiveUrl('matlab/matlab-agentic-toolkit', 'MATK-2026.11.a'),
    'https://github.com/matlab/matlab-agentic-toolkit/archive/refs/tags/MATK-2026.11.a.tar.gz',
  )
  assert.equal(
    releaseArchiveUrl('matlab/matlab-agentic-toolkit', 'tag/with space'),
    'https://github.com/matlab/matlab-agentic-toolkit/archive/refs/tags/tag%2Fwith%20space.tar.gz',
  )
})

test('the marker is readable JSON inside the installed catalog', async t => {
  const dataRoot = await makeDataRoot(t)
  const github = fakeGithub()
  const installed = await installToolkit({ kind: 'matlab', dataRoot, routes: [null], fetchImpl: github.fetchImpl, log: () => {} })
  const text = await readFile(join(installed.root, '.dsh-matlab-release.json'), 'utf8')
  assert.equal(JSON.parse(text).tag, TAGS.tag)
})
