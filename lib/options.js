/**
 * Normalize raw plugin configuration.
 *
 * Kept free of the schema module so the binding logic can be exercised without
 * the DSH runtime packages installed.
 *
 * A field declared `.volatile()` reaches `apply` as a wrapper whose `get()`
 * returns the live value; reading it directly would silently ignore a user's
 * setting. {@link readField} unwraps both kinds so the resolver never has to
 * know which fields are volatile.
 *
 * @module dsh-plugin-matlab/options
 */

/** Stable Cordis entry id used by `cordis.patch.yml` and settings forms. */
export const PLUGIN_ID = 'matlab-agentic'

/** MCP server namespace; MATLAB's own docs call the server `matlab`. */
export const DEFAULT_SERVER_NAME = 'matlab'

/** MATLAB tool calls run simulations and test suites, so the DSH default of 60 s is too short. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 600_000

/**
 * Read one configuration field, unwrapping a volatile value.
 * @param input - plain value or volatile wrapper.
 * @returns the current value.
 */
function readField(input) {
  if (input !== null && typeof input === 'object' && typeof input.get === 'function') return input.get()
  return input
}

/**
 * Normalize raw config into the shape the resolver consumes.
 * Empty strings and empty arrays mean "discover it", not "use the empty value".
 * @param config - schema-validated plugin config.
 * @returns normalized options with explicit absence.
 */
export function resolveOptions(config) {
  const value = name => readField(config[name])
  const text = name => {
    const current = value(name)
    return typeof current === 'string' && current.trim().length > 0 ? current.trim() : undefined
  }
  const list = name => (value(name) ?? []).map(entry => entry.trim()).filter(entry => entry.length > 0)
  const groups = list('skillGroups')
  const duplicates = groups.filter((name, index) => groups.indexOf(name) !== index)
  if (duplicates.length > 0) {
    throw new Error(`matlab-agentic: skillGroups lists ${duplicates.join(', ')} more than once`)
  }
  return {
    serverName: value('serverName'),
    toolCallTimeoutMs: value('toolCallTimeoutMs'),
    failOnStartupError: value('failOnStartupError'),
    matlabRoot: text('matlabRoot'),
    displayMode: value('displayMode'),
    sessionMode: value('sessionMode'),
    initialWorkingFolder: text('initialWorkingFolder'),
    initializeMatlabOnStartup: value('initializeMatlabOnStartup'),
    disableTelemetry: value('disableTelemetry'),
    mcpServerPath: text('mcpServerPath'),
    autoProvision: value('autoProvision'),
    installRoot: text('installRoot'),
    toolkitRoots: list('toolkitRoots'),
    skillGroups: groups,
    extensionFiles: list('extensionFiles'),
    watchSkills: value('watchSkills'),
    probe: value('probe'),
    probeTimeoutMs: value('probeTimeoutMs'),
    statusRoute: value('statusRoute'),
  }
}
