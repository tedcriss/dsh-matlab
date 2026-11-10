/**
 * The plugin's own HTTP surface, for the Settings page and the progress dialog.
 *
 * The client half is deliberately thin: it renders what this module reports and
 * posts two kinds of intent — "save these settings" and "fetch what is missing".
 * Everything else (schema validation, the profile patch, the Loader reconcile)
 * stays in DSH's `settings` service, so the Settings page cannot invent config
 * that `cordis.patch.yml` would not accept.
 *
 * Routes are same-origin with the GUI page and answer JSON only. They are
 * registered on the same web carrier as `GET /plugin/matlab/status`, which the
 * page already reads; the carrier's own admission is what authorizes them.
 *
 * @module dsh-plugin-matlab/api
 */

/** Base path of the plugin's JSON routes. */
export const API_BASE = '/plugin/matlab'

/** One path per question the client asks. */
export const API_PATHS = Object.freeze({
  state: `${API_BASE}/state`,
  progress: `${API_BASE}/progress`,
  config: `${API_BASE}/config`,
  provision: `${API_BASE}/provision`,
})

/**
 * Fields the Settings page may write.
 *
 * Exactly the schema's `.volatile()` fields: DSH's `settings.update` refuses to
 * write anything else (an ordinary field change is a restart, not a form edit).
 * Keeping the list here means a page bug or a stale client gets a clear 400
 * instead of a confusing Loader error.
 */
export const EDITABLE_FIELDS = Object.freeze([
  'matlabRoot',
  'mcpServerPath',
  'displayMode',
  'sessionMode',
  'initialWorkingFolder',
  'initializeMatlabOnStartup',
  'disableTelemetry',
  'serverName',
  'toolCallTimeoutMs',
  'githubProxy',
  'downloadRegion',
  'provisionTimeoutMs',
  'provisionWaitMs',
  'installRoot',
  'toolkitRoots',
  'skillGroups',
  'extensionFiles',
  'watchSkills',
])

/**
 * Register the plugin's JSON routes.
 * @param state - activation state shared with the background fetch.
 * @param state.ctx - plugin context; `webServer` is optional.
 * @returns a disposer, or `undefined` when this profile has no web server.
 */
export function mountPluginApi(state) {
  const { ctx, log } = state
  const webServer = ctx.get?.('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') {
    log('debug', 'no web server in this profile; the MATLAB settings routes are not served')
    return undefined
  }
  const dispose = ctx.effect(() => {
    const offs = [
      webServer.register({ kind: 'exact', path: API_PATHS.state, resource: () => jsonResponse(stateView(state)) }),
      webServer.register({ kind: 'exact', path: API_PATHS.progress, resource: () => jsonResponse(progressView(state.progress)) }),
      webServer.register({ kind: 'exact', path: API_PATHS.config, resource: request => saveConfig(state, request) }),
      webServer.register({ kind: 'exact', path: API_PATHS.provision, resource: request => provisionNow(state, request) }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, 'matlab-agentic: settings routes')
  return dispose
}

/**
 * The page's whole view of the plugin.
 * @param state - activation state.
 * @returns JSON-serializable state.
 */
export function stateView(state) {
  const descriptor = ownDescriptor(state)
  const { status, options } = state
  return {
    plugin: 'dsh-plugin-matlab',
    phase: status.phase,
    error: status.error ?? null,
    revision: descriptor?.revision ?? null,
    editable: descriptor !== undefined,
    config: {
      matlabRoot: options.matlabRoot ?? '',
      mcpServerPath: options.mcpServerPath ?? '',
      displayMode: options.displayMode,
      sessionMode: options.sessionMode,
      initialWorkingFolder: options.initialWorkingFolder ?? '',
      initializeMatlabOnStartup: options.initializeMatlabOnStartup,
      disableTelemetry: options.disableTelemetry,
      serverName: options.serverName,
      toolCallTimeoutMs: options.toolCallTimeoutMs,
      githubProxy: options.githubProxy ?? '',
      downloadRegion: options.downloadRegion,
      provisionTimeoutMs: options.provisionTimeoutMs,
      provisionWaitMs: options.provisionWaitMs,
      installRoot: options.installRoot ?? '',
      toolkitRoots: options.toolkitRoots,
      skillGroups: options.skillGroups,
      extensionFiles: options.extensionFiles,
      watchSkills: options.watchSkills,
    },
    groups: state.groups,
    matlab: state.matlab ?? null,
    installer: status.installer ?? null,
    server: status.server ?? null,
    github: status.github ?? null,
    toolkit: status.toolkit ?? [],
    probe: status.probe === undefined
      ? null
      : {
        ok: status.probe.ok,
        tools: (status.probe.tools ?? []).map(tool => tool.name),
        resources: (status.probe.resources ?? []).map(resource => resource.uri),
        error: status.probe.error ?? null,
      },
    warnings: status.warnings ?? [],
    progress: progressView(state.progress),
  }
}

/**
 * Just enough of the fetch state for a progress bar.
 * @param progress - the shared progress record.
 * @returns JSON-serializable progress.
 */
export function progressView(progress) {
  const record = progress ?? { active: false, stage: 'idle' }
  const total = record.totalBytes
  const bytes = record.bytes ?? 0
  return {
    active: record.active === true,
    stage: record.stage ?? 'idle',
    bytes,
    totalBytes: total ?? null,
    percent: typeof total === 'number' && total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : null,
    route: record.route ?? null,
    startedAt: record.startedAt ?? null,
    elapsedMs: record.startedAt === undefined ? 0 : Date.now() - record.startedAt,
    error: record.error ?? null,
  }
}

/**
 * Save the fields the page edited.
 * @param state - activation state.
 * @param request - the HTTP request carrying `{ patch, revision }`.
 * @returns the HTTP response.
 */
async function saveConfig(state, request) {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const body = await readJson(request)
  if (body === null || typeof body !== 'object') return jsonResponse({ ok: false, error: 'body must be a JSON object' }, 400)
  const outcome = await applyConfigPatch(state, body.patch, body.revision)
  if (outcome.status !== 200) return jsonResponse({ ok: false, error: outcome.error }, outcome.status)
  state.log('info', 'settings updated through the plugin page; remounting what they affect')
  return jsonResponse({ ok: true })
}

/**
 * Merge one config patch through DSH's settings service.
 * @param state - activation state.
 * @param patch - fields to merge; must be {@link EDITABLE_FIELDS}.
 * @param revision - revision the page read, for conflict detection.
 * @returns `{ status }` on success, or `{ status, error }`.
 */
export async function applyConfigPatch(state, patch, revision) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { status: 400, error: 'patch must be a JSON object' }
  }
  for (const key of Object.keys(patch)) {
    if (!EDITABLE_FIELDS.includes(key)) return { status: 400, error: `"${key}" is not editable here` }
  }
  const settings = state.ctx.get?.('settings')
  if (settings === undefined || typeof settings.update !== 'function') {
    return { status: 503, error: 'the settings service is not available in this profile' }
  }
  try {
    await settings.update(state.ns, patch, revision)
    return { status: 200 }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // A moved revision means another editor touched the same form first.
    const conflict = /revision|changed since|conflict/iu.test(message)
    return { status: conflict ? 409 : 400, error: message }
  }
}

/**
 * Fetch whatever is missing, on demand.
 * @param state - activation state.
 * @param request - the HTTP request; `POST` only.
 * @returns the HTTP response.
 */
async function provisionNow(state, request) {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  const outcome = await state.startProvisioning()
  return jsonResponse({ ok: true, ...outcome }, outcome.started ? 202 : 200)
}

/** The descriptor DSH holds for this plugin, when the settings service is mounted. */
function ownDescriptor(state) {
  const settings = state.ctx.get?.('settings')
  if (settings === undefined || typeof settings.describe !== 'function') return undefined
  try {
    return settings.describe({ redactSecrets: true }).find(row => row.ns === state.ns)
  } catch {
    return undefined
  }
}

function methodNotAllowed(allowed) {
  return new Response(JSON.stringify({ ok: false, error: `method not allowed; use ${allowed}` }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: allowed },
  })
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
