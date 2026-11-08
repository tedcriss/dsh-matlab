/**
 * Plugin configuration schema.
 *
 * Every deployment-varying choice is a validated field, so a profile can set
 * it in `cordis.patch.yml` or through the settings form. Volatile fields are
 * the ones a user retargets without reinstalling the package.
 *
 * @module dsh-plugin-matlab/config
 */

import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_SERVER_NAME, DEFAULT_TOOL_CALL_TIMEOUT_MS } from './options.js'

export { PLUGIN_ID, resolveOptions } from './options.js'

export const Config = Schema.object({
  // ---- Tool binding -------------------------------------------------------
  serverName: Schema.string()
    .default(DEFAULT_SERVER_NAME)
    .description('MCP namespace; tools appear as mcp__<serverName>__<tool>.'),
  toolCallTimeoutMs: Schema.number()
    .default(DEFAULT_TOOL_CALL_TIMEOUT_MS)
    .description('Per-call timeout for MATLAB tools in milliseconds.'),
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
  initializeMatlabOnStartup: Schema.boolean()
    .default(false)
    .description('Start MATLAB as soon as the MCP server starts instead of on the first tool call.'),
  disableTelemetry: Schema.boolean()
    .default(false)
    .description('Pass --disable-telemetry to the MATLAB MCP Server.'),

  // ---- MATLAB MCP Server --------------------------------------------------
  mcpServerPath: Schema.string()
    .default('')
    .volatile()
    .description('Path to the matlab-mcp-server executable. Empty discovers or downloads it.'),
  autoProvision: Schema.boolean()
    .default(true)
    .volatile()
    .description('Download the MATLAB MCP Server binary and clone the toolkit when absent.'),

  // ---- Toolkit skills -----------------------------------------------------
  installRoot: Schema.string()
    .default('')
    .volatile()
    .description('MathWorks Agentic Toolkit install root. Empty uses ~/.matlab/agentic-toolkits.'),
  toolkitRoots: Schema.array(Schema.string())
    .default([])
    .volatile()
    .description('Toolkit checkouts to read skills from. Empty scans the MATLAB installer layout.'),
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
