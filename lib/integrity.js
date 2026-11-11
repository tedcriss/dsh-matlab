/**
 * Integrity checks for the artifacts this plugin downloads.
 *
 * Two questions are separate:
 *
 * - **Is the transfer complete?** A body that ends early still looks like a
 *   file, so a declared length that disagrees with the received byte count is
 *   refused. This also catches a proxy that truncates a large response.
 * - **Are these the published bytes?** GitHub states a `sha256` digest for every
 *   release asset. The digest is hashed while the body streams to disk and the
 *   install is refused on a mismatch, so a mirror that replaces the binary (or
 *   answers with its own page) never becomes the program DSH runs.
 *
 * The digest lives in the GitHub release API, which is requested directly
 * first; see {@link module:dsh-plugin-matlab/updates.releaseAssets}. A mirror
 * that serves the download should not also be the only source of the hash that
 * vouches for it.
 *
 * @module dsh-plugin-matlab/integrity
 */

import { createHash, timingSafeEqual } from 'node:crypto'

/** A digest GitHub accepts and this module understands. */
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/iu

/**
 * Read the hex half of a GitHub asset digest.
 *
 * The API spells it `sha256:<hex>`. Anything else — a missing digest, an
 * algorithm this plugin cannot verify, a truncated value — is reported as
 * "unknown" so the caller can decide whether to install unverified rather than
 * trusting a hash it cannot check.
 * @param value - the asset's `digest` field.
 * @returns lowercase hex, or `undefined`.
 */
export function parseAssetDigest(value) {
  if (typeof value !== 'string') return undefined
  const match = SHA256_DIGEST.exec(value.trim())
  return match === null ? undefined : match[1].toLowerCase()
}

/**
 * Hash a buffer the way GitHub's asset digest does.
 * @param buffer - bytes to hash.
 * @returns lowercase SHA-256 hex.
 */
export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Start a streaming SHA-256 computation.
 *
 * The binary is written chunk by chunk, so hashing the same chunks costs no
 * second read. `hex()` may be called once, after the last chunk.
 * @returns `{ update, hex }`.
 */
export function createSha256() {
  const hash = createHash('sha256')
  return {
    update(chunk) {
      hash.update(chunk)
      return this
    },
    hex() {
      return hash.digest('hex')
    },
  }
}

/**
 * Compare two SHA-256 hex digests without leaking their difference by timing.
 * @param expected - published digest.
 * @param actual - digest of the received bytes.
 * @returns true when both name the same digest.
 */
export function sameDigest(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false
  if (!/^[0-9a-f]{64}$/u.test(expected) || !/^[0-9a-f]{64}$/u.test(actual)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

/**
 * The body length a response declares, when that number describes the received
 * bytes.
 *
 * `content-length` counts the encoded body, while `fetch` hands the caller the
 * decoded one, so a compressed response would fail a check that looked
 * complete. Only an identity response is measured; the release digest (and the
 * size beside it) covers the rest.
 * @param headers - a Fetch `Headers` object.
 * @returns a positive byte count, or `undefined`.
 */
export function declaredBodyLength(headers) {
  const encoding = String(headers?.get?.('content-encoding') ?? '').trim().toLowerCase()
  if (encoding !== '' && encoding !== 'identity') return undefined
  const declared = Number(headers?.get?.('content-length'))
  return Number.isFinite(declared) && declared > 0 ? declared : undefined
}
