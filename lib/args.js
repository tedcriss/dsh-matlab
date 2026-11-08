/**
 * Translate plugin settings into MATLAB MCP Server flags.
 *
 * The flag set is MathWorks' documented CLI, not an invented one. Two of their
 * rules are enforced here because violating them makes the server refuse to
 * start: `--matlab-session-mode=existing` may not be combined with
 * `--matlab-root`, `--matlab-display-mode`, or `--initial-working-folder`, and
 * repeated `--extension-file` values are separate flags rather than one joined
 * value.
 *
 * @module dsh-plugin-matlab/args
 */

/**
 * Build the argument vector for `matlab-mcp-server`.
 * @param options - resolved connectivity settings.
 * @param options.matlabRoot - installation root to start.
 * @param options.sessionMode - `auto`, `new`, or `existing`.
 * @param options.displayMode - `desktop` or `nodesktop`.
 * @param options.initialWorkingFolder - folder MATLAB starts in.
 * @param options.initializeMatlabOnStartup - start MATLAB before the first tool call.
 * @param options.disableTelemetry - opt out of MathWorks data collection.
 * @param options.logFolder - folder for server logs; the OS temp default can be unusable on Windows.
 * @param options.logLevel - `debug`, `info`, `warn`, or `error`.
 * @param options.extensionFiles - MCP tool definition files.
 * @returns the argument vector plus the settings that had to be dropped.
 */
export function buildMcpServerArgs(options = {}) {
  const args = []
  const warnings = []
  const sessionMode = options.sessionMode ?? 'auto'
  args.push(`--matlab-session-mode=${sessionMode}`)

  if (sessionMode === 'existing') {
    // MathWorks documents this combination as unsupported: the shared session owns its own folder and UI.
    for (const [label, value] of [
      ['matlabRoot', options.matlabRoot],
      ['initialWorkingFolder', options.initialWorkingFolder],
      ['displayMode', options.displayMode === 'nodesktop' ? 'nodesktop' : undefined],
    ]) {
      if (value !== undefined && value !== null && value !== '') {
        warnings.push(`--matlab-session-mode=existing does not accept ${label}; the shared MATLAB session keeps its own setting`)
      }
    }
  } else {
    if (options.matlabRoot !== undefined && options.matlabRoot !== '') {
      args.push(`--matlab-root=${options.matlabRoot}`)
    }
    args.push(`--matlab-display-mode=${options.displayMode ?? 'desktop'}`)
    if (options.initialWorkingFolder !== undefined && options.initialWorkingFolder !== '') {
      args.push(`--initial-working-folder=${options.initialWorkingFolder}`)
    }
  }
  if (options.initializeMatlabOnStartup === true) {
    args.push('--initialize-matlab-on-startup=true')
  }
  if (options.disableTelemetry === true) {
    args.push('--disable-telemetry=true')
  }
  if (options.logFolder !== undefined && options.logFolder !== '') {
    args.push(`--log-folder=${options.logFolder}`)
  }
  if (options.logLevel !== undefined && options.logLevel !== '') {
    args.push(`--log-level=${options.logLevel}`)
  }
  for (const file of options.extensionFiles ?? []) {
    args.push(`--extension-file=${file}`)
  }
  return { args, warnings }
}

/**
 * Merge the environment the server needs on top of the ambient one.
 *
 * `dsh-mcp-client` scrubs `*KEY*`, `*PASSWORD*`, `*SECRET*`, `*TOKEN*`, and
 * `DSH_*` names before spawning. `WINDIR` survives that filter and MATLAB
 * needs it on Windows, so it is re-declared explicitly to survive any future
 * tightening and to document the dependency.
 * @param platform - `process.platform` value.
 * @param env - ambient environment.
 * @returns extra variables for the MCP child process.
 */
export function serverEnvironment(platform = process.platform, env = process.env) {
  const extra = {}
  if (platform === 'win32' && typeof env.WINDIR === 'string' && env.WINDIR.length > 0) {
    extra.WINDIR = env.WINDIR
  }
  return extra
}
