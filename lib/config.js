/**
 * Plugin configuration schema.
 *
 * Every deployment-varying choice is a validated field, so a profile can set
 * it in `cordis.patch.yml` or through the settings form. Volatile fields are
 * the ones a user retargets without reinstalling the package.
 *
 * @module dsh-matlab/config
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_AGENT_NAME, DEFAULT_SERVER_NAME, DEFAULT_TOOL_CALL_TIMEOUT_MS } from './options.js'

export { PLUGIN_ID, resolveOptions } from './options.js'

export const Config = Schema.object({
  // ---- Tool binding -------------------------------------------------------
  serverName: Schema.string()
    .default(DEFAULT_SERVER_NAME)
    .volatile()
    .description('MCP namespace; tools appear as mcp__<serverName>__<tool>.'),
  toolCallTimeoutMs: Schema.number()
    .default(DEFAULT_TOOL_CALL_TIMEOUT_MS)
    .volatile()
    .description('Per-call timeout for MATLAB tools in milliseconds.'),
  agentName: Schema.string()
    .default(DEFAULT_AGENT_NAME)
    .volatile()
    .description('Name MATLAB shows for the agent behind the MCP connection, for example in "… is connected to MATLAB …".'),
  failOnStartupError: Schema.boolean()
    .default(false)
    .description('Reject plugin activation when the MATLAB tool connection fails.'),

  // ---- MATLAB target ------------------------------------------------------
  matlabRoot: Schema.string()
    .default('')
    .volatile()
    .description('MATLAB installation root, for example C:\\Program Files\\MATLAB\\R2025b. Empty discovers it.'),
  displayMode: Schema.union([Schema.const('desktop'), Schema.const('nodesktop')])
    .default('desktop')
    .volatile()
    .description('Whether MATLAB starts with its desktop.'),
  sessionMode: Schema.union([Schema.const('auto'), Schema.const('existing'), Schema.const('new')])
    .default('auto')
    .volatile()
    .description('Connect to a shared MATLAB session (shareMATLABSession) or start a new one.'),
  initialWorkingFolder: Schema.string()
    .default('')
    .volatile()
    .description('Folder MATLAB starts in. Empty uses the DSH working directory.'),
  useWorkspaceFolder: Schema.boolean()
    .default(false)
    .volatile()
    .description('Use the calling conversation\'s working folder for each MATLAB call instead of initialWorkingFolder.'),
  initializeMatlabOnStartup: Schema.boolean()
    .default(false)
    .volatile()
    .description('Start MATLAB as soon as the MCP server starts instead of on the first tool call.'),
  disableTelemetry: Schema.boolean()
    .default(true)
    .volatile()
    .description('Pass --disable-telemetry=true to the MATLAB MCP Server. On by default: this connector sends nothing to MathWorks unless the user opts in.'),

  // ---- MATLAB MCP Server --------------------------------------------------
  mcpServerPath: Schema.string()
    .default('')
    .volatile()
    .description('Path to the matlab-mcp-server executable. Empty discovers or downloads it.'),
  autoProvision: Schema.boolean()
    .default(true)
    .volatile()
    .description('Download the MATLAB MCP Server binary and the newest Agentic Toolkit release when absent.'),

  // ---- GitHub acceleration ------------------------------------------------
  githubProxy: Schema.string()
    .default('')
    .volatile()
    .description('HTTPS GitHub acceleration prefixes, comma-separated (for example "https://gh-proxy.com, https://ghfast.top"); the fastest measured one is used first. Empty follows the acceleration DSH is already configured with.'),
  downloadRegion: Schema.union([Schema.const('auto'), Schema.const('china'), Schema.const('global')])
    .default('auto')
    .volatile()
    .description('Download region: auto follows DSH\'s market setting, china uses the built-in China routes, global goes direct.'),
  provisionTimeoutMs: Schema.number()
    .default(300_000)
    .volatile()
    .description('Budget in milliseconds for one first-time transfer (binary download or toolkit archive).'),
  provisionWaitMs: Schema.number()
    .default(0)
    .volatile()
    .description('How long activation may wait for a first-time fetch in milliseconds. 0 fetches in the background, so startup is never held by the download.'),

  // ---- Toolkit skills -----------------------------------------------------
  toolkitRoots: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Toolkit folders to read skills from instead of the release the plugin installs under the DSH home.'),
  skillGroups: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Skill groups to load. Empty loads every group; list names to load fewer.'),
  extensionFiles: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Extra MCP tool definition files passed as --extension-file.'),
  watchSkills: Schema.boolean()
    .default(true)
    .volatile()
    .description('Reload the skill catalog when the toolkit changes on disk.'),

  // ---- Diagnostics --------------------------------------------------------
  probe: Schema.boolean()
    .default(true)
    .description('Probe the MCP server before connecting so failures are reported with a cause.'),
  probeTimeoutMs: Schema.number()
    .default(20_000)
    .description('Budget for one startup probe in milliseconds.'),
  statusRoute: Schema.boolean()
    .default(true)
    .description('Serve GET /plugin/matlab/status with the resolved connectivity state.'),
})
