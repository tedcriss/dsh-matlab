/**
 * MATLAB Agentic Toolkit binding for DeepSeek Harness.
 *
 * The plugin contributes no MATLAB capability of its own: it resolves the
 * MATLAB MCP Server executable and the MathWorks Agentic Toolkit skill groups,
 * then mounts `@deepseek-ai/dsh-mcp-client` and
 * `@deepseek-ai/dsh-skill-filesystem` against them.
 *
 * @module dsh-plugin-matlab
 */

import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export declare const name = 'matlab-agentic'

/** The plugin declares no required service; each mounted child declares its own. */
export declare const inject: readonly string[]

/** HTTP path serving the resolved connectivity state. */
export declare const STATUS_PATH = '/plugin/matlab/status'

/** The npm package name, read from `package.json`. */
export declare const PACKAGE_NAME: string

/** The plugin version, read from `package.json`; the only version literal in the source tree. */
export declare const VERSION: string

/** Client identity the probe reports in the MCP `initialize` request. */
export declare const CLIENT_INFO: { readonly name: string; readonly version: string }

/** Plugin configuration. */
export interface ConfigOptions {
  /** MCP namespace; tools appear as `mcp__<serverName>__<tool>`. Defaults to `matlab`. */
  serverName: string
  /** Name MATLAB shows for the agent behind the MCP connection. Defaults to `DeepSeek`. */
  agentName: string
  /** Per-call timeout for MATLAB tools in milliseconds. Defaults to 600000. */
  toolCallTimeoutMs: number
  /** Reject plugin activation when the MATLAB tool connection fails. Defaults to false. */
  failOnStartupError: boolean
  /** MATLAB installation root; empty discovers it. */
  matlabRoot: string
  /** Whether MATLAB starts with its desktop. */
  displayMode: 'desktop' | 'nodesktop'
  /** Connect to a shared MATLAB session or start a new one. */
  sessionMode: 'auto' | 'existing' | 'new'
  /** Folder MATLAB starts in; empty uses the DSH working directory. */
  initialWorkingFolder: string
  /** Start MATLAB as soon as the MCP server starts. */
  initializeMatlabOnStartup: boolean
  /** Pass `--disable-telemetry` to the MATLAB MCP Server. */
  disableTelemetry: boolean
  /** Path to the `matlab-mcp-server` executable; empty discovers or downloads it. */
  mcpServerPath: string
  /** Download the server binary and clone the toolkit when absent. */
  autoProvision: boolean
  /** HTTPS GitHub acceleration prefix, for example `https://gh-proxy.com`; empty follows DSH's own setting. */
  githubProxy: string
  /** Download region; `auto` follows DSH's market setting. */
  downloadRegion: 'auto' | 'china' | 'global'
  /** Budget for one first-time transfer (binary download or toolkit clone) in milliseconds. */
  provisionTimeoutMs: number
  /** How long activation may wait for a first-time fetch; 0 fetches in the background. */
  provisionWaitMs: number
  /** Toolkit checkouts to read skills from; empty uses only the plugin data folder. */
  toolkitRoots: string[]
  /** Skill groups to load; empty loads every group. */
  skillGroups: string[]
  /** Extra MCP tool definition files passed as `--extension-file`. */
  extensionFiles: string[]
  /** Reload the skill catalog when the toolkit changes on disk. */
  watchSkills: boolean
  /** Probe the MCP server before connecting. */
  probe: boolean
  /** Budget for one startup probe in milliseconds. */
  probeTimeoutMs: number
  /** Serve `GET /plugin/matlab/status`. */
  statusRoute: boolean
}

export declare const Config: Schema<ConfigOptions>

/** One skill group a toolkit declares. */
export interface SkillGroup {
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly path: string
  readonly required: boolean
  readonly requiresProducts: readonly string[]
  readonly toolkit: string
}

/** One toolkit checkout. */
export interface Toolkit {
  readonly root: string
  readonly displayName: string
  readonly kind: 'matlab' | 'simulink' | 'other'
  readonly groups: readonly SkillGroup[]
  readonly extensionFiles: readonly string[]
}

/** Which published release an installed toolkit came from. */
export interface ToolkitRelease {
  /** Install folder the release was extracted into. */
  readonly root: string
  /** Release tag, for example `MATK-2026.11.a`; absent for an unmarked checkout. */
  readonly tag?: string
  readonly installedAt?: string
  /** Whether the folder is the one the plugin owns, which is the only one it replaces. */
  readonly managed: boolean
}

/** Outcome of a stdio MCP handshake probe. */
export interface ProbeResult {
  readonly ok: boolean
  readonly protocolVersion?: string
  readonly serverInfo?: { readonly name?: string; readonly title?: string; readonly version?: string }
  readonly instructions?: string
  readonly tools: readonly { readonly name: string; readonly description: string }[]
  readonly resources: readonly { readonly uri: string; readonly name: string }[]
  readonly toolListError?: string
  readonly error?: string
  readonly stderr?: string
}


/** Resolved connectivity state served by `GET /plugin/matlab/status`. */
export interface ActivationStatus {
  readonly plugin: string
  /** The plugin's own version, read from its `package.json`. */
  readonly version: string
  readonly phase: 'starting' | 'skills' | 'tools' | 'provisioning' | 'ready' | 'failed'

  readonly matlab?: MatlabRoot
  readonly server?: {
    readonly path: string
    readonly source: string
    readonly version?: string
    readonly downloaded: boolean
    /** Route the download came through, when this plugin downloaded it. */
    readonly route?: string
  }
  /** The GitHub acceleration this activation resolved and where it came from. */
  readonly github?: {
    readonly region: 'china' | 'global'
    readonly regionSource: 'config' | 'market' | 'default'
    readonly proxy: string | null
    readonly proxySource: 'config' | 'environment' | 'market' | 'none'
    readonly routes: readonly string[]
  }
  /** First-time fetch progress, mirrored by `GET /plugin/matlab/progress`. */
  readonly progress?: {
    readonly active: boolean
    readonly kind: 'install' | 'update'
    readonly stage: 'idle' | 'toolkit' | 'download' | 'done' | 'failed'
    readonly bytes: number
    readonly totalBytes?: number
    readonly route?: string
    readonly startedAt?: number
    readonly error?: string
  }
  readonly toolkit?: readonly {
    readonly root: string
    readonly displayName: string
    readonly kind: string
    readonly groups: readonly string[]
    readonly extensionFiles: readonly string[]
  }[]
  /** Which published release the local catalog came from, when it is known. */
  readonly toolkitRelease?: ToolkitRelease
  readonly skills: readonly { readonly name: string; readonly toolkit: string; readonly path: string; readonly skills: number }[]
  readonly probe?: ProbeResult
  readonly warnings: readonly string[]
  readonly error?: string
}

/** Options for {@link buildMcpServerArgs}. */
export interface McpServerArgOptions {
  matlabRoot?: string
  sessionMode?: 'auto' | 'existing' | 'new'
  displayMode?: 'desktop' | 'nodesktop'
  initialWorkingFolder?: string
  initializeMatlabOnStartup?: boolean
  disableTelemetry?: boolean
  logFolder?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  extensionFiles?: readonly string[]
}

/**
 * Build the `matlab-mcp-server` argument vector.
 * @param options - resolved connectivity settings.
 * @returns the argument vector plus settings the server refuses in the chosen session mode.
 */
export declare function buildMcpServerArgs(options?: McpServerArgOptions): {
  args: string[]
  warnings: string[]
}

/**
 * Build the extra environment the MCP child process needs.
 * @param platform - `process.platform` value.
 * @param env - ambient environment.
 * @returns variables merged over the scrubbed ambient environment.
 */
export declare function serverEnvironment(
  platform?: NodeJS.Platform,
  env?: NodeJS.ProcessEnv,
): Record<string, string>

/** A discovered MATLAB root with the source that produced it. */
export interface MatlabRoot {
  readonly root: string
  readonly source: string
  readonly exists?: boolean
}

/**
 * Discover the MATLAB installation root.
 * @param options - explicit setting and injected seams.
 * @returns the chosen root, or `undefined` when no installation was found.
 */
export declare function discoverMatlabRoot(options?: {
  explicit?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  isDirectory?: (path: string) => Promise<boolean>
  readdir?: (path: string) => Promise<readonly { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]>
}): Promise<MatlabRoot | undefined>

/**
 * Rank a MATLAB release directory or registry version for newest-first ordering.
 * @param name - directory name or version.
 * @returns a sortable rank.
 */
export declare function releaseRank(name: string): number


/**
 * Candidate release asset names for one platform and architecture.
 * @param platform - `process.platform` value.
 * @param arch - `process.arch` value.
 * @returns asset names to try in order.
 */
export declare function assetCandidates(platform: string, arch: string): string[]

/**
 * Build the download URL for one release asset.
 * @param asset - release asset name.
 * @param tag - release tag or `latest`.
 * @returns an absolute URL.
 */
export declare function assetUrl(asset: string, tag?: string): string

/**
 * Whether a payload starts like a program this platform can run.
 * @param platform - `process.platform` value.
 * @param head - first bytes of the response.
 * @returns true when the payload is plausible for this platform.
 */
export declare function looksLikeExecutable(platform: string, head: Uint8Array | undefined): boolean

/** Public prefixes DSH's market ships for its China download region, best first. */
export declare const CHINA_GITHUB_ROUTES: readonly string[]

/**
 * Normalize one HTTPS acceleration prefix.
 * @param value - candidate prefix.
 * @returns the prefix without a trailing slash, or `null` when unusable.
 */
export declare function normalizeGithubProxy(value: unknown): string | null

/**
 * Wrap a GitHub URL in a prefix route.
 * @param route - prefix, or `null` to go direct.
 * @param url - absolute URL on a github.com-family host.
 * @returns the routed URL.
 */
export declare function throughProxy(route: string | null, url: string): string

/**
 * Build the ordered route chain for one region and prefix.
 * @param options - resolved region and custom prefix.
 * @returns ordered routes ending in the direct one.
 */
export declare function routesFor(options: {
  region: 'china' | 'global'
  proxy: string | null
}): (string | null)[]

/**
 * Resolve the acceleration this process should use.
 * @param options - configured statement, DSH facts, and seams.
 * @returns the effective region, prefix, where each came from, and the routes.
 */
export declare function resolveGithubAcceleration(options?: {
  githubProxy?: string | null
  downloadRegion?: 'auto' | 'china' | 'global'
  profileDirectory?: string
  env?: NodeJS.ProcessEnv
  log?: (entry: { level: string; message: string }) => void
}): Promise<{
  region: 'china' | 'global'
  regionSource: 'config' | 'market' | 'default'
  proxy: string | null
  source: 'config' | 'environment' | 'market' | 'none'
  routes: (string | null)[]
}>

/** One artifact's version comparison, as the Settings page shows it. */
export interface UpdateStatus {
  readonly installed: boolean
  readonly current?: string
  readonly latest?: string
  readonly outdated: boolean
  readonly error?: string
}

/** The result of checking both artifacts for newer published versions. */
export interface UpdatesCheck {
  readonly checkedAt: number
  readonly server: UpdateStatus
  readonly toolkit: UpdateStatus
}

/**
 * Read a `major.minor.patch` triple out of any string that carries one.
 * @param text - version text such as `v0.16.0` or a `--version` line.
 * @returns the triple, or `undefined`.
 */
export declare function parseVersion(text: unknown): [number, number, number] | undefined

/**
 * Render a triple the way MathWorks tags releases.
 * @param version - `[major, minor, patch]`.
 * @returns `v<major>.<minor>.<patch>`.
 */
export declare function formatVersion(version: readonly number[]): string

/**
 * Compare two triples.
 * @param left - `[major, minor, patch]`.
 * @param right - `[major, minor, patch]`.
 * @returns `1` when left is newer, `-1` when older, `0` when equal.
 */
export declare function compareVersions(left: readonly number[], right: readonly number[]): number

/**
 * Whether a published version is newer than an installed one.
 * @param latest - published version text or triple.
 * @param current - installed version text or triple; `undefined` means not installed.
 * @returns true when an update exists.
 */
export declare function isNewer(latest: unknown, current?: unknown): boolean

/**
 * Ask GitHub which release of a repository is newest.
 * @param options - repository slug, acceleration routes, and seams.
 * @returns the newest tag, the route that answered, and how it answered.
 */
export declare function latestRelease(options?: {
  slug: string
  label?: string
  routes?: readonly (string | null)[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
  log?: (entry: { level: string; message: string }) => void
}): Promise<{ tag: string; route: string | null; source: 'api' | 'page' }>

/**
 * Read the release tag a page or URL names.
 * @param text - page HTML, or a final response URL.
 * @returns the decoded tag, or `undefined`.
 */
export declare function releaseTagFromText(text: unknown): string | undefined

/**
 * Ask GitHub which MATLAB MCP Server release is newest.
 * @param options - acceleration routes and seams.
 * @returns the newest tag, its version, and the route that answered.
 */
export declare function latestServerRelease(options?: {
  routes?: readonly (string | null)[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
  log?: (entry: { level: string; message: string }) => void
}): Promise<{ tag: string; version: string; route: string | null; source: 'api' | 'page' }>

/** Repository and folder names of one installable toolkit. */
export interface ToolkitSource {
  readonly slug: string
  readonly folder: string
  readonly displayName: string
}

/** The toolkit repositories this plugin can install. */
export declare const TOOLKIT_SOURCES: Readonly<Record<'matlab' | 'simulink', ToolkitSource>>

/**
 * Where one toolkit is installed inside the plugin data folder.
 * @param dataRoot - the plugin data folder (`$DSH_HOME/matlab`).
 * @param kind - `matlab` or `simulink`.
 * @returns the absolute install directory.
 */
export declare function toolkitDirectory(dataRoot: string, kind: string): string

/**
 * Download URL of one release's source archive.
 * @param slug - GitHub `owner/name`.
 * @param tag - release tag.
 * @returns an absolute URL on github.com.
 */
export declare function releaseArchiveUrl(slug: string, tag: string): string

/**
 * Read which release an installed toolkit came from.
 * @param root - installed toolkit folder.
 * @returns the recorded release, or `undefined` when the folder carries no marker.
 */
export declare function readToolkitRelease(root: string): Promise<ToolkitRelease | undefined>

/** Options for installing or replacing a toolkit. */
export interface ToolkitInstallOptions {
  kind: 'matlab' | 'simulink'
  dataRoot: string
  routes?: readonly (string | null)[]
  tag?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  onAttempt?: (attempt: { route: string | null }) => void
  onProgress?: (progress: { bytes: number; totalBytes?: number }) => void
  log?: (entry: { level: string; message: string }) => void
}

/** What an install or update produced. */
export interface ToolkitInstallResult {
  readonly root: string
  readonly tag: string
  readonly route: string | null
  readonly bytes: number
  readonly files: number
  readonly skipped?: number
  /** True when a concurrent install had already produced the folder. */
  readonly reused?: boolean
}

/**
 * Install a toolkit from its newest release when none is present.
 * @param options - kind, destination root, routes, and diagnostic seams.
 * @returns the install root, its release tag, and the route that served it.
 */
export declare function installToolkit(options: ToolkitInstallOptions): Promise<ToolkitInstallResult>

/**
 * Replace a toolkit installation with the newest published release.
 * @param options - the same options {@link installToolkit} takes.
 * @returns the install root, its release tag, and the route that served it.
 */
export declare function updateToolkit(options: ToolkitInstallOptions): Promise<ToolkitInstallResult>

/**
 * Whether a payload starts like a gzip stream.
 * @param buffer - downloaded bytes.
 * @returns true when the two gzip magic bytes are present.
 */
export declare function isGzip(buffer: Uint8Array): boolean

/**
 * Read the entries of an uncompressed tar payload.
 * @param tar - uncompressed tar bytes.
 * @returns entries in archive order.
 */
export declare function listTarEntries(tar: Uint8Array): Array<{
  path: string
  type: 'file' | 'directory' | 'symlink'
  mode: number
  size: number
  link: string
  data: Uint8Array | undefined
}>

/**
 * Extract a `.tar.gz` payload into a directory.
 * @param archive - the gzip payload.
 * @param options - destination and the number of leading segments to strip.
 * @returns how many files were written, their total bytes, and what was skipped.
 */
export declare function extractTarGz(
  archive: Uint8Array,
  options: { destination: string; stripComponents?: number },
): Promise<{ files: number; bytes: number; skipped: number }>

/**
 * Discover Agentic Toolkit checkouts.
 * @param options - sources in priority order.
 * @returns unique toolkit records.
 */
export declare function discoverToolkits(options?: {
  explicitRoots?: readonly string[]
  dataRoots?: readonly string[]
  isDirectory?: (path: string) => Promise<boolean>
}): Promise<Toolkit[]>

/**
 * Read one toolkit checkout.
 * @param root - directory containing `manifest.yaml`.
 * @param isDirectory - directory probe.
 * @returns the toolkit record; a checkout without a manifest falls back to its catalog folders.
 */
export declare function readToolkit(
  root: string,
  isDirectory?: (path: string) => Promise<boolean>,
): Promise<Toolkit>

/**
 * Apply the configured group selection.
 * @param toolkits - discovered toolkits.
 * @param requested - configured group names; empty or `*` selects every group.
 * @returns selected groups and the names that matched nothing.
 */
export declare function selectSkillGroups(
  toolkits: readonly Toolkit[],
  requested: readonly string[],
): { groups: SkillGroup[]; unknown: string[] }

/**
 * Count the skills a group folder contributes.
 * @param directory - group folder.
 * @returns the number of `<skill>/SKILL.md` bundles.
 */
export declare function countSkills(directory: string): Promise<number>

/**
 * Probe the MATLAB MCP Server over stdio.
 * @param options - process, transport, and budget settings.
 * @returns the probe outcome; failures are reported rather than thrown.
 */
export declare function probeMcpServer(options: {
  command: string
  args?: readonly string[]
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}): Promise<ProbeResult>

/**
 * Parse the `skill-groups` section of a toolkit manifest.
 * @param text - `manifest.yaml` contents.
 * @returns declared groups, or `undefined` when the section is absent.
 */
export declare function parseSkillGroups(
  text: string,
): Array<Omit<SkillGroup, 'path' | 'toolkit'>> | undefined

/**
 * Parse the `mcp-server-extensions` section of a toolkit manifest.
 * @param text - `manifest.yaml` contents.
 * @returns relative extension paths, or `undefined` when the section is absent.
 */
export declare function parseMcpServerExtensions(text: string): string[] | undefined

/**
 * Normalize raw configuration into the shape the binding consumes.
 * @param config - schema-validated plugin config.
 * @returns normalized options with explicit absence.
 */
export declare function resolveOptions(config: ConfigOptions): {
  serverName: string
  agentName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  matlabRoot?: string
  displayMode: 'desktop' | 'nodesktop'
  sessionMode: 'auto' | 'existing' | 'new'
  initialWorkingFolder?: string
  initializeMatlabOnStartup: boolean
  disableTelemetry: boolean
  mcpServerPath?: string
  autoProvision: boolean
  githubProxy?: string
  downloadRegion: 'auto' | 'china' | 'global'
  provisionTimeoutMs: number
  provisionWaitMs: number
  toolkitRoots: string[]
  skillGroups: string[]
  extensionFiles: string[]
  watchSkills: boolean
  probe: boolean
  probeTimeoutMs: number
  statusRoute: boolean
}

/**
 * Resolve the Harness home the same way the launcher does.
 * @param env - environment map.
 * @returns the DSH home folder.
 */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string

/**
 * Activate the plugin.
 *
 * Cordis validates the value a plugin's activation resolves to and treats every
 * non-null, non-disposer result as an effect, so this entry point resolves to
 * `undefined`. Read the status from {@link activate} or the status route.
 * @param ctx - plugin context.
 * @param config - schema-validated configuration.
 */
export declare function apply(ctx: Context, config: ConfigOptions): Promise<void>

/**
 * Activate the binding with replaceable transports.
 * @param ctx - plugin context.
 * @param config - schema-validated configuration.
 * @param overrides - replacements for the default transports and platform seams.
 * @returns the resolved status.
 */
export declare function activate(
  ctx: Context,
  config: ConfigOptions,
  overrides?: Record<string, unknown>,
): Promise<ActivationStatus>
