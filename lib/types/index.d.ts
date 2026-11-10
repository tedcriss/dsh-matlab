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

/** Plugin configuration. */
export interface ConfigOptions {
  /** MCP namespace; tools appear as `mcp__<serverName>__<tool>`. Defaults to `matlab`. */
  serverName: string
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
  /** MathWorks Agentic Toolkit install root; empty uses `~/.matlab/agentic-toolkits`. */
  installRoot: string
  /** Toolkit checkouts to read skills from; empty scans the installer layout. */
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

/** State the MathWorks Agentic Toolkit installer records in `config.json`. */
export interface InstallerConfig {
  readonly mcpServerVersion?: string
  readonly matlab?: { readonly root?: string; readonly version?: string }
  readonly toolkits?: Readonly<Record<string, { readonly version?: string; readonly source?: string }>>
  readonly sessionMode?: string
  readonly configurations?: Readonly<Record<string, unknown>>
}

/** Resolved connectivity state served by `GET /plugin/matlab/status`. */
export interface ActivationStatus {
  readonly plugin: 'dsh-plugin-matlab'
  readonly phase: 'starting' | 'skills' | 'tools' | 'provisioning' | 'ready' | 'failed'
  readonly installer?: {
    readonly root: string
    readonly configFound: boolean
    readonly matlabRoot?: string
    readonly serverVersion?: string
  }
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
    readonly stage: 'idle' | 'clone' | 'download' | 'done' | 'failed'
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
 * @param options - explicit setting, installer record, and injected seams.
 * @returns the chosen root, or `undefined` when no installation was found.
 */
export declare function discoverMatlabRoot(options?: {
  explicit?: string
  installerRoot?: string
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
 * Read the installer state file.
 * @param installRoot - MathWorks toolkit install root.
 * @returns the parsed config, or `undefined` when the installer never ran there.
 */
export declare function readInstallerConfig(installRoot: string): Promise<InstallerConfig | undefined>

/**
 * Read the MATLAB root the installer configured.
 * @param config - installer config.
 * @returns the recorded root, if any.
 */
export declare function installerMatlabRoot(config: InstallerConfig | undefined): string | undefined

/**
 * Read the server version the installer recorded.
 * @param config - installer config.
 * @returns the recorded version, if any.
 */
export declare function installerServerVersion(config: InstallerConfig | undefined): string | undefined

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

/**
 * Discover Agentic Toolkit checkouts.
 * @param options - sources in priority order.
 * @returns unique toolkit records.
 */
export declare function discoverToolkits(options?: {
  explicitRoots?: readonly string[]
  installRoot?: string
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
  installRoot?: string
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
