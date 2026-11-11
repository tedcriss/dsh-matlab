/**
 * The plugin's own identity, read from the one file that declares it.
 *
 * `package.json` is the only place the plugin version is written down. Modules
 * that have to report a version — the MCP probe's `clientInfo`, the status
 * snapshot — read it from here instead of repeating the literal, so the version
 * DSH installed and the version the plugin announces cannot drift apart.
 *
 * @module dsh-plugin-matlab/version
 */

import { readFileSync } from 'node:fs'

/** The package manifest, parsed once when the module loads. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** The npm package name; also the `clientInfo.name` the probe announces. */
export const PACKAGE_NAME = String(manifest.name)

/** The plugin version, as installed and as announced to MATLAB. */
export const VERSION = String(manifest.version)
