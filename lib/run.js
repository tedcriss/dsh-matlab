/**
 * Minimal argv-only subprocess helper.
 *
 * Nothing here interpolates a shell string: every call passes an executable
 * and an argument array, so a path containing spaces or shell metacharacters
 * stays one argument.
 *
 * @module dsh-matlab/run
 */

import { spawn } from 'node:child_process'

/** Bytes of captured output retained per stream before truncation. */
const MAX_CAPTURE_BYTES = 1 << 20

/**
 * Run a command to completion.
 * @param command - executable name or absolute path.
 * @param args - argument vector.
 * @param options - `cwd`, `env`, `timeoutMs`, and `allowFailure`.
 * @returns exit code and captured output; rejects only when `allowFailure` is false and the command fails.
 */
export async function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000
  return await new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      })
    } catch (cause) {
      if (options.allowFailure === true) {
        resolve({ code: -1, stdout: '', stderr: String(cause) })
        return
      }
      reject(cause)
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', chunk => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString('utf8')
    })
    child.on('error', error => {
      clearTimeout(timer)
      if (options.allowFailure === true) resolve({ code: -1, stdout, stderr: String(error) })
      else reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (options.allowFailure === true || code === 0) {
        resolve({ code: code ?? -1, stdout, stderr })
        return
      }
      reject(new Error(`${command} exited with ${String(code)}: ${stderr.trim()}`))
    })
  })
}
