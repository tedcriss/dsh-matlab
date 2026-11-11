/**
 * The binding itself: resolve MathWorks artifacts, mount DSH transports.
 *
 * This module deliberately imports no DSH runtime package. The two transports
 * are loaded through {@link DEFAULT_TOOLS}, which a test can replace, so the
 * binding is exercised without the installed runtime.
 *
 * The plugin owns its dependencies. `$DSH_HOME/matlab` is the only place they
 * live: nothing is read from `~/.matlab/agentic-toolkits`, so a machine with a
 * MathWorks installer install does not silently supply a second copy. Missing
 * artifacts are fetched, and newer ones can be requested from the Settings page
 * ({@link updateDependencies}).
 *
 * A first-time fetch is the one thing that must not happen on the boot path:
 * DSH Desktop fails a host that has not started within 60 seconds, while the
 * MATLAB MCP Server release asset is 19.9 MB and the toolkit is a release
 * archive of its own. So activation mounts whatever already exists, and when an
 * artifact is missing it starts the fetch in the background — reporting progress
 * over {@link module:dsh-plugin-matlab/api} for the GUI's progress dialog — and
 * mounts that half when the fetch lands ({@link provision}).
 *
 * Settings are live. DSH commits volatile fields without restarting the plugin,
 * so this module listens for `loader/volatile-update` and remounts the halves a
 * change affects ({@link remount}); the Settings page writes through the same
 * `settings` service, so a change made in `cordis.patch.yml` behaves identically.
 *
 * @module dsh-plugin-matlab/activate
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { mountPluginApi, mountWhenWebServer } from './api.js'
import { ELECTRON_RUN_AS_NODE } from './mcp-bridge.js'
import { buildMcpServerArgs, serverEnvironment } from './args.js'
import { resolveGithubAcceleration, resolveProfileDirectory, routeLabel } from './github.js'
import { discoverMatlabRoot } from './matlab-root.js'
import { ensureMcpServer, findMcpServer, serverVersion, updateMcpServer } from './mcp-binary.js'
import { DEFAULT_AGENT_NAME, PLUGIN_ID, resolveOptions } from './options.js'
import { probeMcpServer } from './probe.js'
import { installToolkit, readToolkitRelease, TOOLKIT_SOURCES, toolkitDirectory, updateToolkit } from './provision.js'
import { countSkills, discoverToolkits, selectSkillGroups } from './toolkit.js'
import { formatVersion, isNewer, latestRelease, latestServerRelease, parseVersion } from './updates.js'
import { PACKAGE_NAME, VERSION } from './version.js'

/** Provider name the MATLAB skill catalog registers under. */
const SKILL_PROVIDER_NAME = 'matlab'

/** The stdio bridge that names the agent to MATLAB (see mcp-bridge.js). */
const BRIDGE_SCRIPT = fileURLToPath(new URL('./mcp-bridge.js', import.meta.url))

/** HTTP path serving the resolved connectivity state. */
export const STATUS_PATH = '/plugin/matlab/status'

/** Transports and platform seams; tests replace entries to run without the runtime. */
export const DEFAULT_TOOLS = {
  loadSkillProvider: () => import('@deepseek-ai/dsh-skill-filesystem'),
  loadMcpClient: () => import('@deepseek-ai/dsh-mcp-client'),
  discoverMatlabRoot,
  findMcpServer,
  ensureMcpServer,
  updateMcpServer,
  serverVersion,
  probeMcpServer,
  installToolkit,
  updateToolkit,
  readToolkitRelease,
  countSkills,
  resolveGithubAcceleration,
  resolveProfileDirectory,
  latestServerRelease,
  latestToolkitRelease: options => latestRelease({
    ...options,
    slug: TOOLKIT_SOURCES.matlab.slug,
    label: TOOLKIT_SOURCES.matlab.displayName,
  }),
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

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

/** The idle progress record served to the progress dialog before anything runs. */
function idleProgress() {
  return { kind: 'install', active: false, stage: 'idle', bytes: 0, totalBytes: undefined, route: undefined, startedAt: undefined, error: undefined }
}

/**
 * Update the shared progress record and its status mirror.
 * @param state - activation state.
 * @param patch - fields to overwrite.
 */
function setProgress(state, patch) {
  state.progress = { ...state.progress, ...patch }
  state.status.progress = state.progress
}

/**
 * Mount the skill provider for the selected groups.
 * @param state - activation state.
 * @param groups - selected skill groups.
 * @returns the mounted group descriptors with skill counts.
 */
async function mountSkills(state, groups) {
  const { ctx, options, tools } = state
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
  state.skillFiber = ctx.plugin(skillFilesystem, {
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
 * Select groups, record them (for the Settings page), and mount the catalog.
 * @param state - activation state.
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
  await describeGroups(state, toolkits, selection.groups)
  status.toolkit = toolkits.map(toolkit => ({
    root: toolkit.root,
    displayName: toolkit.displayName,
    kind: toolkit.kind,
    groups: toolkit.groups.map(group => group.name),
    extensionFiles: toolkit.extensionFiles,
  }))
  // The page reports which published release the local catalog came from, so a
  // checkout the plugin did not install (a `git clone`, or `toolkitRoots`) is
  // reported without a tag instead of with an invented one.
  status.toolkitRelease = await describeToolkitRelease(state, toolkits[0]?.root)
  status.skills = await mountSkills(state, selection.groups)
  state.log('info', `skills: ${String(status.skills.length)} group(s), `
    + `${String(status.skills.reduce((total, group) => total + group.skills, 0))} skill(s)`)
}

/**
 * Describe the release an installed catalog came from.
 * @param state - activation state.
 * @param root - the toolkit root in use, when there is one.
 * @returns `{ root, tag, installedAt }` with `tag` absent for an unmarked checkout.
 */
async function describeToolkitRelease(state, root) {
  if (root === undefined) return undefined
  const record = await state.tools.readToolkitRelease(root)
  return {
    root,
    tag: record?.tag,
    installedAt: record?.installedAt,
    managed: resolve(root) === resolve(toolkitDirectory(state.dataRoot, 'matlab')),
  }
}

/**
 * Record every group a toolkit offers, with its skill count and selection state.
 * @param state - activation state.
 * @param toolkits - discovered toolkits.
 * @param selected - the groups this activation mounted.
 */
async function describeGroups(state, toolkits, selected) {
  const chosen = new Set(selected.map(group => group.name))
  const groups = []
  for (const toolkit of toolkits) {
    for (const group of toolkit.groups) {
      groups.push({
        name: group.name,
        displayName: group.displayName,
        description: group.description,
        required: group.required === true,
        skills: await state.tools.countSkills(group.path),
        toolkit: toolkit.displayName,
        selected: chosen.has(group.name),
      })
    }
  }
  state.groups = groups
}

/**
 * Mount the MCP client bridge against the MATLAB MCP Server.
 * @param state - activation state.
 * @param binding - executable path, arguments, and working directory.
 * @returns the mounted fiber.
 */
async function mountMcpTools(state, binding) {
  const { ctx, options, tools } = state
  const mcpClient = await tools.loadMcpClient()
  return await ctx.plugin(mcpClient, {
    transport: 'stdio',
    serverName: options.serverName,
    command: binding.command,
    args: binding.args,
    env: binding.env,
    cwd: binding.cwd,
    toolCallTimeoutMs: options.toolCallTimeoutMs,
    failOnStartupError: options.failOnStartupError,
  })
}

/**
 * Build the MCP arguments, probe the server, and mount the bridge.
 * @param state - activation state.
 * @param binary - the server executable to run.
 */
async function bindTools(state, binary) {
  const { options, tools, status, log, matlab } = state
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
    // A remount re-runs this builder; the same warning once is enough.
    if (!status.warnings.includes(warning)) status.warnings.push(warning)
    log('warn', warning)
  }
  const binding = {
    command: process.execPath,
    // The bridge rewrites the MCP initialize request so MATLAB shows the agent
    // name this profile chose, not the MCP client package's own name.
    args: [BRIDGE_SCRIPT, '--client-title', options.agentName, '--', binary.path, ...built.args],
    env: { ...serverEnvironment(), [ELECTRON_RUN_AS_NODE]: '1' },
    cwd: options.initialWorkingFolder ?? process.cwd(),
  }
  log('info', `tools: ${binary.path}${version === undefined ? '' : ` (${version})`} as "${options.agentName}" ${built.args.join(' ')}`)

  if (options.probe) {
    status.probe = await tools.probeMcpServer({
      command: binding.command,
      args: binding.args,
      env: binding.env,
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
    state.toolFiber = await mountMcpTools(state, binding)
    log('info', `connected; tools appear as mcp__${options.serverName}__<tool>`)
  } catch (cause) {
    status.error = messageOf(cause)
    if (options.failOnStartupError) throw cause
    log('error', `tool connection failed: ${status.error}`)
  }
}

/**
 * Dispose one mounted child so a replacement can take its place.
 * @param state - activation state.
 * @param key - `skillFiber` or `toolFiber`.
 */
async function disposeChild(state, key) {
  const fiber = state[key]
  state[key] = undefined
  if (fiber === undefined) return
  try {
    await fiber.dispose?.()
  } catch {
    // A child that is already gone needs no second teardown.
  }
}

/** Dispose both mounted children. */
async function disposeChildren(state) {
  await disposeChild(state, 'toolFiber')
  await disposeChild(state, 'skillFiber')
}

/**
 * Which artifacts are still missing, as names the provisioning plan uses.
 *
 * This answers disk truth for the explicit "install what is missing" action, so
 * it does not consult `autoProvision`: that field decides whether activation
 * fetches on its own, not whether the user's button may fetch.
 * @param state - activation state.
 * @returns `toolkit` and/or `tools`.
 */
async function missingArtifacts(state) {
  const missing = []
  // Always re-discover: the user may have deleted or installed a checkout since
  // activation, and the manual "install now" action must answer for disk truth.
  const toolkits = await discoverToolkits({
    explicitRoots: state.options.toolkitRoots,
    dataRoots: [state.dataRoot],
  })
  if (toolkits.length === 0) missing.push('toolkit')
  const binary = await state.tools.findMcpServer({
    explicit: state.options.mcpServerPath,
    dataRoot: state.dataRoot,
  })
  if (binary === undefined) missing.push('tools')
  return missing
}

/**
 * Start fetching whatever is missing, unless a fetch is already running.
 * @param state - activation state.
 * @param plan - a plan activation already decided; omitted when the caller asks
 *   for a fresh check ("install now" in the Settings page).
 * @returns what was missing and whether a fetch started.
 */
async function startProvisioning(state, plan) {
  if (state.provisioning !== undefined) {
    return { started: false, phase: 'provisioning', missing: [] }
  }
  const missing = plan === undefined
    ? await missingArtifacts(state)
    : [
        ...(plan.toolkit ? ['toolkit'] : []),
        ...(plan.tools ? ['tools'] : []),
      ]
  if (missing.length === 0) {
    return { started: false, phase: state.status.phase, missing }
  }
  state.plan = { toolkit: missing.includes('toolkit'), tools: missing.includes('tools') }
  setProgress(state, {
    kind: 'install',
    active: true,
    stage: state.plan.toolkit ? 'toolkit' : 'download',
    bytes: 0,
    totalBytes: undefined,
    route: undefined,
    error: undefined,
    startedAt: Date.now(),
  })
  state.status.phase = 'provisioning'
  state.provisioning = provision(state).finally(() => {
    state.provisioning = undefined
  })
  return { started: true, phase: 'provisioning', missing }
}

/**
 * Fetch what activation could not find, then mount that half.
 *
 * Failures are reported instead of thrown: activation already resolved, so
 * there is nothing left to reject. The status route, the progress record and
 * the log carry the reason, and the next start retries from discovery.
 * @param state - activation state.
 */
async function provision(state) {
  const { tools, status, log } = state
  try {
    if (state.plan.toolkit) {
      setProgress(state, { kind: 'install', stage: 'toolkit', active: true, bytes: 0, totalBytes: undefined, route: undefined })
      const installed = await tools.installToolkit({
        kind: 'matlab',
        dataRoot: state.dataRoot,
        routes: state.acceleration.routes,
        timeoutMs: state.options.provisionTimeoutMs,
        onAttempt: attempt => setProgress(state, { route: routeLabel(attempt.route) }),
        onProgress: progress => setProgress(state, { bytes: progress.bytes, totalBytes: progress.totalBytes }),
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await mountSkillCatalog(state, await discoverToolkits({ explicitRoots: [installed.root] }), false)
    }
    if (state.plan.tools) {
      setProgress(state, { kind: 'install', stage: 'download', active: true, bytes: 0, totalBytes: undefined, route: undefined })
      const binary = await tools.ensureMcpServer({
        explicit: state.options.mcpServerPath,
        dataRoot: state.dataRoot,
        // `provision` only runs for a plan activation allowed or for an explicit
        // "install" from the page, so both cases mean "fetch it".
        autoProvision: true,
        routes: state.acceleration.routes,
        provisionTimeoutMs: state.options.provisionTimeoutMs,
        onProgress: progress => setProgress(state, { bytes: progress.bytes, totalBytes: progress.totalBytes }),
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await bindTools(state, binary)
      if (binary.route !== undefined) setProgress(state, { route: routeLabel(binary.route) })
    }
    setProgress(state, { active: false, stage: 'done', error: undefined })
    status.phase = status.error === undefined ? 'ready' : 'failed'
    log('info', 'MATLAB dependencies are ready')
  } catch (cause) {
    const message = messageOf(cause)
    setProgress(state, { active: false, stage: 'failed', error: message })
    status.phase = 'failed'
    status.error = message
    log('error', `background fetch failed: ${message}`)
  } finally {
    if (state.remountRequested === true) {
      state.remountRequested = false
      void remount(state)
    }
  }
}

/**
 * Compare the installed artifacts with the published latest ones.
 *
 * Two small probes: the release tag from GitHub's `releases/latest` (or the
 * repository's tags when a mirror refuses the API host) and the toolkit's remote
 * `HEAD`. Nothing is downloaded; the result is cached on `state.updates` for the
 * Settings page.
 * @param state - activation state.
 * @returns which artifact is installed, its version, the latest, and whether it is outdated.
 */
async function checkDependencies(state) {
  const check = {
    checkedAt: Date.now(),
    server: { installed: false, current: undefined, latest: undefined, outdated: false, error: undefined },
    toolkit: { installed: false, current: undefined, latest: undefined, outdated: false, error: undefined },
  }

  const binary = await state.tools.findMcpServer({
    explicit: state.options.mcpServerPath,
    dataRoot: state.dataRoot,
  })
  check.server.installed = binary !== undefined
  const reported = binary === undefined ? undefined : await state.tools.serverVersion(binary.path)
  const currentVersion = parseVersion(reported)
  check.server.current = currentVersion === undefined ? reported : formatVersion(currentVersion)
  try {
    const latest = await state.tools.latestServerRelease({
      routes: state.acceleration.routes,
      timeoutMs: 30_000,
      log: state.log,
    })
    check.server.latest = latest.version
    check.server.outdated = check.server.installed && isNewer(latest.version, currentVersion)
  } catch (cause) {
    check.server.error = messageOf(cause)
  }

  const toolkits = await discoverToolkits({
    explicitRoots: state.options.toolkitRoots,
    dataRoots: [state.dataRoot],
  })
  const root = toolkits[0]?.root
  check.toolkit.installed = root !== undefined
  const installed = root === undefined ? undefined : await state.tools.readToolkitRelease(root)
  check.toolkit.current = installed?.tag
  // A catalog the plugin did not install (an explicit `toolkitRoots` entry) is
  // never replaced by a download, so asking for its newest release would offer an
  // update that writes somewhere else.
  const managed = root !== undefined && resolve(root) === resolve(toolkitDirectory(state.dataRoot, 'matlab'))
  if (root === undefined || managed) {
    try {
      const latest = await state.tools.latestToolkitRelease({
        routes: state.acceleration.routes,
        timeoutMs: 30_000,
        log: state.log,
      })
      check.toolkit.latest = latest.tag
      check.toolkit.outdated = latest.tag !== installed?.tag
    } catch (cause) {
      check.toolkit.error = messageOf(cause)
    }
  }

  state.updates = check
  return check
}

/**
 * Replace whichever artifact has a newer published version.
 *
 * The running halves are stopped before their files are touched: Windows will
 * not replace a binary a process has open, and a skill watcher would fight a
 * checkout being rewritten underneath it.
 * @param state - activation state.
 * @param check - the comparison that decided what to replace.
 */
async function runUpdate(state, check) {
  const { tools, status, log } = state
  try {
    if (state.updatePlan.toolkit) {
      setProgress(state, { kind: 'update', stage: 'toolkit', active: true, bytes: 0, totalBytes: undefined, route: undefined })
      await disposeChild(state, 'skillFiber')
      const installed = await tools.updateToolkit({
        kind: 'matlab',
        dataRoot: state.dataRoot,
        routes: state.acceleration.routes,
        timeoutMs: state.options.provisionTimeoutMs,
        onAttempt: attempt => setProgress(state, { route: routeLabel(attempt.route) }),
        onProgress: progress => setProgress(state, { bytes: progress.bytes, totalBytes: progress.totalBytes }),
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await mountSkillCatalog(state, await discoverToolkits({ explicitRoots: [installed.root] }), false)
    }
    if (state.updatePlan.tools) {
      setProgress(state, { kind: 'update', stage: 'download', active: true, bytes: 0, totalBytes: undefined, route: undefined })
      await disposeChild(state, 'toolFiber')
      const binary = await tools.updateMcpServer({
        dataRoot: state.dataRoot,
        platform: process.platform,
        arch: process.arch,
        routes: state.acceleration.routes,
        provisionTimeoutMs: state.options.provisionTimeoutMs,
        onProgress: progress => setProgress(state, { bytes: progress.bytes, totalBytes: progress.totalBytes }),
        log: entry => log(entry.level === 'info' ? 'info' : 'warn', entry.message),
      })
      await bindTools(state, binary)
      if (binary.route !== undefined) setProgress(state, { route: routeLabel(binary.route) })
    }
    setProgress(state, { active: false, stage: 'done', error: undefined })
    status.phase = status.error === undefined ? 'ready' : 'failed'
    // The comparison just ran, so reporting the new versions costs no network:
    // whatever was replaced is now at its latest, and the other half was already.
    state.updates = {
      checkedAt: Date.now(),
      server: { ...check.server, installed: true, current: check.server.latest, outdated: false, error: undefined },
      toolkit: { ...check.toolkit, installed: true, current: check.toolkit.latest, outdated: false, error: undefined },
    }
    log('info', `MATLAB dependencies updated (${describeUpdate(check)})`)
  } catch (cause) {
    const message = messageOf(cause)
    setProgress(state, { active: false, stage: 'failed', error: message })
    status.phase = 'failed'
    status.error = message
    log('error', `dependency update failed: ${message}`)
    // An update that stopped halfway must not cost the profile its capability:
    // the previous checkout and binary are still on disk, so mount them back.
    await recoverAfterFailedUpdate(state)
  } finally {
    if (state.remountRequested === true) {
      state.remountRequested = false
      void remount(state)
    }
  }
}

/**
 * Mount whatever is on disk after a failed replacement.
 * @param state - activation state.
 */
async function recoverAfterFailedUpdate(state) {
  try {
    await disposeChildren(state)
    const toolkits = await discoverToolkits({
      explicitRoots: state.options.toolkitRoots,
      dataRoots: [state.dataRoot],
    })
    if (toolkits.length > 0) await mountSkillCatalog(state, toolkits, false)
    const binary = await state.tools.findMcpServer({
      explicit: state.options.mcpServerPath,
      dataRoot: state.dataRoot,
    })
    if (binary !== undefined) await bindTools(state, binary)
    state.log('warn', 'kept the previously installed MATLAB artifacts after the failed update')
  } catch {
    // The update failure stays the reported one; this is only a best effort.
  }
}

/** One log line naming what changed. */
function describeUpdate(check) {
  const parts = []
  if (check.toolkit.outdated === true) parts.push(`toolkit ${check.toolkit.current ?? 'unknown'} -> ${String(check.toolkit.latest)}`)
  if (check.server.outdated === true) parts.push(`server ${String(check.server.current)} -> ${String(check.server.latest)}`)
  return parts.join(', ')
}

/**
 * Check for newer artifacts and start replacing the outdated ones.
 * @param state - activation state.
 * @returns whether an update started, and the comparison it acted on.
 */
async function updateDependencies(state) {
  if (state.provisioning !== undefined) {
    return { started: false, phase: 'provisioning', check: state.updates }
  }
  const check = await checkDependencies(state)
  const plan = {
    toolkit: check.toolkit.outdated === true,
    tools: check.server.outdated === true,
  }
  if (!plan.toolkit && !plan.tools) return { started: false, upToDate: true, check }
  state.updatePlan = plan
  setProgress(state, {
    kind: 'update',
    active: true,
    stage: plan.toolkit ? 'toolkit' : 'download',
    bytes: 0,
    totalBytes: undefined,
    route: undefined,
    error: undefined,
    startedAt: Date.now(),
  })
  state.status.phase = 'provisioning'
  state.provisioning = runUpdate(state, check).finally(() => {
    state.provisioning = undefined
  })
  return { started: true, check }
}

/**
 * Apply the settings DSH just committed: remount the halves they affect.
 *
 * Discovery and mounting are local, so a remount costs milliseconds; the
 * binary and the toolkits are already on disk. A remount requested while a
 * fetch is running waits for it ({@link provision}).
 * @param state - activation state.
 */
async function remount(state) {
  if (state.remounting === true || state.provisioning !== undefined) {
    state.remountRequested = true
    return
  }
  state.remounting = true
  try {
    state.options = resolveOptions(state.config)
    // A saved field must take effect without a restart, including the two
    // inputs the MCP argv is built from: the GitHub acceleration the next fetch
    // will use, and the MATLAB root a remounted bridge would start.
    state.acceleration = await state.tools.resolveGithubAcceleration({
      githubProxy: state.options.githubProxy ?? null,
      downloadRegion: state.options.downloadRegion,
      profileDirectory: await state.tools.resolveProfileDirectory({
        profileDirectory: launchedProfileDirectory(state.ctx),
        dshHome: resolveDshHome(),
        env: process.env,
      }),
      env: process.env,
      log: entry => state.log(entry.level === 'info' ? 'info' : 'warn', entry.message),
    })
    state.status.github = {
      region: state.acceleration.region,
      regionSource: state.acceleration.regionSource,
      proxy: state.acceleration.proxy,
      proxySource: state.acceleration.source,
      routes: state.acceleration.routes.map(routeLabel),
    }
    state.matlab = await state.tools.discoverMatlabRoot({
      explicit: state.options.matlabRoot,
    })
    state.status.matlab = state.matlab
    if (state.matlab !== undefined && state.matlab.exists === false) {
      state.log('warn', `matlabRoot does not exist: ${state.matlab.root}`)
    }
    await disposeChildren(state)
    const toolkits = await discoverToolkits({
      explicitRoots: state.options.toolkitRoots,
      dataRoots: [state.dataRoot],
    })
    await mountSkillCatalog(state, toolkits, false)
    const binary = await state.tools.findMcpServer({
      explicit: state.options.mcpServerPath,
      dataRoot: state.dataRoot,
    })
    if (binary !== undefined) await bindTools(state, binary)
    state.status.phase = state.status.error === undefined ? 'ready' : 'failed'
    state.log('info', 'settings applied')
  } catch (cause) {
    const message = messageOf(cause)
    state.status.error = message
    state.status.phase = 'failed'
    state.log('error', `could not apply the new settings: ${message}`)
  } finally {
    state.remounting = false
    if (state.remountRequested === true) {
      state.remountRequested = false
      void remount(state)
    }
  }
}

/**
 * Coalesce the several `loader/volatile-update` events one save may produce.
 * @param state - activation state.
 */
function scheduleRemount(state) {
  clearTimeout(state.remountTimer)
  state.remountTimer = setTimeout(() => {
    state.remountTimer = undefined
    void remount(state)
  }, 120)
  state.remountTimer.unref?.()
}

/**
 * Expose the resolved connectivity state over HTTP for diagnosis.
 *
 * The carrier may arrive after this plugin (see `mountWhenWebServer`), so the
 * route is registered through the same deferred path the JSON API uses.
 * @param state - activation state.
 */
function mountStatusRoute(state) {
  mountWhenWebServer(state, 'matlab-agentic: status route', webServer => [
    webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      resource: async () => new Response(`${JSON.stringify(state.status, null, 2)}\n`, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      }),
    }),
  ])
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
    plugin: PACKAGE_NAME,
    version: VERSION,
    phase: 'starting',
    matlab: undefined,
    server: undefined,
    toolkit: undefined,
    toolkitRelease: undefined,
    github: undefined,
    progress: idleProgress(),
    skills: [],
    probe: undefined,
    warnings: [],
    error: undefined,
  }
  const dshHome = resolveDshHome()
  const dataRoot = join(dshHome, 'matlab')

  /** Everything the mount helpers, the API, and the background fetch share. */
  const state = {
    ctx,
    config,
    options,
    tools,
    status,
    log,
    ns: PLUGIN_ID,
    dataRoot,
    acceleration: { routes: [null], region: 'global', regionSource: 'default', proxy: null, source: 'none' },
    matlab: undefined,
    logFolder: join(dataRoot, 'logs'),
    toolkits: [],
    groups: [],
    plan: { toolkit: false, tools: false },
    updatePlan: { toolkit: false, tools: false },
    updates: undefined,
    progress: idleProgress(),
    provisioning: undefined,
    skillFiber: undefined,
    toolFiber: undefined,
    remounting: false,
    remountRequested: false,
    remountTimer: undefined,
  }
  status.progress = state.progress
  state.startProvisioning = plan => startProvisioning(state, plan)
  state.checkDependencies = () => checkDependencies(state)
  state.updateDependencies = () => updateDependencies(state)

  if (options.statusRoute) mountStatusRoute(state)
  mountPluginApi(state)

  // ---- GitHub acceleration ------------------------------------------------
  // Both artifacts come from github.com, and a first fetch must still fit in a
  // startup that DSH Desktop abandons after 60 seconds. The route DSH already
  // chose (environment, market setting, or the China table) decides how much of
  // that budget the transfer needs.
  state.acceleration = await tools.resolveGithubAcceleration({
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
    region: state.acceleration.region,
    regionSource: state.acceleration.regionSource,
    proxy: state.acceleration.proxy,
    proxySource: state.acceleration.source,
    routes: state.acceleration.routes.map(routeLabel),
  }
  log('info', `github: ${status.github.routes.join(' -> ')} (region ${state.acceleration.region} from ${state.acceleration.regionSource})`)

  // Settings are committed without a restart, so the running binding has to
  // follow the values rather than the ones captured at activation.
  ctx.on('loader/volatile-update', () => scheduleRemount(state))

  // ---- Toolkit skills -----------------------------------------------------
  status.phase = 'skills'
  state.toolkits = await discoverToolkits({
    explicitRoots: options.toolkitRoots,
    dataRoots: [dataRoot],
  })
  if (state.toolkits.length === 0 && options.autoProvision) {
    state.plan.toolkit = true
    // A toolkit archive is a whole catalog: megabytes over one HTTP response,
    // which is exactly what a startup budget cannot host.
    log('info', 'no MATLAB Agentic Toolkit found; downloading the newest release in the background so the fetch cannot hold up startup')
  } else {
    await mountSkillCatalog(state, state.toolkits, true)
  }

  // ---- MATLAB tools -------------------------------------------------------
  status.phase = state.plan.toolkit ? 'provisioning' : 'tools'
  state.matlab = await tools.discoverMatlabRoot({
    explicit: options.matlabRoot,
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
    dataRoot,
  })
  if (existing !== undefined && !state.plan.toolkit) {
    await bindTools(state, existing)
  } else if (existing !== undefined) {
    // The binary is here, but the toolkit half is still being fetched and its
    // `mcp-server-extensions` belong in the first connection: bind the tools
    // after that fetch, in the background task, rather than connect twice.
    state.plan.tools = true
    // Publish the binary now so the Settings page does not call an installed
    // server "not installed" for the duration of the toolkit install.
    state.status.server = { path: existing.path, source: existing.source, version: undefined }
  } else if (options.mcpServerPath !== undefined) {
    throw new Error(`matlab-agentic: mcpServerPath does not point at a file: ${options.mcpServerPath}`)
  } else if (options.autoProvision !== true) {
    throw new Error(
      'matlab-agentic: the MATLAB MCP Server binary was not found. Install the plugin dependencies '
      + 'from Settings → MATLAB, or set mcpServerPath.',
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
  const started = await startProvisioning(state, state.plan)
  if (!started.started) {
    status.phase = status.error === undefined ? 'ready' : 'failed'
    return status
  }
  if (options.provisionWaitMs > 0) {
    // A profile that would rather hold the start than appear without MATLAB
    // tools can wait, but only as long as it asked: whatever is still fetching
    // when the wait expires keeps going in the background.
    let timer
    const waited = new Promise(resolve => {
      timer = setTimeout(resolve, options.provisionWaitMs)
    })
    try {
      await Promise.race([state.provisioning ?? Promise.resolve(), waited])
    } finally {
      // The loser of the race must not keep the process alive.
      clearTimeout(timer)
    }
  }
  return status
}
