import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createSha256,
  declaredBodyLength,
  parseAssetDigest,
  sameDigest,
  sha256Hex,
} from '../lib/integrity.js'

/** The published digest of the ASCII string `abc`. */
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

test('parses the sha256 digest GitHub publishes for a release asset', () => {
  assert.equal(parseAssetDigest(`sha256:${ABC}`), ABC)
  assert.equal(parseAssetDigest(`SHA256:${ABC.toUpperCase()}`), ABC)
  assert.equal(parseAssetDigest(`sha256:${ABC} `.trim()), ABC)
})

test('reports a digest it cannot verify as unknown', () => {
  assert.equal(parseAssetDigest(undefined), undefined)
  assert.equal(parseAssetDigest(null), undefined)
  assert.equal(parseAssetDigest(''), undefined)
  assert.equal(parseAssetDigest(ABC), undefined, 'the algorithm must be named')
  assert.equal(parseAssetDigest(`sha512:${ABC}`), undefined)
  assert.equal(parseAssetDigest('sha256:not-hex'), undefined)
  assert.equal(parseAssetDigest(`sha256:${ABC.slice(2)}`), undefined)
})

test('hashes buffers and streams to the same sha256', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), ABC)
  const streamed = createSha256()
  streamed.update(Buffer.from('a'))
  streamed.update(Buffer.from('b'))
  streamed.update(Buffer.from('c'))
  assert.equal(streamed.hex(), ABC)
})

test('compares digests without accepting a prefix or a non-digest', () => {
  assert.equal(sameDigest(ABC, ABC), true)
  assert.equal(sameDigest(ABC.toUpperCase(), ABC), false, 'callers normalize before comparing')
  assert.equal(sameDigest(ABC, `${ABC.slice(0, -1)}0`), false)
  assert.equal(sameDigest(ABC, 'abc'), false)
  assert.equal(sameDigest(undefined, ABC), false)
})

test('reads a declared length only when it describes the received bytes', () => {
  const headers = values => ({ get: name => values[name] ?? null })
  assert.equal(declaredBodyLength(headers({ 'content-length': '1200' })), 1200)
  assert.equal(declaredBodyLength(headers({ 'content-length': '1200', 'content-encoding': 'identity' })), 1200)
  // A compressed body's content-length counts bytes `fetch` has already decoded.
  assert.equal(declaredBodyLength(headers({ 'content-length': '900', 'content-encoding': 'gzip' })), undefined)
  assert.equal(declaredBodyLength(headers({})), undefined)
  assert.equal(declaredBodyLength(headers({ 'content-length': '0' })), undefined)
  assert.equal(declaredBodyLength(headers({ 'content-length': 'not a number' })), undefined)
  assert.equal(declaredBodyLength(undefined), undefined)
})
