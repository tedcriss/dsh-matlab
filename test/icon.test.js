import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const icon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/** Path data, whitespace-normalized, from an SVG attribute list. */
const svgPaths = [...icon.matchAll(/\bd="([^"]+)"/gu)].map(match => match[1].replace(/\s+/gu, ' ').trim())

/** Path data, whitespace-normalized, from the inline icon in the client module. */
const clientPaths = [...client.matchAll(/\bd: '([^']+)'/gu)].map(match => match[1].replace(/\s+/gu, ' ').trim())

test('the package icon is the MATLAB mark as vector artwork', () => {
  assert.match(icon, /viewBox="0 0 64 64"/u)
  assert.match(icon, /aria-label="MATLAB"/u)
  assert.equal(svgPaths.length, 4)
})

test('the Settings icon draws the same artwork as the package icon', () => {
  assert.deepEqual(new Set(clientPaths), new Set(svgPaths))
  for (const [, color] of icon.matchAll(/stop-color="(#[0-9A-Fa-f]+)"/gu)) {
    assert.ok(client.toLowerCase().includes(color.toLowerCase()), `the Settings icon is missing ${color}`)
  }
})
