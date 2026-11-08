import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDisplayName, parseMcpServerExtensions, parseSkillGroups } from '../lib/yaml-mini.js'

const MANIFEST = `# Copyright 2026 The MathWorks, Inc.
schema_version: 1

display-name: "Example Agentic Toolkit"
description: "AI skills for examples"

mcp-server-extensions:
  - name: example-agentic-toolkit
    server: matlab
    path: tools/tools.json

skill-groups:
  - name: example-core
    display-name: "Example Core"
    description: >-
      Create, debug, and manage example code.
      Every toolkit user needs these
    path: skills-catalog/example-core
    required: true
    requires-products:
      - Simulink

  - name: example-modeling
    display-name: Example Modeling
    description: "Configuring #1 models"
    path: skills-catalog/example-modeling
`

test('reads the declared display name', () => {
  assert.equal(parseDisplayName(MANIFEST), 'Example Agentic Toolkit')
})

test('reads skill groups with folded descriptions and required flags', () => {
  const groups = parseSkillGroups(MANIFEST)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0], {
    name: 'example-core',
    displayName: 'Example Core',
    description: 'Create, debug, and manage example code. Every toolkit user needs these',
    path: 'skills-catalog/example-core',
    required: true,
    requiresProducts: [],
  })
  assert.equal(groups[1].required, false)
  // A `#` inside a quoted value is content, not a comment.
  assert.equal(groups[1].description, 'Configuring #1 models')
})

test('reads MCP extension files without leaking later sections', () => {
  assert.deepEqual(parseMcpServerExtensions(MANIFEST), ['tools/tools.json'])
})

test('reports absent sections as undefined instead of empty', () => {
  assert.equal(parseSkillGroups('display-name: X\n'), undefined)
  assert.equal(parseMcpServerExtensions('skill-groups:\n  - name: a\n'), undefined)
})

test('ignores commented-out group entries', () => {
  const text = `skill-groups:
  # - name: commented
  - name: real
    required: yes
`
  const groups = parseSkillGroups(text)
  assert.deepEqual(groups.map(group => group.name), ['real'])
  assert.equal(groups[0].required, true)
})
