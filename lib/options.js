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

import { normalizeGithubProxy } from './github.js'

/** Stable Cordis entry id used by `cordis.patch.yml` and settings forms. */
export const PLUGIN_ID = 'matlab-agentic'

/** MCP server namespace; MATLAB's own docs call the server `matlab`. */
export const DEFAULT_SERVER_NAME = 'matlab'

/** Name MATLAB displays for the agent behind the MCP connection. */
export const DEFAULT_AGENT_NAME = 'DeepSeek'

/** MATLAB tool calls run simulations and test suites, so the DSH default of 60 s is too short. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 600_000

/** A first-time transfer runs off the boot path, so this bounds a background job rather than a start. */
export const DEFAULT_PROVISION_TIMEOUT_MS = 300_000

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
  const rawProxy = text('githubProxy')
  const githubProxy = rawProxy === undefined ? undefined : (normalizeGithubProxy(rawProxy) ?? undefined)
  if (rawProxy !== undefined && githubProxy === undefined) {
    // A configured prefix is a statement this plugin can check, so a broken one
    // fails activation with the fix instead of quietly downloading direct.
    throw new Error(
      `matlab-agentic: githubProxy must be an HTTPS prefix without credentials or query, `
      + `for example https://gh-proxy.com (got ${rawProxy})`,
    )
  }
  const agentName = text('agentName') ?? DEFAULT_AGENT_NAME
  if (/[\u0000-\u001f\u007f]/u.test(agentName) || [...agentName].length > 80) {
    throw new Error('matlab-agentic: agentName must be a single line of at most 80 characters')
  }
  const timeout = value('provisionTimeoutMs')
  const wait = value('provisionWaitMs')
  return {
    serverName: value('serverName'),
    agentName,
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
    githubProxy,
    downloadRegion: value('downloadRegion') ?? 'auto',
    provisionTimeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_PROVISION_TIMEOUT_MS,
    provisionWaitMs: typeof wait === 'number' && Number.isFinite(wait) && wait > 0 ? wait : 0,
    toolkitRoots: list('toolkitRoots'),
    skillGroups: groups,
    extensionFiles: list('extensionFiles'),
    watchSkills: value('watchSkills'),
    probe: value('probe'),
    probeTimeoutMs: value('probeTimeoutMs'),
    statusRoute: value('statusRoute'),
  }
}
