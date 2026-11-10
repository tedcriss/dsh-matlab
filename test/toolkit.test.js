import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { countSkills, discoverToolkits, readToolkit, selectSkillGroups } from '../lib/toolkit.js'

/** Build one toolkit checkout shaped like MathWorks ships it. */
async function makeToolkit(parent, name, { manifest, groups, extensions = [] }) {
  const root = join(parent, name)
  await mkdir(join(root, 'skills-catalog'), { recursive: true })
  for (const group of groups) {
    const groupDir = join(root, 'skills-catalog', group.name)
    await mkdir(join(groupDir, 'skill-a'), { recursive: true })
    await writeFile(join(groupDir, 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: A\n---\n')
    await writeFile(join(groupDir, 'skill-a', 'manifest.yaml'), 'schema-version: 1\n')
    await mkdir(join(groupDir, 'scripts'), { recursive: true })
    await writeFile(join(groupDir, 'plugin.yaml'), 'display-name: x\n')
    if (group.required === true) continue
    await writeFile(join(groupDir, 'extra.txt'), '')
  }
  for (const extension of extensions) {
    await mkdir(join(root, extension, '..'), { recursive: true }).catch(() => {})
  }
  if (manifest !== undefined) await writeFile(join(root, 'manifest.yaml'), manifest)
  return root
}

const MANIFEST = `display-name: "Example Agentic Toolkit"
skill-groups:
  - name: core
    display-name: "Core"
    description: Core group
    path: skills-catalog/core
    required: true
  - name: extra
    display-name: "Extra"
    description: Extra group
    path: skills-catalog/extra
`

test('reads declared groups and counts skills, not support folders', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'matlab-agentic-toolkit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }, { name: 'extra' }],
  })
  const toolkit = await readToolkit(root)
  assert.equal(toolkit.kind, 'matlab')
  assert.equal(toolkit.displayName, 'Example Agentic Toolkit')
  assert.deepEqual(toolkit.groups.map(group => group.name), ['core', 'extra'])
  assert.equal(await countSkills(toolkit.groups[0].path), 1)
  assert.deepEqual(toolkit.extensionFiles, [])
})

test('skips a manifest group whose folder is absent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'toolkit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }],
  })
  const toolkit = await readToolkit(root)
  assert.deepEqual(toolkit.groups.map(group => group.name), ['core'])
})

test('falls back to catalog folders when a checkout has no manifest', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'trimmed', {
    groups: [{ name: 'matlab-core', required: true }, { name: 'radar' }],
  })
  const toolkit = await readToolkit(root)
  assert.deepEqual(toolkit.groups.map(group => group.name).sort(), ['matlab-core', 'radar'])
  assert.equal(toolkit.groups.find(group => group.name === 'matlab-core').required, true)
})

test('resolves extension files against the toolkit root', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'simulink-agentic-toolkit', {
    manifest: 'display-name: "Simulink Agentic Toolkit"\nmcp-server-extensions:\n  - name: x\n    path: tools/tools.json\nskill-groups:\n  - name: core\n    path: skills-catalog/core\n',
    groups: [{ name: 'core' }],
  })
  const toolkit = await readToolkit(root)
  assert.equal(toolkit.kind, 'simulink')
  assert.deepEqual(toolkit.extensionFiles, [join(root, 'tools', 'tools.json')])
})

test('scans one and two levels of the plugin data folder', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-install-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await makeToolkit(dir, 'matlab-agentic-toolkit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }],
  })
  await mkdir(join(dir, 'bin'), { recursive: true })
  await makeToolkit(join(dir, 'nested'), 'simulink-agentic-toolkit', {
    manifest: 'display-name: "Simulink Agentic Toolkit"\nskill-groups:\n  - name: sm-core\n    path: skills-catalog/sm-core\n',
    groups: [{ name: 'sm-core', required: true }],
  })
  const toolkits = await discoverToolkits({ dataRoots: [dir] })
  assert.deepEqual(toolkits.map(toolkit => toolkit.kind).sort(), ['matlab', 'simulink'])
})

test('explicit roots win and unknown explicit roots fail loud', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'explicit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }],
  })
  const toolkits = await discoverToolkits({ explicitRoots: [root], dataRoots: [join(dir, 'missing')] })
  assert.equal(toolkits.length, 1)
  await assert.rejects(
    () => discoverToolkits({ explicitRoots: [join(dir, 'nope')] }),
    /toolkitRoots entry is not a directory/u,
  )
})

test('empty selection loads every group, including groups the toolkit does not mark required', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'toolkit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }, { name: 'extra' }],
  })
  const toolkits = [await readToolkit(root)]
  assert.deepEqual(selectSkillGroups(toolkits, []).groups.map(group => group.name), ['core', 'extra'])
  assert.deepEqual(selectSkillGroups(toolkits, ['extra']).groups.map(group => group.name), ['extra'])
  assert.deepEqual(selectSkillGroups(toolkits, ['core', 'nope']).unknown, ['nope'])
})

test('a star selects every group, including one toolkit missing from the installer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = await makeToolkit(dir, 'toolkit', {
    manifest: MANIFEST,
    groups: [{ name: 'core', required: true }, { name: 'extra' }],
  })
  const toolkits = [await readToolkit(root)]
  const selection = selectSkillGroups(toolkits, ['*'])
  assert.deepEqual(selection.groups.map(group => group.name), ['core', 'extra'])
  assert.deepEqual(selection.unknown, [])
  // A star plus a name does not duplicate the named group.
  assert.equal(selectSkillGroups(toolkits, ['*', 'extra']).groups.length, 2)
  assert.deepEqual(selectSkillGroups(toolkits, ['*', 'nope']).unknown, ['nope'])
})

test('follows a symlinked group folder instead of dropping it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const real = await makeToolkit(dir, 'real', {
    groups: [{ name: 'linked-group', required: true }],
  })
  const root = join(dir, 'linked')
  await mkdir(join(root, 'skills-catalog'), { recursive: true })
  await symlink(join(real, 'skills-catalog', 'linked-group'), join(root, 'skills-catalog', 'linked-group'), 'junction')
  const toolkit = await readToolkit(root)
  assert.deepEqual(toolkit.groups.map(group => group.name), ['linked-group'])
  assert.equal(await countSkills(toolkit.groups[0].path), 1)
})

test('a single skill linked as a root counts as one skill, not zero', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'matlab-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const real = await makeToolkit(dir, 'real', { groups: [{ name: 'core', required: true }] })
  const skill = join(real, 'skills-catalog', 'core', 'skill-a')
  assert.equal(await countSkills(skill), 1)
})
