/**
 * Focused reader for the two `manifest.yaml` sections the plugin needs.
 *
 * MathWorks owns the manifest format and its YAML may use constructs this
 * reader does not implement. Rather than pretend to be a YAML parser, it
 * extracts only `skill-groups` and `mcp-server-extensions` item fields and
 * reports `undefined` for anything it does not understand, so the caller can
 * fall back to scanning `skills-catalog/` directories.
 *
 * @module dsh-plugin-matlab/yaml-mini
 */

/** A scalar or folded block scalar value, trimmed of surrounding syntax. */
function cleanScalar(raw) {
  const value = raw.trim()
  if (value.length === 0) return ''
  const quoted = /^(['"])(.*)\1$/u.exec(value)
  if (quoted !== null) return quoted[2]
  // A trailing `# comment` starts only after whitespace, and never inside quotes.
  return value.replace(/\s+#.*$/u, '').trim()
}

/** Split a document into lines with their indentation, dropping comments and blanks. */
function significantLines(text) {
  const rows = []
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.trim().length === 0) {
      rows.push({ indent: raw.length, text: '', blank: true })
      continue
    }
    if (raw.trimStart().startsWith('#')) {
      rows.push({ indent: raw.length - raw.trimStart().length, text: '', blank: true })
      continue
    }
    const indent = raw.length - raw.trimStart().length
    rows.push({ indent, text: raw.trim(), blank: false })
  }
  return rows
}

/**
 * Read one `key: value` slice of a list item starting at `start`.
 * @param rows - significant lines.
 * @param start - index of the first line after the item's `- ` marker.
 * @param end - exclusive index where the item's block stops.
 * @param itemIndent - indentation of the item's keys.
 * @returns field name to scalar string.
 */
function readItemFields(rows, start, end, itemIndent) {
  const fields = new Map()
  for (let index = start; index < end; index += 1) {
    const row = rows[index]
    if (row.indent !== itemIndent) continue
    const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/u.exec(row.text)
    if (match === null) continue
    const key = match[1]
    let value = match[2] ?? ''
    if (value.startsWith('>') || value.startsWith('|')) {
      const parts = []
      let cursor = index + 1
      while (cursor < end && rows[cursor].indent > itemIndent) {
        if (!rows[cursor].blank && rows[cursor].text.length > 0) parts.push(rows[cursor].text)
        cursor += 1
      }
      index = cursor - 1
      value = parts.join(value.startsWith('>') ? ' ' : '\n')
    }
    fields.set(key, cleanScalar(value))
  }
  return fields
}

/**
 * Read the items of one top-level list section.
 * @param rows - significant lines.
 * @param section - top-level key whose list items are read.
 * @returns the field maps of each list item, in document order.
 */
function readSection(rows, section) {
  const headerIndex = rows.findIndex(row => !row.blank && row.indent === 0 && row.text === `${section}:`)
  if (headerIndex === -1) return []
  const body = []
  let bodyEnd = rows.length
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row.blank && row.indent === 0) {
      bodyEnd = index
      break
    }
    body.push({ row, absolute: index })
  }
  // Items start at `- ` or `- key: value`, the shallowest list indentation.
  const itemRows = body.filter(entry => entry.row.text.startsWith('- '))
  if (itemRows.length === 0) return []
  const dashIndent = Math.min(...itemRows.map(entry => entry.row.indent))
  const starts = itemRows
    .map((entry, position) => ({ ...entry, position }))
    .filter(entry => entry.row.indent === dashIndent)

  const items = []
  for (let position = 0; position < starts.length; position += 1) {
    const from = starts[position].absolute
    const to = position + 1 < starts.length ? starts[position + 1].absolute : bodyEnd
    const inline = /^-\s+([A-Za-z0-9_-]+):(?:\s+(.*))?$/u.exec(rows[from].text)
    // Keys of `- key: value` sit two columns past the dash.
    const itemIndent = dashIndent + 2
    const fields = readItemFields(rows, from + 1, to, itemIndent)
    if (inline !== null) {
      const key = inline[1]
      const value = inline[2] ?? ''
      if (!fields.has(key)) fields.set(key, cleanScalar(value))
    }
    items.push(fields)
  }
  return items
}

/**
 * Parse toolkit skill groups.
 * @param text - `manifest.yaml` contents.
 * @returns declared groups; `undefined` when the section is absent.
 */
export function parseSkillGroups(text) {
  if (!/^skill-groups:/mu.test(text)) return undefined
  return readSection(significantLines(text), 'skill-groups').flatMap(fields => {
    const name = fields.get('name')
    if (name === undefined || name.length === 0) return []
    const required = (fields.get('required') ?? '').toLowerCase()
    return [{
      name,
      displayName: fields.get('display-name') ?? name,
      description: fields.get('description') ?? '',
      path: fields.get('path') ?? `skills-catalog/${name}`,
      required: required === 'true' || required === 'yes' || required === 'on' || required === '1',
      requiresProducts: [],
    }]
  })
}

/**
 * Parse the MCP tool extension files a toolkit contributes.
 * @param text - `manifest.yaml` contents.
 * @returns relative `path` values in declaration order; `undefined` when the section is absent.
 */
export function parseMcpServerExtensions(text) {
  if (!/^mcp-server-extensions:/mu.test(text)) return undefined
  return readSection(significantLines(text), 'mcp-server-extensions')
    .flatMap(fields => {
      const path = fields.get('path')
      return path === undefined || path.length === 0 ? [] : [path]
    })
}

/**
 * Read the toolkit display name.
 * @param text - `manifest.yaml` contents.
 * @returns the declared `display-name`, if any.
 */
export function parseDisplayName(text) {
  const match = /^display-name:[ \t]*(.+)$/mu.exec(text)
  return match === null ? undefined : cleanScalar(match[1])
}
