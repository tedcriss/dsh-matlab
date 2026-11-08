/**
 * MATLAB Agentic Toolkit binding for DeepSeek Harness.
 *
 * The plugin contributes no MATLAB capability of its own. MathWorks already
 * publishes the capability surface — the MATLAB MCP Server process that runs
 * MATLAB, and the `SKILL.md` knowledge in the Agentic Toolkit — and DSH already
 * publishes the transports — `dsh-mcp-client` for MCP tools and
 * `dsh-skill-filesystem` for skill catalogs. This plugin resolves the two
 * MathWorks artifacts and mounts those two DSH transports against them, so
 * every tool and every skill is the vendor's own content, unmodified.
 *
 * @module dsh-plugin-matlab
 */

import { Config } from './config.js'
import { activate } from './activate.js'

export { Config }
export { activate, resolveDshHome, STATUS_PATH } from './activate.js'
export { buildMcpServerArgs, serverEnvironment } from './args.js'
export { discoverMatlabRoot, releaseRank } from './matlab-root.js'
export { installerMatlabRoot, installerServerVersion, readInstallerConfig } from './installer.js'
export { assetCandidates, assetUrl } from './release.js'
export { countSkills, discoverToolkits, readToolkit, selectSkillGroups } from './toolkit.js'
export { probeMcpServer } from './probe.js'
export { parseMcpServerExtensions, parseSkillGroups } from './yaml-mini.js'
export { resolveOptions } from './options.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'matlab-agentic'

/** The plugin declares no required service; each mounted child declares its own. */
export const inject = []

/**
 * Activate the plugin.
 *
 * Cordis validates whatever a plugin's activation resolves to and treats every
 * non-null, non-disposer value as an effect, so this entry point must resolve to
 * `undefined`. The resolved status is a diagnostic value for tests and for
 * `/plugin/matlab/status`; {@link activate} returns it, `apply` discards it.
 * @param ctx - plugin context.
 * @param config - schema-validated configuration.
 * @param overrides - test seam replacing the transports; Cordis never passes it.
 */
export async function apply(ctx, config, overrides = {}) {
  await activate(ctx, config, overrides)
}
