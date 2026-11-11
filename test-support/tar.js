/**
 * Build tar and tar.gz payloads for tests.
 *
 * The plugin's archive reader is exercised against bytes it would really
 * receive, so the fixture builder writes the same ustar/POSIX headers GitHub's
 * archive generator does, including pax records for long paths.
 */

import { gzipSync } from 'node:zlib'

/** Write one NUL-padded fixed-width field. */
function field(buffer, offset, length, text) {
  buffer.write(text.slice(0, length), offset, length, 'utf8')
}

/** Write a zero-padded octal number field. */
function octal(buffer, offset, length, value) {
  field(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`)
}

/**
 * Build one tar header block.
 * @param entry - `{ name, size, mode, type, link, prefix }`.
 * @returns a 512-byte header.
 */
function header(entry) {
  const block = Buffer.alloc(512, 0)
  field(block, 0, 100, entry.name)
  octal(block, 100, 8, entry.mode ?? 0o644)
  octal(block, 108, 8, 0)
  octal(block, 116, 8, 0)
  octal(block, 124, 12, entry.size)
  octal(block, 136, 12, 0)
  block.fill(0x20, 148, 156)
  field(block, 156, 1, entry.type ?? '0')
  field(block, 157, 100, entry.link ?? '')
  field(block, 257, 6, 'ustar\0')
  field(block, 263, 2, '00')
  field(block, 265, 32, 'root')
  field(block, 297, 32, 'root')
  field(block, 329, 8, '0000000\0')
  field(block, 337, 8, '0000000\0')
  field(block, 345, 155, entry.prefix ?? '')
  let sum = 0
  for (const byte of block) sum += byte
  field(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `)
  return block
}

/** Pad a payload to the next 512-byte boundary. */
function pad(body) {
  const remainder = body.byteLength % 512
  return remainder === 0 ? body : Buffer.concat([body, Buffer.alloc(512 - remainder, 0)])
}

/**
 * Build an uncompressed tar payload.
 * @param entries - objects with `{ path, type, content, mode, link }`.
 * @returns the tar bytes, terminated by two zero blocks.
 */
export function buildTar(entries) {
  const blocks = []
  for (const entry of entries) {
    const content = entry.content === undefined ? Buffer.alloc(0) : Buffer.from(entry.content, 'utf8')
    if (entry.longPath === true) {
      // A pax `path` record is how GitHub stores paths over 100 bytes.
      const record = `path=${entry.path}`
      const length = Buffer.byteLength(record) + String(Buffer.byteLength(record)).length + 2
      const body = Buffer.from(`${length} ${record}\n`, 'utf8')
      blocks.push(header({ name: 'PaxHeader', size: body.byteLength, type: 'x' }), pad(body))
      const short = entry.path.slice(0, 90)
      blocks.push(header({ name: short, size: content.byteLength, type: entry.type ?? '0', mode: entry.mode, link: entry.link }), pad(content))
      continue
    }
    blocks.push(header({
      name: entry.path,
      size: content.byteLength,
      type: entry.type ?? '0',
      mode: entry.mode,
      link: entry.link,
    }), pad(content))
  }
  blocks.push(Buffer.alloc(512, 0), Buffer.alloc(512, 0))
  return Buffer.concat(blocks)
}

/**
 * Build a gzip-compressed tar payload.
 * @param entries - objects with `{ path, type, content, mode, link }`.
 * @returns the gzip bytes.
 */
export function buildTarGz(entries) {
  return gzipSync(buildTar(entries))
}

/**
 * Build a release archive shaped like GitHub's: everything under one top folder.
 * @param files - map of relative path to content.
 * @param top - the archive's single top-level folder.
 * @returns the gzip bytes.
 */
export function releaseArchive(files, top = 'matlab-agentic-toolkit-MATK-2026.11.a') {
  const entries = [{ path: `${top}/`, type: '5' }]
  for (const [path, content] of Object.entries(files)) {
    entries.push({ path: `${top}/${path}`, content })
  }
  return buildTarGz(entries)
}
