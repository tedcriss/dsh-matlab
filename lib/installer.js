/**
 * Read the state the MathWorks Agentic Toolkit installer records.
 *
 * `setupAgenticToolkit` writes `<installRoot>/config.json` and puts the server
 * binary in `<installRoot>/bin/`, each toolkit checkout in
 * `<installRoot>/<toolkit>/`, and the selected skill groups per configured
 * agent. The plugin reads that file as a fact source — the MATLAB root the user
 * chose and the server version that is installed — and never writes it.
 *
 * @module dsh-plugin-matlab/installer
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Read the installer state file.
 * @param installRoot - MathWorks toolkit install root.
 * @returns the parsed config, or `undefined` when the installer never ran here.
 */
export async function readInstallerConfig(installRoot) {
  let text
  try {
    text = await readFile(join(installRoot, 'config.json'), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    // A hand-edited or truncated file is not a fact source; discovery continues without it.
    return undefined
  }
}

/**
 * Read the MATLAB root the installer configured.
 * @param config - installer config.
 * @returns the recorded root, if any.
 */
export function installerMatlabRoot(config) {
  const root = config?.matlab?.root
  return typeof root === 'string' && root.trim().length > 0 ? root.trim() : undefined
}

/**
 * Read the server version the installer recorded.
 * @param config - installer config.
 * @returns the recorded version, if any.
 */
export function installerServerVersion(config) {
  const version = config?.mcpServerVersion
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : undefined
}
