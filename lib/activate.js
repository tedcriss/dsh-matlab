/**
 * The binding itself: resolve MathWorks artifacts, mount DSH transports.
 *
 * This module deliberately imports no DSH runtime package. The two transports
 * are loaded through {@link DEFAULT_TOOLS}, which a test can replace, so the
 * binding is exercised without the installed runtime.
 *
 * A first-time fetch is the one thing that must not happen on the boot path:
 * DSH Desktop fails a host that has not started within 60 seconds, while the
 * MATLAB MCP Server release asset is 19.9 MB and the toolkit checkout is a git
 * clone. So activation mounts whatever already exists, and when an artifact is
 * missing it starts the fetch in the background and mounts that half when the
 * fetch lands ({@link provision}).
 *
 * @module dsh-plugin-matlab/activate
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { buildMcpServerArgs, serverEnvironment } from './args.js'
import { resolveGithubAcceleration, resolveProfileDirectory, routeLabel } from './github.js'
import { discoverMatlabRoot } from './matlab-root.js'
import { ensureMcpServer, findMcpServer, serverVersion } from './mcp-binary.js'
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
  findMcpServer,
  ensureMcpServer,
  serverVersion,
  probeMcpServer,
  cloneToolkit,
  countSkills,
  readInstallerConfig,
  resolveGithubAcceleration,
  resolveProfileDirectory,
}

/**
 * The profile directory the launcher published, when this host has one.
 *
 * `profileContext` is the same service DSH's own market reads its profile from,
 * so the acceleration this plugin follows is the acceleration that market
 * persisted for the profile the user actually launched.
 * @param ctx - plugin context.
 * @returns the absolute profile directory, or `undefined`.
 */
function launchedProfileDirectory(ctx) {
  const context = ctx.get?.('profileContext')
  const directory = context?.dir
  return typeof directory === 'string' && directory.trim() !== '' ? directory.trim() : undefined
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
 * Select groups, record them, and mount the catalog.
 * @param state - activation state shared with the background fetch.
 * @param toolkits - discovered toolkits.
 * @param strict - whether an unknown group name fails activation, or is only reported.
 */
async function mountSkillCatalog(state, toolkits, strict) {
  const { ctx, options, tools, status } = state
  state.toolkits = toolkits
  const selection = selectSkillGroups(toolkits, options.skillGroups)
  if (selection.unknown.length > 0) {
    const available = toolkits.flatMap(toolkit => toolkit.groups.map(group => group.name))
    const message = `unknown skill group(s) ${selection.unknown.join(', ')}. `
      + `Available: ${available.join(', ') || 'none'}.`
    // A group name that matches nothing is a configuration error, but once the
    // fetch already ran in the background there is no activation left to fail:
    // report it the same way a failed fetch is reported.
    if (strict) throw new Error(`matlab-agentic: ${message}`)
    state.log('error', message)
    status.warnings.push(message)
  }
  status.toolkit = toolkits.map(toolkit => ({
    root: toolkit.root,
    displayName: toolkit.displayName,
    kind: toolkit.kind,
    groups: toolkit.groups.map(group => group.name),
    extensionFiles: toolkit.extensionFiles,
  }))
  status.skills = await mountSkills(ctx, selection.groups, options, tools)
  state.log('info', `skills: ${String(status.skills.length)} group(s), `
    + `${String(status.skills.reduce((total, group) => total + group.skills, 0))} skill(s)`)
}

/**
 * Build the MCP arguments, probe the server, and mount the bridge.
 * @param state - activation state.
 * @param binary - the server executable to run.
 */
async function bindTools(state, binary) {
  const { ctx, options, tools, status, log, matlab } = state
  const version = await tools.serverVersion(binary.path)
  status.server = {
    path: binary.path,
    source: binary.source,
    version,
    downloaded: binary.downloaded,
    route: binary.route === undefined ? undefined : routeLabel(binary.route),
  }
  const extensionFiles = [
    ...options.extensionFiles,
    ...state.toolkits.flatMap(toolkit => toolkit.extensionFiles),
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
    logFolder: state.logFolder,
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
    log('info', `connected; tools appear as mcp__${options.serverName}__<tool>`)
  } catch (cause) {
    status.error = cause instanceof Error ? cause.message : String(cause)
    if (options.failOnStartupError) throw cause
    log('error', `tool connection failed: ${status.error}`)
  }
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
 * Fetch whatever activation could not find, then mount that half.
 *
 * Failures are reported instead of thrown: activation already resolved, so
 * there is nothing left to reject. The status route and the log carry the
 * reason, and the next start retries from the same discovery.
 * @param state - activation state, including which artifacts are missing.
 */
async function provision(state) {
  const { options, tools, status, log, plan, acceleration, dataRoot, matlabInstallRoot } = state
  try {
    if (plan.toolkit) {
      const cloned = await tools.cloneToolkit({
        kind: 'matlab',
        dataRoot,
        routes: acceleration.routes,
        timeoutMs: options.provisionTimeoutMs,
        proxy: proxyFromEnvironment(),
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await mountSkillCatalog(state, await discoverToolkits({ explicitRoots: [cloned.root] }), false)
    }
    if (plan.tools) {
      const binary = await tools.ensureMcpServer({
        explicit: options.mcpServerPath,
        matlabInstallRoot,
        dataRoot,
        autoProvision: options.autoProvision,
        routes: acceleration.routes,
        provisionTimeoutMs: options.provisionTimeoutMs,
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await bindTools(state, binary)
    }
    status.phase = status.error === undefined ? 'ready' : 'failed'
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    status.phase = 'failed'
    status.error = message
    log('error', `background fetch failed: ${message}`)
  }
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
    github: undefined,
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

  // ---- GitHub acceleration ------------------------------------------------
  // Both artifacts come from github.com, and a first fetch must still fit in a
  // startup that DSH Desktop abandons after 60 seconds. The route DSH already
  // chose (environment, market setting, or the China table) decides how much of
  // that budget the transfer needs.
  const acceleration = await tools.resolveGithubAcceleration({
    githubProxy: options.githubProxy ?? null,
    downloadRegion: options.downloadRegion,
    profileDirectory: await tools.resolveProfileDirectory({
      profileDirectory: launchedProfileDirectory(ctx),
      dshHome,
      env: process.env,
    }),
    env: process.env,
    log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
  })
  status.github = {
    region: acceleration.region,
    regionSource: acceleration.regionSource,
    proxy: acceleration.proxy,
    proxySource: acceleration.source,
    routes: acceleration.routes.map(routeLabel),
  }
  log('info', `github: ${status.github.routes.join(' -> ')} (region ${acceleration.region} from ${acceleration.regionSource})`)

  const installer = await tools.readInstallerConfig(matlabInstallRoot)
  status.installer = {
    root: matlabInstallRoot,
    configFound: installer !== undefined,
    matlabRoot: installerMatlabRoot(installer),
    serverVersion: installerServerVersion(installer),
  }

  /** Everything the mount helpers and the background fetch share. */
  const state = {
    ctx,
    options,
    tools,
    status,
    log,
    dataRoot,
    matlabInstallRoot,
    acceleration,
    matlab: undefined,
    logFolder: join(dataRoot, 'logs'),
    toolkits: [],
    plan: { toolkit: false, tools: false },
  }

  // ---- Toolkit skills -----------------------------------------------------
  status.phase = 'skills'
  state.toolkits = await discoverToolkits({
    explicitRoots: options.toolkitRoots,
    installRoot: matlabInstallRoot,
    dataRoots: [dataRoot],
  })
  if (state.toolkits.length === 0 && options.autoProvision) {
    // A checkout is a `git clone` of a whole repository: megabytes over hundreds
    // of round trips, which is precisely what a startup budget cannot host.
    state.plan.toolkit = true
    log('info', 'no Agentic Toolkit checkout found; cloning it in the background so the fetch cannot hold up startup')
  } else {
    await mountSkillCatalog(state, state.toolkits, true)
  }

  // ---- MATLAB tools -------------------------------------------------------
  status.phase = state.plan.toolkit ? 'provisioning' : 'tools'
  state.matlab = await tools.discoverMatlabRoot({
    explicit: options.matlabRoot,
    installerRoot: installerMatlabRoot(installer),
  })
  status.matlab = state.matlab
  if (state.matlab !== undefined && state.matlab.exists === false) {
    const message = `matlabRoot does not exist: ${state.matlab.root}`
    if (options.failOnStartupError) throw new Error(`matlab-agentic: ${message}`)
    log('warn', message)
  }
  await mkdir(state.logFolder, { recursive: true })

  const existing = await tools.findMcpServer({
    explicit: options.mcpServerPath,
    matlabInstallRoot,
    dataRoot,
  })
  if (existing !== undefined && !state.plan.toolkit) {
    await bindTools(state, existing)
  } else if (existing !== undefined) {
    // The binary is here, but the toolkit half is still being fetched and its
    // `mcp-server-extensions` belong in the first connection: bind the tools
    // after that fetch, in the background task, rather than connect twice.
    state.plan.tools = true
  } else if (options.mcpServerPath !== undefined) {
    throw new Error(`matlab-agentic: mcpServerPath does not point at a file: ${options.mcpServerPath}`)
  } else if (options.autoProvision !== true) {
    throw new Error(
      'matlab-agentic: the MATLAB MCP Server binary was not found. Install it with the MathWorks '
      + 'Agentic Toolkit installer (setupAgenticToolkit("install")), download it from '
      + 'https://github.com/matlab/matlab-mcp-server/releases/latest, or set mcpServerPath.',
    )
  } else {
    // 19.9 MB is the other transfer a 60-second startup cannot host.
    state.plan.tools = true
    log('info', 'the MATLAB MCP Server binary is missing; downloading it in the background so the fetch cannot hold up startup')
  }

  if (!state.plan.toolkit && !state.plan.tools) {
    status.phase = status.error === undefined ? 'ready' : 'failed'
    return status
  }

  // ---- Background fetch ---------------------------------------------------
  status.phase = 'provisioning'
  const fetching = provision(state)
  if (options.provisionWaitMs > 0) {
    // A profile that would rather hold the start than appear without MATLAB
    // tools can wait, but only as long as it asked: whatever is still fetching
    // when the wait expires keeps going in the background.
    await Promise.race([fetching, new Promise(resolve => setTimeout(resolve, options.provisionWaitMs))])
  } else {
    void fetching
  }
  return status
}
