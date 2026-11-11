/**
 * Extract a GitHub release source archive.
 *
 * MathWorks publishes the toolkits as releases whose only downloadable form is
 * the source archive GitHub generates for the tag (`archive/refs/tags/<tag>.tar.gz`)
 * — the releases carry no asset of their own. Reading that archive needs a tar
 * reader, and `node:zlib` already covers the compression half, so the plugin
 * keeps no external dependency and no `git` requirement for a first install.
 *
 * Only what a GitHub source archive contains is supported: regular files,
 * directories, symbolic links, and the pax / GNU long-name headers that carry
 * paths longer than 100 bytes. Paths are validated before anything is written,
 * so an archive cannot escape its destination.
 *
 * @module dsh-plugin-matlab/archive
 */

import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

/** Tar records are this long; a payload is padded to the same boundary. */
const BLOCK_SIZE = 512

/** Tar header field offsets. */
const OFFSETS = {
  name: 0,
  mode: 100,
  size: 124,
  mtime: 136,
  checksum: 148,
  type: 156,
  linkName: 157,
  magic: 257,
  prefix: 345,
}

/** Type flags this reader understands; anything else is skipped rather than written. */
const TYPE = {
  file: '0',
  hardLink: '1',
  symlink: '2',
  directory: '5',
  paxNext: 'x',
  paxGlobal: 'g',
  gnuLongName: 'L',
  gnuLongLink: 'K',
}

/**
 * Whether a payload starts like a gzip stream.
 * @param buffer - downloaded bytes.
 * @returns true when the two gzip magic bytes are present.
 */
export function isGzip(buffer) {
  return Buffer.isBuffer(buffer) && buffer.byteLength > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

/** Read a NUL-terminated text field. */
function readText(block, offset, length) {
  const field = block.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
}

/**
 * Read a numeric header field.
 *
 * Tar writes numbers as zero-padded octal, but GNU tar switches to a base-256
 * encoding for values that do not fit, so both spellings are accepted.
 */
function readNumber(block, offset, length) {
  const field = block.subarray(offset, offset + length)
  if ((field[0] & 0x80) !== 0) {
    // Base-256: big-endian, with the high bit of the first byte as the marker.
    let value = field[0] & 0x7f
    for (let index = 1; index < field.length; index += 1) value = value * 256 + field[index]
    return value
  }
  const text = field.toString('latin1').replace(/\0.*$/u, '').trim()
  if (text === '') return 0
  const value = Number.parseInt(text, 8)
  return Number.isFinite(value) ? value : 0
}

/**
 * Verify a header's checksum.
 *
 * The checksum is the sum of every header byte with the checksum field itself
 * read as spaces. Rejecting a bad one is what keeps a truncated or non-tar
 * payload from being written as a nonsense file tree.
 */
function hasValidChecksum(block) {
  const stored = readNumber(block, OFFSETS.checksum, 8)
  let sum = 0
  for (let index = 0; index < BLOCK_SIZE; index += 1) {
    // The checksum field counts as spaces while it is being computed.
    const inChecksum = index >= OFFSETS.checksum && index < OFFSETS.checksum + 8
    sum += inChecksum ? 0x20 : block[index]
  }
  return sum === stored
}

/** Parse pax `length key=value\n` records into a map. */
function parsePaxRecords(text) {
  const values = new Map()
  let offset = 0
  while (offset < text.length) {
    const space = text.indexOf(' ', offset)
    if (space === -1) break
    const length = Number.parseInt(text.slice(offset, space), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = text.slice(space + 1, offset + length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) values.set(record.slice(0, equals), record.slice(equals + 1))
    offset += length
  }
  return values
}

/**
 * Read the entries of an uncompressed tar payload.
 *
 * Metadata entries (pax headers, GNU long names) are folded into the file entry
 * they describe, so the caller sees one record per real path.
 * @param tar - uncompressed tar bytes.
 * @returns entries in archive order, each `{ path, type, mode, size, link, data }`.
 */
export function listTarEntries(tar) {
  const entries = []
  let offset = 0
  let pendingName
  let pendingLink
  let pendingPax = new Map()
  while (offset + BLOCK_SIZE <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK_SIZE)
    if (header.every(byte => byte === 0)) {
      // A zero block is the end marker; trailing padding is not a header.
      break
    }
    if (!hasValidChecksum(header)) {
      throw new Error(`the release archive is corrupt: bad header checksum at byte ${String(offset)}`)
    }
    const type = String.fromCharCode(header[OFFSETS.type])
    const size = readNumber(header, OFFSETS.size, 12)
    const bodyStart = offset + BLOCK_SIZE
    const bodyEnd = bodyStart + size
    if (bodyEnd > tar.byteLength) throw new Error('the release archive is truncated')
    const body = tar.subarray(bodyStart, bodyEnd)
    offset = bodyStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE

    if (type === TYPE.gnuLongName) {
      pendingName = body.toString('utf8').replace(/\0.*$/u, '')
      continue
    }
    if (type === TYPE.gnuLongLink) {
      pendingLink = body.toString('utf8').replace(/\0.*$/u, '')
      continue
    }
    if (type === TYPE.paxNext) {
      pendingPax = parsePaxRecords(body.toString('utf8'))
      continue
    }
    if (type === TYPE.paxGlobal) continue

    const prefix = readText(header, OFFSETS.prefix, 155)
    const name = readText(header, OFFSETS.name, 100)
    const path = pendingName ?? pendingPax.get('path') ?? (prefix === '' ? name : `${prefix}/${name}`)
    const link = pendingLink ?? pendingPax.get('linkpath') ?? readText(header, OFFSETS.linkName, 100)
    const declaredSize = pendingPax.get('size')
    const mode = readNumber(header, OFFSETS.mode, 8)
    pendingName = undefined
    pendingLink = undefined
    pendingPax = new Map()

    if (type === TYPE.file || type === '\0' || type === undefined) {
      entries.push({ path, type: 'file', mode, size: declaredSize === undefined ? size : Number(declaredSize), link, data: body })
      continue
    }
    if (type === TYPE.directory) {
      entries.push({ path, type: 'directory', mode, size: 0, link: '', data: undefined })
      continue
    }
    if (type === TYPE.symlink) {
      entries.push({ path, type: 'symlink', mode, size: 0, link, data: undefined })
      continue
    }
    // Hard links, devices, and FIFOs are not part of a GitHub source archive.
  }
  return entries
}

/**
 * Normalize one archive path into destination-relative segments.
 * @param path - path recorded in the archive.
 * @param strip - leading segments to drop, such as the release's top folder.
 * @returns the remaining segments, or an empty list for the stripped root.
 * @throws when the path could escape the destination.
 */
export function relativeSegments(path, strip = 0) {
  const segments = String(path).split('/').filter(segment => segment !== '' && segment !== '.')
  for (const segment of segments) {
    if (segment === '..') throw new Error(`archive entry escapes the destination: ${path}`)
    if (segment.includes('\\')) throw new Error(`archive entry is not a POSIX path: ${path}`)
    if (/^[A-Za-z]:/u.test(segment)) throw new Error(`archive entry is an absolute path: ${path}`)
  }
  return segments.slice(strip)
}

/** Whether a resolved path stays under a root. */
function isInside(root, path) {
  const relative = resolve(path).slice(resolve(root).length)
  return relative === '' || relative.startsWith(sep) || relative.startsWith('/')
}

/**
 * Extract a `.tar.gz` payload into a directory.
 *
 * Staging directories are empty by construction, so a plain write is enough;
 * executable bits are preserved because the toolkits ship helper scripts.
 * @param archive - the gzip payload.
 * @param options - destination and the number of leading segments to strip.
 * @returns how many files were written, their total bytes, and what was skipped.
 */
export async function extractTarGz(archive, options) {
  if (!isGzip(archive)) throw new Error('the download is not a gzip archive')
  let tar
  try {
    tar = gunzipSync(archive)
  } catch (cause) {
    throw new Error(`could not decompress the release archive: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const root = resolve(options.destination)
  const strip = options.stripComponents ?? 0
  await mkdir(root, { recursive: true })
  let files = 0
  let bytes = 0
  let skipped = 0
  for (const entry of listTarEntries(tar)) {
    let segments
    try {
      segments = relativeSegments(entry.path, strip)
    } catch (cause) {
      // One hostile path invalidates the whole archive: a partial tree taken
      // from a payload somebody planted is not a toolkit.
      throw cause
    }
    if (segments.length === 0) continue
    const target = join(root, ...segments)
    if (!isInside(root, target)) throw new Error(`archive entry escapes the destination: ${entry.path}`)
    if (entry.type === 'directory') {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    if (entry.type === 'file') {
      await writeFile(target, entry.data)
      if ((entry.mode & 0o111) !== 0) await chmod(target, 0o755)
      files += 1
      bytes += entry.size
      continue
    }
    if (entry.type === 'symlink') {
      // A link is only recreated when its target stays inside the toolkit;
      // creating a privileged or escaping link is not worth an install.
      const linkTarget = join(dirname(target), entry.link)
      if (entry.link === '' || !isInside(root, linkTarget)) {
        skipped += 1
        continue
      }
      try {
        await symlink(entry.link, target)
        files += 1
      } catch {
        // Windows without developer mode refuses symlinks; a skill tree that
        // needs one is reported by discovery, not by failing the whole install.
        skipped += 1
      }
    }
  }
  return { files, bytes, skipped }
}
