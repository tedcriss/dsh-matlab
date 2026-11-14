/**
 * The plugin's own identity, read from the one file that declares it.
 *
 * `package.json` is the only place the plugin version is written down. Modules
 * that have to report a version — the MCP probe's `clientInfo`, the status
 * snapshot — read it from here instead of repeating the literal, so the version
 * DSH installed and the version the plugin announces cannot drift apart.
 *
 * @module dsh-matlab/version
 */

import { readFileSync } from 'node:fs'

/** The package manifest, parsed once when the module loads. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** The npm package name; also the `clientInfo.name` the probe announces. */
export const PACKAGE_NAME = String(manifest.name)

/** The plugin version, as installed and as announced to MATLAB. */
export const VERSION = String(manifest.version)

/**
 * Re-read the version currently installed on disk.
 *
 * {@link VERSION} is what this process loaded when it started. A plugin can be
 * updated and reloaded without restarting the host — the market and the settings
 * page both do that — and a status page that keeps announcing the old number is
 * then simply wrong. This reads the manifest the plugin is installed from, and
 * falls back to {@link VERSION} when it is unreadable (a packed install).
 * @returns the installed plugin version.
 */
export function readVersion() {
  try {
    const text = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    return String(JSON.parse(text).version)
  } catch {
    return VERSION
  }
}
