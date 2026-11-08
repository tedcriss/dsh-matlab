/**
 * The binding itself: resolve MathWorks artifacts, mount DSH transports.
 *
 * This module deliberately imports no DSH runtime package. The two transports
 * are loaded through {@link DEFAULT_TOOLS}, which a test can replace, so the
 * binding is exercised without the installed runtime.
 *
 * @module dsh-plugin-matlab/activate
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { buildMcpServerArgs, serverEnvironment } from './args.js'
import { discoverMatlabRoot } from './matlab-root.js'
import { ensureMcpServer, serverVersion } from './mcp-binary.js'
import { resolveOptions } from './options.js'
import { probeMcpServer } from './probe.js'
import { cloneToolkit, proxyFromEnvironment } from './provision.js'
import { countSkills, discoverToolkits, selectSkillGroups } from './toolkit.js'
import { installerMatlabRoot, installerServerVersion, readInstallerConfig } from './installer.js'

/** Provider name the MATLAB skill catalog registers under. */
const SKILL_PROVIDER_NAME = 'matlab'

/** HTTP path serving the resolved connectivity state. */
export const STATUS_PATH = '/plugin/matlab/status'

/** Transports and platform seams; tests replace entries to run without the runtime. */
export const DEFAULT_TOOLS = {
  loadSkillProvider: () => import('@deepseek-ai/dsh-skill-filesystem'),
  loadMcpClient: () => import('@deepseek-ai/dsh-mcp-client'),
  discoverMatlabRoot,
  ensureMcpServer,
  serverVersion,
  probeMcpServer,
  cloneToolkit,
  countSkills,
  readInstallerConfig,
}

/**
 * Resolve the Harness home the same way the launcher does.
 * @param env - environment map.
 * @returns the DSH home folder.
 */
export function resolveDshHome(env = process.env) {
  const configured = env.DSH_HOME
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim()
    : join(homedir(), '.dsh')
}

/**
 * Mount the skill provider for the selected groups.
 * @param ctx - plugin context.
 * @param groups - selected skill groups.
 * @param options - resolved plugin options.
 * @param tools - injected transports and log sink.
 * @returns the mounted group descriptors with skill counts.
 */
async function mountSkills(ctx, groups, options, tools) {
  const described = []
  for (const group of groups) {
    described.push({
      name: group.name,
      toolkit: group.toolkit,
      path: group.path,
      skills: await tools.countSkills(group.path),
    })
  }
  if (ctx.get('skills') === undefined) {
    tools.log('warn', 'no skill registry is loaded in this profile, so MATLAB skills cannot be registered')
    return described
  }
  if (described.length === 0) {
    tools.log('warn', 'no MATLAB skill group is selected; set skillGroups or install a toolkit checkout')
    return described
  }
  const skillFilesystem = await tools.loadSkillProvider()
  ctx.plugin(skillFilesystem, {
    providerName: SKILL_PROVIDER_NAME,
    // The MATLAB groups are the only roots this provider owns; project and user
    // roots stay with the profile's own filesystem provider.
    includeDefaultRoots: false,
    customSkillDirs: described.map(group => group.path),
    watch: options.watchSkills,
  })
  return described
}

/**
 * Mount the MCP client bridge against the MATLAB MCP Server.
 * @param ctx - plugin context.
 * @param binding - executable path, arguments, and working directory.
 * @param options - resolved plugin options.
 * @param tools - injected transports.
 * @returns the mounted fiber.
 */
async function mountMcpTools(ctx, binding, options, tools) {
  const mcpClient = await tools.loadMcpClient()
  return await ctx.plugin(mcpClient, {
    transport: 'stdio',
    serverName: options.serverName,
    command: binding.command,
    args: binding.args,
    env: serverEnvironment(),
    cwd: binding.cwd,
    toolCallTimeoutMs: options.toolCallTimeoutMs,
    failOnStartupError: options.failOnStartupError,
  })
}

/**
 * Expose the resolved connectivity state over HTTP for diagnosis.
 * @param ctx - plugin context.
 * @param status - live status object.
 * @param log - diagnostic sink.
 */
function mountStatusRoute(ctx, status, log) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    log('debug', 'no web server in this profile; the MATLAB status route is not served')
    return
  }
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    resource: async () => new Response(`${JSON.stringify(status, null, 2)}\n`, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
  }), 'matlab-agentic: status route')
}

/**
 * Activate the binding.
 * @param ctx - plugin context.
 * @param config - schema-validated configuration.
 * @param overrides - replacements for {@link DEFAULT_TOOLS}.
 * @returns the resolved status object.
 */
export async function activate(ctx, config, overrides = {}) {
  const options = resolveOptions(config)
  const log = (level, message) => {
    const line = `matlab-agentic: ${message}`
    if (level === 'error') ctx.logger.error(line)
    else if (level === 'warn') ctx.logger.warn(line)
    else if (level === 'debug') ctx.logger.debug?.(line)
    else ctx.logger.info(line)
  }
  const tools = { ...DEFAULT_TOOLS, ...overrides, log }
  const status = {
    plugin: 'dsh-plugin-matlab',
    phase: 'starting',
    matlab: undefined,
    server: undefined,
    toolkit: undefined,
    skills: [],
    probe: undefined,
    warnings: [],
    error: undefined,
    installer: undefined,
  }
  if (options.statusRoute) mountStatusRoute(ctx, status, log)

  const dshHome = resolveDshHome()
  const dataRoot = join(dshHome, 'matlab')
  const matlabInstallRoot = options.installRoot ?? join(homedir(), '.matlab', 'agentic-toolkits')
  const installer = await tools.readInstallerConfig(matlabInstallRoot)
  status.installer = {
    root: matlabInstallRoot,
    configFound: installer !== undefined,
    matlabRoot: installerMatlabRoot(installer),
    serverVersion: installerServerVersion(installer),
  }

  // ---- Toolkit skills -----------------------------------------------------
  status.phase = 'skills'
  let toolkits = await discoverToolkits({
    explicitRoots: options.toolkitRoots,
    installRoot: matlabInstallRoot,
    dataRoots: [dataRoot],
  })
  if (toolkits.length === 0 && options.autoProvision) {
    log('info', 'no Agentic Toolkit checkout found; cloning the MATLAB Agentic Toolkit')
    const cloned = await tools.cloneToolkit({
      kind: 'matlab',
      dataRoot,
      proxy: proxyFromEnvironment(),
      log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
    })
    toolkits = await discoverToolkits({ explicitRoots: [cloned.root] })
  }
  const selection = selectSkillGroups(toolkits, options.skillGroups)
  if (selection.unknown.length > 0) {
    const available = toolkits.flatMap(toolkit => toolkit.groups.map(group => group.name))
    throw new Error(
      `matlab-agentic: unknown skill group(s) ${selection.unknown.join(', ')}. `
      + `Available: ${available.join(', ') || 'none'}.`,
    )
  }
  status.toolkit = toolkits.map(toolkit => ({
    root: toolkit.root,
    displayName: toolkit.displayName,
    kind: toolkit.kind,
    groups: toolkit.groups.map(group => group.name),
    extensionFiles: toolkit.extensionFiles,
  }))
  status.skills = await mountSkills(ctx, selection.groups, options, tools)
  log('info', `skills: ${String(status.skills.length)} group(s), `
    + `${String(status.skills.reduce((total, group) => total + group.skills, 0))} skill(s)`)

  // ---- MATLAB tools -------------------------------------------------------
  status.phase = 'tools'
  const matlab = await tools.discoverMatlabRoot({
    explicit: options.matlabRoot,
    installerRoot: installerMatlabRoot(installer),
  })
  status.matlab = matlab
  if (matlab !== undefined && matlab.exists === false) {
    const message = `matlabRoot does not exist: ${matlab.root}`
    if (options.failOnStartupError) throw new Error(`matlab-agentic: ${message}`)
    log('warn', message)
  }
  await mkdir(join(dataRoot, 'logs'), { recursive: true })
  const binary = await tools.ensureMcpServer({
    explicit: options.mcpServerPath,
    matlabInstallRoot,
    dataRoot,
    autoProvision: options.autoProvision,
    log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
  })
  const version = await tools.serverVersion(binary.path)
  status.server = { path: binary.path, source: binary.source, version, downloaded: binary.downloaded }

  const extensionFiles = [
    ...options.extensionFiles,
    ...toolkits.flatMap(toolkit => toolkit.extensionFiles),
  ]
  const built = buildMcpServerArgs({
    matlabRoot: matlab?.root,
    sessionMode: options.sessionMode,
    displayMode: options.displayMode,
    initialWorkingFolder: options.initialWorkingFolder,
    initializeMatlabOnStartup: options.initializeMatlabOnStartup,
    disableTelemetry: options.disableTelemetry,
    // MathWorks' OS-temp default cannot create its log folder on some Windows
    // installations, so the plugin data folder is the default log target.
    logFolder: join(dataRoot, 'logs'),
    logLevel: 'info',
    extensionFiles,
  })
  for (const warning of built.warnings) {
    status.warnings.push(warning)
    log('warn', warning)
  }
  const binding = {
    command: binary.path,
    args: built.args,
    cwd: options.initialWorkingFolder ?? process.cwd(),
  }
  log('info', `tools: ${binary.path}${version === undefined ? '' : ` (${version})`} ${built.args.join(' ')}`)

  if (options.probe) {
    status.probe = await tools.probeMcpServer({
      command: binary.path,
      args: built.args,
      env: serverEnvironment(),
      cwd: binding.cwd,
      timeoutMs: options.probeTimeoutMs,
    })
    if (status.probe.ok) {
      log('info', `probe: ${String(status.probe.tools.length)} tool(s), `
        + `${String(status.probe.resources.length)} resource(s)`)
    } else {
      const message = `probe failed: ${status.probe.error ?? 'unknown cause'}`
      status.warnings.push(message)
      if (options.failOnStartupError) throw new Error(`matlab-agentic: ${message}`)
      log('warn', message)
    }
  }

  try {
    await mountMcpTools(ctx, binding, options, tools)
    status.phase = 'ready'
    log('info', `connected; tools appear as mcp__${options.serverName}__<tool>`)
  } catch (cause) {
    status.phase = 'failed'
    status.error = cause instanceof Error ? cause.message : String(cause)
    if (options.failOnStartupError) throw cause
    log('error', `tool connection failed: ${status.error}`)
  }
  return status
}
