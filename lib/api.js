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
 * page already reads.
 *
 * The carrier has two route shapes, and choosing the wrong one silently breaks
 * half the page: `resource` maps a Fetch `Request` to a `Response` but the
 * carrier answers every method other than `GET`/`HEAD` with its own 405 before
 * the function runs, so a mutation posted through it is never delivered. A
 * `handler` owns the Node request/response pair and therefore is the only shape
 * that can read a `POST` body. Reads stay `resource`; every mutation is a
 * `handler` ({@link answerPost}).
 *
 * @module dsh-plugin-matlab/api
 */

/** Base path of the plugin's JSON routes. */
export const API_BASE = '/plugin/matlab'

/** Largest mutation body the page may post; the whole config form is a few KiB. */
const MAX_BODY_BYTES = 256 * 1024

/** One path per question the client asks. */
export const API_PATHS = Object.freeze({
  state: `${API_BASE}/state`,
  progress: `${API_BASE}/progress`,
  config: `${API_BASE}/config`,
  provision: `${API_BASE}/provision`,
  update: `${API_BASE}/update`,
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
  'agentName',
  'toolCallTimeoutMs',
  'githubProxy',
  'downloadRegion',
  'provisionTimeoutMs',
  'provisionWaitMs',
  'toolkitRoots',
  'skillGroups',
  'extensionFiles',
  'watchSkills',
])

/**
 * Run route registrations once the host's web carrier exists.
 *
 * `webServer` is typically mounted after this plugin — DSH's own market injects
 * it for the same reason — so `ctx.get('webServer')` at activation time is
 * `undefined` and every route would answer 404 for the life of the process.
 * `ctx.inject` runs the registration when the service appears and disposes it
 * when the service goes away, which is the contract a route has with its
 * carrier.
 * @param state - activation state.
 * @param label - effect label for diagnostics.
 * @param register - receives the web server; returns its route disposers.
 */
export function mountWhenWebServer(state, label, register) {
  const { ctx, log } = state
  const install = webServer => {
    const offs = register(webServer)
    return () => {
      for (const off of offs) off()
    }
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], child => {
      child.effect(() => install(child.webServer), label)
    })
    return
  }
  const webServer = ctx.get?.('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    ctx.effect(() => install(webServer), label)
    return
  }
  log('debug', 'no web server in this profile; MATLAB routes are not served')
}

/**
 * Register the plugin's JSON routes.
 * @param state - activation state shared with the background fetch.
 * @param state.ctx - plugin context.
 * @returns nothing; the routes are owned by the plugin's fiber.
 */
export function mountPluginApi(state) {
  mountWhenWebServer(state, 'matlab-agentic: settings routes', webServer => {
    const offs = [
      webServer.register({ kind: 'exact', path: API_PATHS.state, resource: () => jsonResponse(stateView(state)) }),
      webServer.register({ kind: 'exact', path: API_PATHS.progress, resource: () => jsonResponse(progressView(state.progress)) }),
      webServer.register({ kind: 'exact', path: API_PATHS.config, handler: (request, response) => saveConfig(state, request, response) }),
      webServer.register({ kind: 'exact', path: API_PATHS.provision, handler: (request, response) => provisionNow(state, request, response) }),
      webServer.register({ kind: 'exact', path: API_PATHS.update, handler: (request, response) => updateNow(state, request, response) }),
    ]
    // A line in the log now answers "is the Settings page able to talk to the
    // Host?" without making the reader guess from a 404 in the page.
    state.log('info', `settings API ready (${API_BASE}/state, /progress, /config, /provision, /update)`)
    return offs
  })
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
      agentName: options.agentName,
      toolCallTimeoutMs: options.toolCallTimeoutMs,
      githubProxy: options.githubProxy ?? '',
      downloadRegion: options.downloadRegion,
      provisionTimeoutMs: options.provisionTimeoutMs,
      provisionWaitMs: options.provisionWaitMs,
      toolkitRoots: options.toolkitRoots,
      skillGroups: options.skillGroups,
      extensionFiles: options.extensionFiles,
      watchSkills: options.watchSkills,
    },
    groups: state.groups,
    matlab: state.matlab ?? null,
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
    updates: state.updates ?? null,
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
    kind: record.kind ?? 'install',
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
 * @param request - the Node request carrying `{ patch, revision }`.
 * @param response - the Node response, owned to completion.
 */
async function saveConfig(state, request, response) {
  await answerPost(request, response, async body => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, payload: { ok: false, error: 'body must be a JSON object' } }
    }
    const outcome = await applyConfigPatch(state, body.patch, body.revision)
    if (outcome.status !== 200) return { status: outcome.status, payload: { ok: false, error: outcome.error } }
    state.log('info', 'settings updated through the plugin page; remounting what they affect')
    return { status: 200, payload: { ok: true } }
  })
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
 * @param request - the Node request; `POST` only.
 * @param response - the Node response.
 */
async function provisionNow(state, request, response) {
  await answerPost(request, response, async () => {
    const outcome = await state.startProvisioning()
    return { status: outcome.started ? 202 : 200, payload: { ok: true, ...outcome } }
  })
}

/**
 * Check for newer artifacts, or install them.
 *
 * `{ check: true }` only reads the published tags (two small probes) and reports
 * what is outdated; the default starts the update, which stops the running
 * halves before replacing what they run from.
 * @param state - activation state.
 * @param request - the Node request; `POST` only.
 * @param response - the Node response.
 */
async function updateNow(state, request, response) {
  await answerPost(request, response, async body => {
    if (body?.check === true) {
      const check = await state.checkDependencies()
      return { status: 200, payload: { ok: true, ...check } }
    }
    const outcome = await state.updateDependencies()
    return { status: outcome.started ? 202 : 200, payload: { ok: true, ...outcome } }
  })
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

/**
 * Answer one JSON mutation on the web carrier.
 *
 * The carrier routes only `GET`/`HEAD` to a `resource` and answers every other
 * method with its own 405 before the function is called, so a mutation must
 * register as a `handler`. This wrapper owns that Node exchange: method,
 * same-origin guard, body parsing with a bound, and a JSON answer in every
 * case, including a thrown background failure.
 * @param request - Node request.
 * @param response - Node response, owned to completion.
 * @param run - receives the parsed body; returns `{ status, payload }`.
 */
async function answerPost(request, response, run) {
  if (request.method !== 'POST') return methodNotAllowed(response, 'POST')
  if (!sameOrigin(request)) return writeJson(response, { ok: false, error: 'cross-origin request refused' }, 403)
  const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return writeJson(response, { ok: false, error: 'content-type must be application/json' }, 415)
  }
  let body
  try {
    body = await readNodeJson(request)
  } catch (cause) {
    return writeJson(response, { ok: false, error: messageOf(cause) }, cause.statusCode ?? 400)
  }
  try {
    const outcome = await run(body)
    writeJson(response, outcome.payload, outcome.status)
  } catch (cause) {
    writeJson(response, { ok: false, error: messageOf(cause) }, 500)
  }
}

/**
 * Read one bounded JSON body from a Node request.
 * @param request - Node request stream.
 * @returns the parsed value; an empty body is `{}`.
 */
async function readNodeJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw httpError(413, 'request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, 'body must be JSON')
  }
}

/** Whether a mutation came from this GUI origin; a missing Origin (curl) is allowed. */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause)
}

function methodNotAllowed(response, allowed) {
  writeJson(response, { ok: false, error: `method not allowed; use ${allowed}` }, 405, { allow: allowed })
}

/**
 * Write one JSON response on a Node response.
 * @param response - Node response.
 * @param payload - JSON-serializable body.
 * @param status - HTTP status.
 * @param headers - extra headers.
 */
function writeJson(response, payload, status = 200, headers = {}) {
  if (response.writableEnded === true) return
  const text = JSON.stringify(payload)
  try {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
      ...headers,
    })
    response.end(text)
  } catch {
    // The page navigated away mid-answer; there is nothing left to write to.
    response.destroy?.()
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
