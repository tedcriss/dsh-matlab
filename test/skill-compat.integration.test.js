import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { discoverToolkits } from '../lib/toolkit.js'

/**
 * DSH's filesystem skill provider drops a skill whose frontmatter it cannot
 * accept, and the model catalog shows no per-skill diagnostic — an incompatible
 * skill simply disappears. This test proves the MathWorks catalog does not hit
 * that path: every `SKILL.md` carries a kebab-case `name` equal to its folder
 * and a non-empty `description`.
 */
const installRoot = join(homedir(), '.matlab', 'agentic-toolkits')
const toolkits = await discoverToolkits({ installRoot })
const groups = toolkits.flatMap(toolkit => toolkit.groups)

test('every MathWorks skill is a valid DSH skill', { skip: groups.length === 0 ? 'no Agentic Toolkit installed' : false }, async () => {
  const problems = []
  let count = 0
  for (const group of groups) {
    for (const entry of await readdir(group.path, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      let text
      try {
        text = await readFile(join(group.path, entry.name, 'SKILL.md'), 'utf8')
      } catch {
        // A group may hold support folders such as `scripts`; they are not skills.
        continue
      }
      count += 1
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
      if (frontmatter === null) {
        problems.push(`${group.name}/${entry.name}: no frontmatter`)
        continue
      }
      const name = /^name:\s*(.+)$/mu.exec(frontmatter[1])?.[1]?.trim()
      const description = /^description:\s*(.+)$/mu.exec(frontmatter[1])?.[1]?.trim()
      if (name === undefined || !/^[a-z0-9]+(-[a-z0-9]+)*$/u.test(name)) {
        problems.push(`${group.name}/${entry.name}: invalid name ${String(name)}`)
      } else if (name !== entry.name) {
        problems.push(`${group.name}/${entry.name}: name ${name} differs from its folder`)
      }
      if (description === undefined || description.length === 0) {
        problems.push(`${group.name}/${entry.name}: no description`)
      }
    }
  }
  assert.deepEqual(problems, [])
  assert.ok(count > 0)
})
