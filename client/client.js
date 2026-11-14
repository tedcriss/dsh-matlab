/**
 * The plugin's Web UI: one Settings page and the dependency toast.
 *
 * The page renders in two entries that the shell already allocates — the
 * Settings panel (`settings.section`) and a bundle's own page in the Plugin
 * Manager (`plugins.bundle.config`) — from this one component, so both entries
 * show the same form and write the same configuration. `view` is the only
 * difference the page makes: a section draws its own title and one-liner
 * (the shell owns neither for it), while a bundle page is already titled and
 * described by the Plugin Manager, so the page starts at the status line.
 *
 * All data comes from the plugin's own JSON routes, so this file carries no
 * policy: it shows what the Host resolved, posts field edits through DSH's
 * `settings` service, and asks the Host to fetch what is missing.
 *
 * Styling follows the harness's settings surface rather than inventing a look:
 * flat groups under one title, fields as a label over its control, hairlines
 * between fields instead of cards, the settings-panel fill for read-only
 * panels, a 36px switch and a segmented control for short enums. The controls
 * are written here instead of imported from a client package — a host package
 * changes without notice and a throwing component would blank the slot entry —
 * but their markup, metrics and behavior are copied from the primitives'
 * `src/*.tsx` and `*.module.css`, renamed under the `mp-` prefix, and every
 * color resolves through a `--dsw-alias-*` token (with a literal fallback for
 * the tokens outside the documented alias set) so both themes are covered.
 *
 * @module dsh-matlab/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-matlab',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** Locale namespace of this plugin's copy, separate from its package name. */
    const NS = 'matlab-agentic'

    const COPY = {
      zh: {
        nav: 'MATLAB',
        title: 'MATLAB 智能体工具包',
        intro: 'MathWorks 的 MCP 工具与技能目录，由 DSH 挂载。',
        refresh: '刷新',
        save: '保存',
        saving: '正在保存…',
        saved: '已保存',
        invalidNumber: '请填写有效的毫秒数',
        noGroupSelected: '至少保留一个技能组',
        revert: '放弃修改',
        loading: '正在载入…',
        readOnly: '当前 profile 没有 settings 服务：字段只读。',
        unknown: '—',
        notDetected: '未检测到',
        none: '无',
        tools: '工具',
        resources: '资源',
        error: '错误',
        phaseStarting: '正在启动',
        phaseSkills: '正在读取技能',
        phaseProvisioning: '正在准备依赖',
        phaseTools: '正在连接工具',
        phaseReady: '已就绪',
        phaseFailed: '失败',
        dependenciesTitle: '依赖',
        artifactColumn: '依赖项',
        localTagColumn: '本地',
        latestTagColumn: '最新',
        unknownTag: '未知',
        notChecked: '未检查',
        notInstalled: '未安装',
        toolkitLabel: 'Agentic Toolkit',
        checkUpdates: '检查更新',
        checking: '正在检查…',
        downloadLatest: '下载最新依赖',
        downloadBlocked: '本地已是最新；先检查更新，确认有更新后才可下载',
        downloading: '正在下载…',
        downloadBusy: '已有下载在进行，完成后再试',
        removeLocal: '清空本地依赖',
        removing: '正在清空…',
        removed: '已清空本地依赖',
        upToDate: '已是最新',
        updateAvailable: '有可用更新',
        checkFailed: '检查失败',
        confirmRemoveTitle: '清空本地依赖？',
        confirmRemoveBody: '将删除插件已下载的 MATLAB MCP Server 与 Agentic Toolkit（$DSH_HOME/matlab 下由本插件安装的文件），不会动你的 MATLAB 安装、mcpServerPath 或 toolkitRoots 指向的目录。删除后 MATLAB 工具与技能会不可用，需要重新下载。',
        cancel: '取消',
        confirmRemoveConfirm: '确认删除',
        groupsTitle: '技能组',
        selectAll: '全选',
        selectNone: '清空',
        required: '必需',
        skillsUnit: '项',
        noToolkit: '还没有找到 MATLAB 技能目录。',
        matlabTitle: 'MATLAB',
        matlabRoot: '根目录',
        displayMode: '启动方式',
        desktop: '带桌面',
        nodesktop: '无桌面',
        sessionMode: '会话模式',
        auto: '自动',
        existing: '复用会话',
        newSession: '新开会话',
        initialWorkingFolder: '起始目录',
        workspaceFolder: '使用当前对话的工作区目录',
        initialize: '启动时拉起 MATLAB',
        telemetry: '禁用遥测',
        serverTitle: 'MCP Server',
        mcpServerPath: '可执行文件',
        serverName: '工具命名空间',
        agentName: 'Agent 名称',
        callTimeout: '调用超时（ms）',
        downloadTitle: '下载',
        githubProxy: 'GitHub 加速前缀',
        region: '下载区域',
        regionAuto: '跟随市场',
        regionChina: '中国区',
        regionGlobal: '直连',
        routes: '当前线路',
        timeout: '准备预算（ms）',
        wait: '启动等待（ms）',
        watch: '监视工具包变化',
        updateKindTitle: '正在更新 MATLAB 依赖',
        progressTitle: '正在准备 MATLAB 依赖',
        progressToolkit: '正在下载 MATLAB Agentic Toolkit 发布包…',
        progressDownload: '正在下载 MATLAB MCP Server…',
        progressDone: 'MATLAB 依赖已就绪',
        progressFailed: 'MATLAB 依赖准备失败',
        progressBytes: '已下载',
        progressRoute: '线路',
        progressHide: '后台继续',
        progressRetry: '重试',
        seconds: '秒',
      },
      en: {
        nav: 'MATLAB',
        title: 'MATLAB Agentic Toolkit',
        intro: "MathWorks' own MCP tools and skill catalog, mounted by DSH.",
        refresh: 'Refresh',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        invalidNumber: 'Enter a valid number of milliseconds',
        noGroupSelected: 'Keep at least one skill group',
        revert: 'Discard',
        loading: 'Loading…',
        readOnly: 'This profile has no settings service; the fields are read-only.',
        unknown: '—',
        notDetected: 'not detected',
        none: 'none',
        tools: 'Tools',
        resources: 'Resources',
        error: 'Error',
        phaseStarting: 'Starting',
        phaseSkills: 'Reading skills',
        phaseProvisioning: 'Preparing dependencies',
        phaseTools: 'Connecting tools',
        phaseReady: 'Ready',
        phaseFailed: 'Failed',
        dependenciesTitle: 'Dependencies',
        artifactColumn: 'Artifact',
        localTagColumn: 'Local',
        latestTagColumn: 'Latest',
        unknownTag: 'unknown',
        notChecked: 'not checked',
        notInstalled: 'not installed',
        toolkitLabel: 'Agentic Toolkit',
        checkUpdates: 'Check for updates',
        checking: 'Checking…',
        downloadLatest: 'Download the newest',
        downloadBlocked: 'Everything local is current; run a check first, then download once it reports an update',
        downloading: 'Downloading…',
        downloadBusy: 'A download is already running; try again when it finishes',
        removeLocal: 'Delete local dependencies',
        removing: 'Deleting…',
        removed: 'The local dependencies were deleted',
        upToDate: 'Up to date',
        updateAvailable: 'Update available',
        checkFailed: 'Check failed',
        confirmRemoveTitle: 'Delete the local dependencies?',
        confirmRemoveBody: 'This deletes the MATLAB MCP Server and Agentic Toolkit copies this plugin downloaded under $DSH_HOME/matlab. Your MATLAB installation, mcpServerPath, and toolkitRoots folders are untouched. MATLAB tools and skills stop working until they are downloaded again.',
        cancel: 'Cancel',
        confirmRemoveConfirm: 'Delete',
        groupsTitle: 'Skill groups',
        selectAll: 'Select all',
        selectNone: 'Clear',
        required: 'required',
        skillsUnit: 'skills',
        noToolkit: 'No MATLAB skill catalog yet.',
        matlabTitle: 'MATLAB',
        matlabRoot: 'Root folder',
        displayMode: 'Start mode',
        desktop: 'With desktop',
        nodesktop: 'No desktop',
        sessionMode: 'Session',
        auto: 'Auto',
        existing: 'Shared only',
        newSession: 'New each time',
        initialWorkingFolder: 'Starting folder',
        workspaceFolder: "Use the conversation's workspace folder",
        initialize: 'Start MATLAB at startup',
        telemetry: 'Disable telemetry',
        serverTitle: 'MCP Server',
        mcpServerPath: 'Executable path',
        serverName: 'Tool namespace',
        agentName: 'Agent name',
        callTimeout: 'Call timeout (ms)',
        downloadTitle: 'Downloads',
        githubProxy: 'GitHub acceleration prefix',
        region: 'Download region',
        regionAuto: 'Follow market',
        regionChina: 'China',
        regionGlobal: 'Direct',
        routes: 'Active routes',
        timeout: 'Download budget (ms)',
        wait: 'Startup wait (ms)',
        watch: 'Watch the toolkit',
        updateKindTitle: 'Updating MATLAB dependencies',
        progressTitle: 'Preparing MATLAB dependencies',
        progressToolkit: 'Downloading the MATLAB Agentic Toolkit release…',
        progressDownload: 'Downloading the MATLAB MCP Server…',
        progressDone: 'MATLAB dependencies are ready',
        progressFailed: 'Preparing the MATLAB dependencies failed',
        progressBytes: 'Downloaded',
        progressRoute: 'Route',
        progressHide: 'Keep in background',
        progressRetry: 'Retry',
        seconds: 's',
      },
    }

    /**
     * What an empty box expects.
     *
     * These are examples, not defaults: they are shown in the field's light
     * placeholder colour and never written into the configuration. Paths and
     * identifiers read the same in every language, so they live together here
     * instead of being duplicated in both dictionaries.
     */
    const PLACEHOLDERS = {
      matlabRoot: 'C:\\Program Files\\MATLAB\\R2025b',
      initialWorkingFolder: 'C:\\Users\\you\\Documents\\MATLAB',
      mcpServerPath: 'C:\\Users\\you\\.dsh\\matlab\\bin\\matlab-mcp-server.exe',
      serverName: 'matlab',
      agentName: 'DeepSeek',
      toolCallTimeoutMs: '600000',
      githubProxy: 'https://gh-proxy.com',
      provisionTimeoutMs: '300000',
      provisionWaitMs: '0',
    }

    /**
     * The value discovery settled on for a field the user left empty.
     *
     * `matlabRoot` and `mcpServerPath` can both be found automatically, and the
     * page already knows what was found: showing it in the empty box says more
     * than any example could ("this is what will be used"). A value that came
     * from the configuration itself is not a discovery, so it is not offered —
     * the user typed it, and the box is only empty after they cleared it.
     */
    function discoveredValue(resolved, key) {
      if (resolved === null || resolved === undefined) return undefined
      if (resolved.source === 'config') return undefined
      const value = resolved[key]
      return typeof value === 'string' && value !== '' ? value : undefined
    }

    /**
     * Resolve one route against the page's base URL.
     *
     * The Web GUI can be mounted under a prefix, so a leading slash would miss
     * the mount; anchoring on `document.baseURI` is the same rule the market
     * uses.
     */
    function api(path) {
      const relative = path.replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    async function getJson(path) {
      const response = await fetch(api(path), { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    async function postJson(path, body) {
      const response = await fetch(api(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json().catch(() => ({}))
      // A refusal names its cause either as `error` or as `reason`; neither
      // should reach the page as a bare status code.
      if (!response.ok) throw new Error(payload.error ?? payload.reason ?? `HTTP ${response.status}`)
      return payload
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
      return `${(bytes / 1048576).toFixed(1)} MB`
    }

    /** The last segment of a path, for a status line that has no room for the whole path. */
    function tailOf(path) {
      if (typeof path !== 'string' || path === '') return undefined
      const parts = path.split(/[\\/]+/u).filter(part => part !== '')
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    const STYLES = `
.mp-page{--mp-canvas:var(--dsw-alias-bg-base);--mp-bleed:0px;display:flex;flex-direction:column;gap:28px;box-sizing:border-box;width:100%;max-width:720px;color:var(--dsw-alias-label-primary)}
.mp-page[data-view='section']{--mp-canvas:var(--dsw-alias-bg-layer-2);--mp-bleed:24px}
/* The bundle page is a 960px column of the plugin page: the form fills it, so
   its hairlines line up with the sections the host draws above. */
.mp-page[data-view='page']{max-width:100%}
@media (max-width:767px){.mp-page[data-view='section']{--mp-bleed:16px}}
.mp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

/* Head: the section owns its title, the bundle page is titled by its host. */
.mp-top{display:flex;flex-direction:column;gap:12px}
.mp-head{display:flex;flex-direction:column;gap:6px}
.mp-head-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.mp-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.mp-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}

/* Status: a dot and the phase, then the resolved facts, with refresh at the end. */
.mp-status{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;min-height:28px}
.mp-status-main{display:inline-flex;align-items:center;gap:8px;font-size:13px;line-height:20px;font-weight:500}
.mp-status-facts{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.mp-fact{display:inline-flex;align-items:center;gap:6px;min-width:0}
.mp-fact + .mp-fact::before{content:'\\00b7';margin-right:2px;color:var(--dsw-alias-label-tertiary)}
.mp-fact-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mp-status-end{display:inline-flex;align-items:center;gap:4px;margin-left:auto}
.mp-dot{box-sizing:border-box;flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.mp-dot[data-tone='success']{background:var(--dsw-alias-state-success-primary)}
.mp-dot[data-tone='warn']{background:var(--dsw-alias-state-warn-primary)}
.mp-dot[data-tone='error']{background:var(--dsw-alias-state-error-primary)}
.mp-dot[data-tone='busy']{background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));animation:mp-pulse 1.2s ease-in-out infinite}
@keyframes mp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.mp-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.mp-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}

/* One group of settings: a heading row, then fields separated by hairlines. */
.mp-section{display:flex;flex-direction:column;gap:4px;min-width:0}
.mp-section-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:28px}
.mp-section-title{margin:0;font-size:14px;line-height:20px;font-weight:500}
.mp-section-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mp-section-actions{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;margin-left:auto;min-width:0}
.mp-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.mp-field + .mp-field,.mp-field + .mp-row,.mp-row + .mp-field,.mp-row + .mp-row{border-top:0.5px solid var(--dsw-alias-border-l2)}
.mp-field-row{flex-direction:row;align-items:center;justify-content:space-between;gap:16px}
.mp-label{font-size:13px;line-height:1.5;font-weight:500;color:var(--dsw-alias-label-primary)}
.mp-value{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.mp-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;min-height:22px}

/* Inputs: the harness's 34px settings field. */
.mp-input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.mp-input::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary)))}
.mp-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.mp-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.mp-input[aria-invalid='true']{border-color:var(--dsw-alias-state-error-primary)}

/* Segmented control: the harness's own short-enum control, two to three choices. */
.mp-seg{position:relative;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:2px;max-width:100%;padding:4px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.mp-seg-indicator{position:absolute;top:4px;left:4px;width:calc((100% - 8px - 2px * (var(--mp-seg-count) - 1)) / var(--mp-seg-count));height:calc(100% - 8px);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-soft,0 1px 2px rgba(0,0,0,.08));transform:translateX(calc(var(--mp-seg-index) * (100% + 2px)));transition:transform 160ms ease;pointer-events:none}
.mp-seg-tab{position:relative;z-index:1;height:28px;padding:0 16px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer;transition:color 120ms ease}
.mp-seg-tab[aria-checked='true']{color:var(--dsw-alias-label-primary)}
.mp-seg-tab:disabled{cursor:default;opacity:.4}
.mp-seg-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:-2px}

/* Switch: the harness's 36x20 capsule; the thumb moves on aria-checked. */
.mp-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));cursor:pointer}
.mp-switch[aria-checked='true']{background:var(--dsw-alias-brand-primary)}
.mp-switch:disabled{cursor:default;opacity:.5}
.mp-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:2px}
.mp-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}
.mp-switch[aria-checked='false'] .mp-switch-thumb{background:var(--dsw-alias-switch-thumb,#fff)}
.mp-switch[aria-checked='true'] .mp-switch-thumb{transform:translateX(16px)}

/* Buttons: ghost, outline, primary and a red ghost, at the two harness sizes. */
.mp-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.mp-btn:disabled{opacity:.4;cursor:default}
.mp-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:1px}
.mp-btn-lg{height:32px;padding:0 14px;border-radius:var(--dsw-radius-md,12px);font-size:13px;line-height:20px}
.mp-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
@media (hover:hover){.mp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}.mp-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}.mp-btn-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}}
.mp-btn-outline{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3,var(--dsw-alias-border-l2))}
.mp-btn-danger{color:var(--dsw-alias-state-error-primary);box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
@media (hover:hover){.mp-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}.mp-btn-danger-solid:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,#000)}}
.mp-btn-danger-solid{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}

/* Tags: read-only capsules, one palette per meaning. */
.mp-tag{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}
.mp-tag[data-tone='outline']{border:0.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));color:var(--dsw-alias-label-tertiary)}
.mp-tag[data-tone='neutral']{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}
.mp-tag[data-tone='success']{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.mp-tag[data-tone='info']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 10%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.mp-tag[data-tone='warn']{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}
.mp-tag[data-tone='danger']{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}

/* Dependencies: three columns on the page ground, one ruled row per artifact.
   The tag columns shrink-wrap and the name takes the rest, so a long server
   version line cannot widen the table past its section. */
.mp-table{width:100%;border-collapse:collapse;table-layout:auto}
.mp-table th,.mp-table td{padding:9px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);text-align:start;vertical-align:middle;font-weight:400}
.mp-table th:not(:first-child),.mp-table td:not(:first-child){padding-left:12px;white-space:nowrap;width:1%}
.mp-table thead th{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.mp-table tbody tr:last-child th,.mp-table tbody tr:last-child td{border-bottom:0}
.mp-table tbody th{font-size:13px;line-height:20px;font-weight:400;color:var(--dsw-alias-label-primary)}
.mp-table td{font-size:13px;line-height:20px}
.mp-table-name{min-width:0;overflow-wrap:anywhere;text-align:start}
.mp-mono{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mp-idle{color:var(--dsw-alias-label-tertiary);font-family:inherit}
.mp-progress{display:flex;flex-direction:column;gap:6px;padding:2px 0 6px}
.mp-progress-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;line-height:18px}
.mp-progress-stage{color:var(--dsw-alias-label-secondary)}
.mp-progress-meta{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;font-variant-numeric:tabular-nums}

/* Skill groups: the scroll region inside a module panel, one row per group. */
.mp-panel{border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));padding:0 16px}
.mp-list{display:flex;flex-direction:column;margin:0;padding:0;max-height:320px;overflow-y:auto;overscroll-behavior:contain;list-style:none;scrollbar-width:thin}
.mp-list:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:2px}
.mp-group{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px;cursor:pointer}
.mp-group:last-child{border-bottom:0}
.mp-group:hover{color:var(--dsw-alias-label-primary)}
.mp-group:has(input:disabled){cursor:default;opacity:.6}
.mp-group input{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:inherit}
.mp-group input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:2px}
.mp-group-name{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere}
.mp-group-count{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.mp-empty{margin:0;padding:12px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}

/* The save row sticks to the bottom of whichever column scrolls.
   The settings panel pads its content column 24px inline, so the row bleeds
   over that padding and paints the same strip sideways; on the bundle page the
   plugin page owns the column's inset, so the bleed is 0. The row pins to the
   scrollport's content box, which leaves the scrollport's own bottom padding
   visible under it and lets the page scroll through that strip. SaveFooter
   measures the strip and publishes it as the --mp-footer-lip variable, and
   drops the lip once the row rests at the page's end, so a row that is no
   longer pinned never paints over the sections that follow the page. */
.mp-footer{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:12px;margin:0 calc(-1 * var(--mp-bleed));padding:12px var(--mp-bleed);background:var(--mp-canvas);border-top:0.5px solid var(--dsw-alias-border-l2);box-shadow:0 var(--mp-footer-lip,0px) 0 0 var(--mp-canvas)}
.mp-footer-message{flex:1;min-width:0;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.mp-footer-message[data-tone='error']{color:var(--dsw-alias-state-error-primary)}
.mp-footer-actions{display:inline-flex;align-items:center;gap:8px;margin-left:auto}

/* Dialogs: the harness mask, one card, the actions at the end. */
.mp-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.mp-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35));backdrop-filter:var(--dsw-mask-blur,none)}
.mp-dialog{position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:min(460px,100%);max-height:calc(100dvh - 48px);padding:20px 22px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel,28px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 20px 56px rgba(0,0,0,.28))}
.mp-dialog-body-scroll{display:flex;flex-direction:column;gap:12px;min-height:0;overflow-y:auto}
.mp-dialog-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.mp-dialog-body{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary)}
.mp-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:4px}

/* The dependency toast in the frame overlay; the layer is click-through, so the
   toast re-enables pointer events for its own box. */
.mp-toast{position:fixed;right:20px;bottom:20px;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:320px;max-width:calc(100vw - 40px);padding:14px 16px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3,0 10px 30px rgba(0,0,0,.18));pointer-events:auto}
.mp-toast-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;line-height:20px;font-weight:500}
.mp-toast-close{width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer}
@media (hover:hover){.mp-toast-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary)}}
.mp-bar{height:6px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));overflow:hidden}
.mp-bar-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .25s linear}
.mp-bar-indeterminate{height:100%;width:40%;background:var(--dsw-alias-brand-primary);animation:mp-slide 1.2s ease-in-out infinite}
@keyframes mp-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.mp-toast-meta{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.mp-toast-actions{display:flex;align-items:center;gap:8px}

@media (prefers-reduced-motion:reduce){
.mp-seg-indicator,.mp-seg-tab,.mp-switch-thumb{transition:none}
.mp-dot[data-tone='busy'],.mp-bar-indeterminate{animation:none}
}
`

    function Styles() {
      return h('style', null, STYLES)
    }

    // ---------------------------------------------------------------------
    // Controls. Copies of the harness primitives, renamed and trimmed to what
    // this page renders; behavior (roles, disabled states, focus rings) is the
    // primitive's, so a user's keyboard and assistive tech see the same thing.
    // ---------------------------------------------------------------------

    function Tag({ tone, children }) {
      return h('span', { className: 'mp-tag', 'data-tone': tone ?? 'outline' }, children)
    }

    function Button({ children, onClick, variant, size, disabled, title, describedBy }) {
      const classes = ['mp-btn']
      if (variant !== undefined) classes.push(`mp-btn-${variant}`)
      if (size === 'lg') classes.push('mp-btn-lg')
      return h('button', {
        type: 'button',
        className: classes.join(' '),
        onClick,
        disabled: disabled === true,
        title: title,
        'aria-describedby': describedBy,
      }, children)
    }

    function Switch({ checked, onChange, disabled, label, labelledBy }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked === true,
        'aria-label': label,
        'aria-labelledby': labelledBy,
        className: 'mp-switch',
        disabled: disabled === true,
        onClick: () => {
          if (disabled !== true) onChange(checked !== true)
        },
      }, h('span', { className: 'mp-switch-thumb' }))
    }

    /**
     * A single-choice control for two or three short options.
     *
     * Every choice is visible at once instead of hiding the alternatives behind
     * a menu: these are three-way decisions the user makes by reading the
     * options, and the row is short enough that all of them fit.
     */
    function Segmented({ id, label, value, options, onChange, disabled }) {
      const list = useRef(null)
      const index = Math.max(0, options.findIndex(option => option.value === value))
      // A walk key reports the next value and the owner re-renders with it; the
      // keyboard then follows the selection, so the roving tab stop stays under
      // the focused radio and the next arrow continues from there.
      useEffect(() => {
        const root = list.current
        if (root === null || !root.contains(document.activeElement)) return
        const current = root.querySelector('[role="radio"][aria-checked="true"]')
        if (current !== null && typeof current.focus === 'function') current.focus()
      }, [value])
      const walk = event => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        if (!forward && !backward) return
        event.preventDefault()
        if (disabled === true) return
        const step = forward ? 1 : -1
        const next = options[(index + step + options.length) % options.length]
        if (next !== undefined && next.value !== value) onChange(next.value)
      }
      return h('div', {
        ref: list,
        className: 'mp-seg',
        role: 'radiogroup',
        'aria-labelledby': id,
        style: {
          '--mp-seg-count': String(options.length),
          '--mp-seg-index': String(index),
        },
      },
      h('span', { className: 'mp-seg-indicator', 'aria-hidden': 'true' }),
      options.map(option => h('button', {
        key: option.value,
        type: 'button',
        role: 'radio',
        'aria-checked': option.value === value,
        tabIndex: option.value === value ? 0 : -1,
        className: 'mp-seg-tab',
        disabled: disabled === true,
        onClick: () => {
          if (disabled !== true && option.value !== value) onChange(option.value)
        },
        onKeyDown: walk,
      }, option.label)))
    }

    /** A labelled text or number field: the label over its control. */
    function Field({ id, label, children }) {
      return h('div', { className: 'mp-field' },
        h('label', { className: 'mp-label', htmlFor: id }, label),
        children)
    }

    /** A labelled choice group, where the label names the group instead of a control. */
    function GroupField({ id, label, children }) {
      return h('div', { className: 'mp-field' },
        h('span', { className: 'mp-label', id }, label),
        children)
    }

    /**
     * One switch row: the label at the start, the switch at the end.
     *
     * The visible text names the control through `aria-labelledby`, so a screen
     * reader announces the same words the row shows; the switch keeps its own
     * `aria-label` for the case where the label node is missing.
     */
    function SwitchField({ id, label, checked, onChange, disabled }) {
      const labelId = `${id}-label`
      return h('div', { className: 'mp-field mp-field-row' },
        h('span', { className: 'mp-label', id: labelId }, label),
        h(Switch, { checked, onChange, disabled, label, labelledBy: labelId }))
    }

    /** A read-only row: the label at the start, the resolved value at the end. */
    function ValueField({ label, children }) {
      return h('div', { className: 'mp-row' },
        h('span', { className: 'mp-label' }, label),
        h('span', { className: 'mp-value' }, children))
    }

    function TextInput({ id, value, onChange, placeholder, disabled, numeric, invalid }) {
      return h('input', {
        id,
        className: 'mp-input',
        type: 'text',
        value,
        placeholder,
        disabled: disabled === true,
        spellCheck: false,
        autoComplete: 'off',
        inputMode: numeric === true ? 'numeric' : undefined,
        'aria-invalid': invalid === true ? true : undefined,
        onChange: event => onChange(event.target.value),
      })
    }

    /**
     * One group of settings: a heading row, then fields separated by hairlines.
     *
     * `view` only picks the heading level: under the section's own `h1`, groups
     * are `h2`; on a bundle page the host's page title is an `h3`, so groups sit
     * beside it as `h3` instead of inverting the outline.
     */
    function Section({ title, meta, actions, view, children }) {
      return h('section', { className: 'mp-section' },
        h('div', { className: 'mp-section-head' },
          h(view === 'page' ? 'h3' : 'h2', { className: 'mp-section-title' }, title),
          meta === undefined || meta === null ? null : h('span', { className: 'mp-section-meta' }, meta),
          actions === undefined || actions === null
            ? null
            : h('div', { className: 'mp-section-actions' }, actions)),
        children)
    }

    function draftFrom(state) {
      const config = state.config
      return {
        matlabRoot: config.matlabRoot ?? '',
        initialWorkingFolder: config.initialWorkingFolder ?? '',
        mcpServerPath: config.mcpServerPath ?? '',
        serverName: config.serverName,
        agentName: config.agentName ?? 'DeepSeek',
        githubProxy: config.githubProxy ?? '',
        displayMode: config.displayMode,
        sessionMode: config.sessionMode,
        useWorkspaceFolder: config.useWorkspaceFolder === true,
        initializeMatlabOnStartup: config.initializeMatlabOnStartup === true,
        disableTelemetry: config.disableTelemetry === true,
        watchSkills: config.watchSkills !== false,
        toolCallTimeoutMs: config.toolCallTimeoutMs,
        provisionTimeoutMs: config.provisionTimeoutMs,
        provisionWaitMs: config.provisionWaitMs,
        downloadRegion: config.downloadRegion,
      }
    }

    function selectedFrom(config, groups) {
      // A required group is part of the catalog by definition: the page never
      // shows it unchecked, even when an older config lists only other groups.
      const required = groups.filter(group => group.required === true).map(group => group.name)
      const declared = Array.isArray(config.skillGroups) ? config.skillGroups : []
      const every = declared.length === 0 || declared.includes('*')
      if (every) return new Set(groups.map(group => group.name))
      const selected = new Set(declared.filter(name => groups.some(group => group.name === name)))
      for (const name of required) selected.add(name)
      return selected
    }

    function sameSet(a, b) {
      if (a.size !== b.size) return false
      for (const value of a) if (!b.has(value)) return false
      return true
    }

    /** The number fields the form writes, with the smallest value each accepts. */
    const NUMBER_FIELDS = { toolCallTimeoutMs: 1, provisionTimeoutMs: 1, provisionWaitMs: 0 }

    /**
     * Whether a number box holds something the form cannot save.
     *
     * An empty box is not invalid: it means "keep the stored value". Anything
     * else must parse to a finite number at or above the field's floor.
     */
    function numberInvalid(text, min) {
      const trimmed = String(text ?? '').trim()
      if (trimmed === '') return false
      const value = Number(trimmed)
      return !Number.isFinite(value) || value < min
    }

    /**
     * The patch for the draft's number boxes, or null when one is unusable.
     *
     * An empty box means "keep the stored value", so it is omitted rather than
     * written as 0 — the form never substitutes a number the user did not type.
     */
    function numericPatch(draft) {
      const patch = {}
      for (const [key, min] of Object.entries(NUMBER_FIELDS)) {
        const trimmed = String(draft[key] ?? '').trim()
        if (trimmed === '') continue
        const value = Number(trimmed)
        if (!Number.isFinite(value) || value < min) return null
        patch[key] = value
      }
      return patch
    }

    /**
     * Only what the user changed travels.
     *
     * A field the page never touched keeps the value the profile stored, which
     * matters for settings the Host normalizes on the way to the page: a
     * `githubProxy` list, for example, reaches this form as its first prefix, and
     * rewriting it during an unrelated save would drop the rest of the list.
     */
    function fieldPatch(draft, initial, numeric) {
      const patch = {}
      for (const key of Object.keys(draft)) {
        if (key in NUMBER_FIELDS) continue
        if (JSON.stringify(draft[key]) !== JSON.stringify(initial[key])) patch[key] = draft[key]
      }
      for (const [key, value] of Object.entries(numeric)) {
        if (String(initial[key]) !== String(value)) patch[key] = value
      }
      return patch
    }

    /** How a phase reads and how its dot is toned. */
    const PHASES = {
      starting: { key: 'phaseStarting', tone: 'busy' },
      skills: { key: 'phaseSkills', tone: 'busy' },
      provisioning: { key: 'phaseProvisioning', tone: 'warn' },
      tools: { key: 'phaseTools', tone: 'busy' },
      ready: { key: 'phaseReady', tone: 'success' },
      failed: { key: 'phaseFailed', tone: 'error' },
    }

    /**
     * The release tag inside a version line.
     *
     * The server reports its version as `github.com/matlab/matlab-mcp-server
     * v0.16.0`; the status line and the local-tag column want the tag alone.
     */
    function releaseTag(text) {
      if (typeof text !== 'string') return undefined
      const match = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/u.exec(text)
      if (match === null) return undefined
      return match[0].startsWith('v') ? match[0] : `v${match[0]}`
    }

    /**
     * The status line: the phase, then what the Host resolved, then refresh.
     *
     * It stays a single wrapping row rather than a table of every path: the two
     * paths are already shown in the empty-box placeholders of their own
     * fields, and what a reader wants here is "is it working, against which
     * MATLAB, with how many tools".
     */
    function StatusLine({ t, state, onRefresh }) {
      const phase = PHASES[state.phase]
      const pending = state.diagnostics === 'pending'
      const tools = state.probe !== null && state.probe.ok === true ? state.probe.tools.length : undefined
      const resources = state.probe !== null && state.probe.ok === true ? state.probe.resources.length : undefined
      const matlab = state.matlab === null ? undefined : tailOf(state.matlab.root)
      const server = releaseTag(state.server?.version) ?? tailOf(state.server?.path)
      const facts = []
      if (tools !== undefined) {
        facts.push({ key: 'tools', text: `${tools} ${t('tools')}` })
        facts.push({ key: 'resources', text: `${resources} ${t('resources')}` })
      }
      return h('div', { className: 'mp-status' },
        h('span', { className: 'mp-status-main' },
          h('span', { className: 'mp-dot', 'data-tone': phase?.tone ?? 'idle', 'aria-hidden': 'true' }),
          h('span', { role: 'status' }, phase === undefined ? state.phase ?? t('unknown') : t(phase.key))),
        h('span', { className: 'mp-status-facts' },
          h('span', { className: 'mp-fact' },
            h('span', null, t('matlabTitle')),
            h('span', { className: 'mp-fact-value', title: state.matlab?.root ?? undefined },
              pending ? t('unknown') : matlab ?? t('notDetected'))),
          h('span', { className: 'mp-fact' },
            h('span', null, t('serverTitle')),
            h('span', { className: 'mp-fact-value', title: state.server?.path ?? undefined },
              pending ? t('unknown') : server ?? t('notDetected'))),
          facts.map(fact => h('span', { key: fact.key, className: 'mp-fact' },
            h('span', { className: 'mp-fact-value' }, fact.text)))),
        h('span', { className: 'mp-status-end' },
          h(Button, { variant: 'ghost', onClick: onRefresh }, t('refresh'))))
    }

    /** One artifact's row: its name, the installed tag, and the published one. */
    function ArtifactRow({ t, label, status, checked }) {
      const installed = status?.installed === true
      const current = status?.current
      const latest = status?.latest
      // The Host reports a server's version as `github.com/… v0.16.0`; the
      // column wants the tag, and falls back to the raw text when there is none.
      const local = installed === false
        ? t('notInstalled')
        : typeof current === 'string' && current !== ''
          ? releaseTag(current) ?? current
          : t('unknownTag')
      // A check that has not run yet has nothing to report for the third column;
      // once it has, the published tag is shown even when it equals the local one.
      const hasLatest = checked === true && latest !== undefined && latest !== null && latest !== ''
      const failed = status?.error !== undefined && status?.error !== null
      return h(React.Fragment, null,
        h('tr', null,
          h('th', { scope: 'row', className: 'mp-table-name' }, label),
          h('td', null, h('span', { className: installed === false ? 'mp-idle' : 'mp-mono' }, local)),
          h('td', null,
            h('span', { className: hasLatest ? 'mp-mono' : 'mp-idle' }, hasLatest ? latest : t('notChecked')),
            status?.outdated === true ? h(Tag, { tone: 'warn' }, t('updateAvailable')) : null)),
        failed
          ? h('tr', null, h('td', { colSpan: 3 }, h('p', { className: 'mp-error' }, status.error)))
          : null)
    }

    /** The artifact table, the fetch in flight, and the three actions that read or change it. */
    function DependenciesSection({ t, view, state, progress, busy, checking, working, note, onCheck, onDownload, onRemove }) {
      const updates = state.updates
      const serverInstalled = state.server !== null && state.server !== undefined
      const toolkitInstalled = state.toolkit.length > 0
      const missing = !serverInstalled || !toolkitInstalled
      // Before the first check there is no comparison, but the page already
      // knows what is installed; reporting "not installed" from a missing
      // comparison is what made a working catalog look broken.
      const server = updates?.server ?? {
        installed: serverInstalled,
        current: releaseTag(state.server?.version),
        outdated: false,
      }
      const toolkit = updates?.toolkit ?? {
        installed: toolkitInstalled,
        // The tag a managed install recorded; an older `git` checkout has none.
        current: state.toolkitRelease?.tag,
        outdated: false,
      }
      const outdated = updates !== null && (server.outdated === true || toolkit.outdated === true)
      // "Download the newest" is offered when something is missing, or when the
      // check found a newer published tag — never as a blind re-download.
      const canDownload = missing || outdated
      const failed = updates !== null && (
        (server.error !== undefined && server.error !== null)
        || (toolkit.error !== undefined && toolkit.error !== null))
      // A check only compared what it could read: an unmanaged toolkit reports
      // neither a tag nor a failure, and claiming "up to date" for it would be
      // an assertion the Host never made.
      const compared = [server, toolkit]
        .filter(status => status.latest !== undefined && status.latest !== null && status.latest !== '')
      const summary = outdated
        ? t('updateAvailable')
        : failed
          ? t('checkFailed')
          : compared.length === 0 ? null : t('upToDate')
      const workingDownload = working === 'download'
      const workingRemove = working === 'remove'
      const reasonId = `mp-${view}-download-reason`
      const running = progress !== null && progress.active === true
      const stage = progress === null || progress.stage !== 'toolkit' ? t('progressDownload') : t('progressToolkit')
      const bytes = progress === null
        ? ''
        : progress.totalBytes === null
          ? `${t('progressBytes')} ${formatBytes(progress.bytes)}`
          : `${t('progressBytes')} ${formatBytes(progress.bytes)} / ${formatBytes(progress.totalBytes)}`
      return h(Section, {
        title: t('dependenciesTitle'),
        view,
        actions: [
          h(Button, {
            key: 'check',
            variant: 'outline',
            onClick: onCheck,
            disabled: busy || checking || working !== null,
          }, checking ? t('checking') : t('checkUpdates')),
          h(Button, {
            key: 'download',
            variant: 'outline',
            onClick: onDownload,
            disabled: busy || working !== null || !canDownload,
            title: canDownload ? undefined : t('downloadBlocked'),
            describedBy: canDownload ? undefined : reasonId,
          }, workingDownload ? t('downloading') : t('downloadLatest')),
          h(Button, {
            key: 'remove',
            variant: 'danger',
            onClick: onRemove,
            // A fetch owns both artifacts while it runs; the Host refuses the
            // delete in that window, so the control refuses it first.
            disabled: busy || working !== null || state.phase === 'provisioning'
              || (!serverInstalled && !toolkitInstalled),
          }, workingRemove ? t('removing') : t('removeLocal')),
        ],
      },
      h('table', { className: 'mp-table' },
        h('thead', null,
          h('tr', null,
            h('th', { scope: 'col' }, t('artifactColumn')),
            h('th', { scope: 'col' }, t('localTagColumn')),
            h('th', { scope: 'col' }, t('latestTagColumn')))),
        h('tbody', null,
          h(ArtifactRow, { t, label: t('serverTitle'), status: server, checked: updates !== null }),
          h(ArtifactRow, { t, label: t('toolkitLabel'), status: toolkit, checked: updates !== null }))),
      // A first-time fetch reports here as well as in the toast: the toast sits
      // above the plugin page but the settings panel can cover it, and the page
      // is where the user pressed the button.
      running
        ? h('div', { className: 'mp-progress' },
          h('div', { className: 'mp-progress-head' },
            h('span', { className: 'mp-progress-stage', role: 'status' }, stage),
            h('span', { className: 'mp-progress-meta' }, bytes)),
          h('div', { className: 'mp-bar' },
            progress.percent === null
              ? h('div', { className: 'mp-bar-indeterminate' })
              : h('div', { className: 'mp-bar-fill', style: { width: `${progress.percent}%` } })),
          progress.route === null
            ? null
            : h('p', { className: 'mp-progress-meta' }, `${t('progressRoute')} ${progress.route}`))
        : null,
      summary === null
        ? null
        : h('p', { className: failed ? 'mp-error' : 'mp-note', role: 'status' }, summary),
      // Why "Download the newest" is unavailable, for keyboard and screen
      // readers: a disabled button cannot be focused and takes no title.
      canDownload
        ? null
        : h('span', { id: reasonId, className: 'mp-sr' }, t('downloadBlocked')),
      note === null || note === undefined
        ? null
        : h('p', { className: note.tone === 'error' ? 'mp-error' : 'mp-note', role: 'status' }, note.text))
    }

    /**
     * The skill-group switches, with every group's name, requirement, and size.
     *
     * A stored selection of `[]` means "every group" to the Host, so "none" is a
     * state this page cannot save. The last switch therefore stays on, and
     * "Clear" is unavailable when no group is required: refusing the click is
     * honest, where saving `[]` would have stored the opposite of the click.
     */
    function GroupsSection({ t, view, state, draft, selected, onSelected, onDraft }) {
      const groups = state.groups
      const editable = state.editable
      const requiredNames = groups.filter(group => group.required === true).map(group => group.name)
      const rows = groups.map(group => {
        const required = group.required === true
        const checked = required || selected.has(group.name)
        return h('label', {
          key: group.name,
          className: 'mp-group',
          title: group.description === undefined || group.description === '' ? undefined : group.description,
        },
        h('input', {
          type: 'checkbox',
          checked,
          disabled: !editable || required,
          onChange: event => {
            if (required) return
            const next = new Set(selected)
            if (event.target.checked) next.add(group.name)
            else next.delete(group.name)
            if (next.size === 0) return
            onSelected(next)
          },
        }),
        h('span', { className: 'mp-group-name' },
          h('span', null, group.displayName || group.name),
          required ? h(Tag, null, t('required')) : null),
        h('span', { className: 'mp-group-count' }, `${group.skills} ${t('skillsUnit')}`))
      })
      return h(Section, {
        title: t('groupsTitle'),
        view,
        meta: groups.length === 0 ? null : `${selected.size} / ${groups.length}`,
        actions: [
          h(Button, {
            key: 'all',
            variant: 'ghost',
            onClick: () => onSelected(new Set(groups.map(group => group.name))),
            disabled: groups.length === 0 || !editable,
          }, t('selectAll')),
          h(Button, {
            key: 'none',
            variant: 'ghost',
            onClick: () => onSelected(new Set(requiredNames)),
            disabled: groups.length === 0 || !editable || requiredNames.length === 0,
          }, t('selectNone')),
        ],
      },
      groups.length === 0
        ? h('p', { className: 'mp-empty' }, t('noToolkit'))
        : h('div', { className: 'mp-panel' },
          h('div', {
            className: 'mp-list',
            role: 'group',
            tabIndex: 0,
            'aria-label': t('groupsTitle'),
          }, rows)),
      h(SwitchField, {
        id: `mp-${view}-watch`,
        label: t('watch'),
        checked: draft.watchSkills === true,
        disabled: !editable,
        onChange: value => onDraft({ ...draft, watchSkills: value }),
      }))
    }

    function MatlabSection({ t, view, state, draft, onDraft }) {
      const editable = state.editable
      const id = name => `mp-${view}-${name}`
      return h(Section, { title: t('matlabTitle'), view },
        h(Field, { id: id('matlab-root'), label: t('matlabRoot') },
          h(TextInput, {
            id: id('matlab-root'),
            value: draft.matlabRoot,
            disabled: !editable,
            placeholder: discoveredValue(state.matlab, 'root') ?? PLACEHOLDERS.matlabRoot,
            onChange: value => onDraft({ ...draft, matlabRoot: value }),
          })),
        h(GroupField, { id: id('display-mode'), label: t('displayMode') },
          h(Segmented, {
            id: id('display-mode'),
            label: t('displayMode'),
            value: draft.displayMode,
            disabled: !editable,
            onChange: value => onDraft({ ...draft, displayMode: value }),
            options: [
              { value: 'desktop', label: t('desktop') },
              { value: 'nodesktop', label: t('nodesktop') },
            ],
          })),
        h(GroupField, { id: id('session-mode'), label: t('sessionMode') },
          h(Segmented, {
            id: id('session-mode'),
            label: t('sessionMode'),
            value: draft.sessionMode,
            disabled: !editable,
            onChange: value => onDraft({ ...draft, sessionMode: value }),
            options: [
              { value: 'auto', label: t('auto') },
              { value: 'existing', label: t('existing') },
              { value: 'new', label: t('newSession') },
            ],
          })),
        // The switch comes first: it explains why the folder box below cannot be
        // edited while the conversation's own folder is in force.
        h(SwitchField, {
          id: id('workspace-folder'),
          label: t('workspaceFolder'),
          checked: draft.useWorkspaceFolder === true,
          disabled: !editable,
          onChange: value => onDraft({ ...draft, useWorkspaceFolder: value }),
        }),
        h(Field, { id: id('working-folder'), label: t('initialWorkingFolder') },
          h(TextInput, {
            id: id('working-folder'),
            value: draft.initialWorkingFolder,
            disabled: !editable || draft.useWorkspaceFolder === true,
            placeholder: PLACEHOLDERS.initialWorkingFolder,
            onChange: value => onDraft({ ...draft, initialWorkingFolder: value }),
          })),
        h(SwitchField, {
          id: id('initialize'),
          label: t('initialize'),
          checked: draft.initializeMatlabOnStartup === true,
          disabled: !editable,
          onChange: value => onDraft({ ...draft, initializeMatlabOnStartup: value }),
        }),
        h(SwitchField, {
          id: id('telemetry'),
          label: t('telemetry'),
          checked: draft.disableTelemetry === true,
          disabled: !editable,
          onChange: value => onDraft({ ...draft, disableTelemetry: value }),
        }))
    }

    function ServerSection({ t, view, state, draft, onDraft }) {
      const editable = state.editable
      const id = name => `mp-${view}-${name}`
      return h(Section, { title: t('serverTitle'), view },
        h(Field, { id: id('server-path'), label: t('mcpServerPath') },
          h(TextInput, {
            id: id('server-path'),
            value: draft.mcpServerPath,
            disabled: !editable,
            placeholder: discoveredValue(state.server, 'path') ?? PLACEHOLDERS.mcpServerPath,
            onChange: value => onDraft({ ...draft, mcpServerPath: value }),
          })),
        h(Field, { id: id('server-name'), label: t('serverName') },
          h(TextInput, {
            id: id('server-name'),
            value: draft.serverName,
            disabled: !editable,
            placeholder: PLACEHOLDERS.serverName,
            onChange: value => onDraft({ ...draft, serverName: value }),
          })),
        h(Field, { id: id('agent-name'), label: t('agentName') },
          h(TextInput, {
            id: id('agent-name'),
            value: draft.agentName,
            disabled: !editable,
            placeholder: PLACEHOLDERS.agentName,
            onChange: value => onDraft({ ...draft, agentName: value }),
          })),
        h(Field, { id: id('call-timeout'), label: t('callTimeout') },
          h(TextInput, {
            id: id('call-timeout'),
            numeric: true,
            invalid: numberInvalid(draft.toolCallTimeoutMs, 1),
            value: draft.toolCallTimeoutMs,
            disabled: !editable,
            placeholder: PLACEHOLDERS.toolCallTimeoutMs,
            onChange: value => onDraft({ ...draft, toolCallTimeoutMs: value }),
          })))
    }

    function DownloadSection({ t, view, state, draft, onDraft }) {
      const editable = state.editable
      const routeList = state.github?.routes ?? []
      const id = name => `mp-${view}-${name}`
      return h(Section, { title: t('downloadTitle'), view },
        h(Field, { id: id('github-proxy'), label: t('githubProxy') },
          h(TextInput, {
            id: id('github-proxy'),
            value: draft.githubProxy,
            disabled: !editable,
            placeholder: PLACEHOLDERS.githubProxy,
            onChange: value => onDraft({ ...draft, githubProxy: value }),
          })),
        h(GroupField, { id: id('download-region'), label: t('region') },
          h(Segmented, {
            id: id('download-region'),
            label: t('region'),
            value: draft.downloadRegion,
            disabled: !editable,
            onChange: value => onDraft({ ...draft, downloadRegion: value }),
            options: [
              { value: 'auto', label: t('regionAuto') },
              { value: 'china', label: t('regionChina') },
              { value: 'global', label: t('regionGlobal') },
            ],
          })),
        h(ValueField, { label: t('routes') },
          routeList.length === 0 ? t('none') : routeList.join(' → ')),
        h(Field, { id: id('provision-timeout'), label: t('timeout') },
          h(TextInput, {
            id: id('provision-timeout'),
            numeric: true,
            invalid: numberInvalid(draft.provisionTimeoutMs, 1),
            value: draft.provisionTimeoutMs,
            disabled: !editable,
            placeholder: PLACEHOLDERS.provisionTimeoutMs,
            onChange: value => onDraft({ ...draft, provisionTimeoutMs: value }),
          })),
        h(Field, { id: id('provision-wait'), label: t('wait') },
          h(TextInput, {
            id: id('provision-wait'),
            numeric: true,
            invalid: numberInvalid(draft.provisionWaitMs, 0),
            value: draft.provisionWaitMs,
            disabled: !editable,
            placeholder: PLACEHOLDERS.provisionWaitMs,
            onChange: value => onDraft({ ...draft, provisionWaitMs: value }),
          })))
    }

    /**
     * The page's save row.
     *
     * It is sticky rather than last-in-flow: the page is taller than the
     * settings viewport (a status line, the artifact table, and up to 24 skill
     * groups), and a save button nobody scrolls back to is a save button nobody
     * finds. The settings panel pads its content column 24px inline, so the row
     * bleeds over that padding sideways; on the bundle page the column belongs
     * to the plugin page, so the bleed is 0.
     *
     * The hosts also pad their scrollports' bottom (24px in the settings panel,
     * 48px on the plugin page) and a sticky row pins to the scrollport's content
     * box: the padding stays visible under the pinned row and the page keeps
     * scrolling through it, which reads as the page leaking below the row. The
     * effect measures that strip and publishes it as `--mp-footer-lip`; at the
     * row's flow position (the end of the page) the lip is 0, so a row that is
     * not pinned never paints over the sections that follow the page. It writes
     * a CSS variable rather than state, so a scroll or a resize never re-renders
     * the form.
     */
    function SaveFooter({ t, busy, dirty, editable, message, onSave, onRevert }) {
      const row = useRef(null)

      useEffect(() => {
        const node = row.current
        const page = node === null ? null : node.parentElement
        // The nearest scroll container is the box a sticky row pins to.
        let scroller = page
        while (scroller !== null) {
          const overflowY = getComputedStyle(scroller).overflowY
          if (overflowY !== 'visible' && overflowY !== 'clip') break
          scroller = scroller.parentElement
        }
        if (page === null || scroller === null) return undefined

        let frame = 0
        const measure = () => {
          frame = 0
          const bar = node.getBoundingClientRect()
          const scrollerBottom = scroller.getBoundingClientRect().bottom
          // A pinned row sits above its flow position, so the page it belongs to
          // still has content below it; at the end of the page the row rests.
          const pinned = bar.bottom < page.getBoundingClientRect().bottom - 1
          const lip = pinned ? Math.max(0, scrollerBottom - bar.bottom) : 0
          node.style.setProperty('--mp-footer-lip', `${lip}px`)
        }
        const schedule = () => { if (frame === 0) frame = requestAnimationFrame(measure) }
        measure()
        scroller.addEventListener('scroll', schedule, { passive: true })
        window.addEventListener('resize', schedule)
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
        observer?.observe(page)
        observer?.observe(scroller)
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          scroller.removeEventListener('scroll', schedule)
          window.removeEventListener('resize', schedule)
          observer?.disconnect()
        }
      }, [])

      return h('div', { className: 'mp-footer', ref: row },
        h('p', { className: 'mp-footer-message', 'data-tone': message?.tone === 'error' ? 'error' : undefined, role: 'status' },
          message === null || message === undefined ? '' : message.text),
        h('div', { className: 'mp-footer-actions' },
          h(Button, {
            variant: 'ghost',
            size: 'lg',
            onClick: onRevert,
            disabled: busy || !dirty,
          }, t('revert')),
          h(Button, {
            variant: 'primary',
            size: 'lg',
            onClick: onSave,
            disabled: busy || !dirty || !editable,
          }, busy ? t('saving') : t('save'))))
    }

    /**
     * The confirmation the destructive action must pass through.
     *
     * Escape closes it, the safe action takes the initial focus, Tab cycles
     * inside the card, and closing hands focus back to whatever opened it: a
     * destructive confirmation must never be one stray Enter press away from
     * deleting, and a keyboard user must never be left behind the mask.
     */
    function ConfirmRemove({ t, view, busy, error, onCancel, onConfirm }) {
      const card = useRef(null)
      const cancel = useRef(null)
      // The parent re-renders on its own polls; a mount-only listener reading the
      // latest callback through a ref keeps focus where the user put it.
      const cancelAction = useRef(onCancel)
      cancelAction.current = onCancel
      useEffect(() => {
        const previous = document.activeElement
        cancel.current?.focus()
        const onKeyDown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopImmediatePropagation()
            cancelAction.current()
            return
          }
          if (event.key !== 'Tab' || card.current === null) return
          const focusable = [...card.current.querySelectorAll('button:not(:disabled)')]
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          const active = document.activeElement
          const outside = !card.current.contains(active)
          if (event.shiftKey && (outside || active === first)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (outside || active === last)) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [])
      const titleId = `mp-${view}-confirm-title`
      return h('div', { className: 'mp-overlay', role: 'presentation' },
        h('div', { className: 'mp-mask', 'aria-hidden': 'true', onClick: onCancel }),
        h('div', {
          className: 'mp-dialog',
          ref: card,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
        },
        h('h3', { className: 'mp-dialog-title', id: titleId }, t('confirmRemoveTitle')),
        h('div', { className: 'mp-dialog-body-scroll' },
          h('p', { className: 'mp-dialog-body' }, t('confirmRemoveBody')),
          error === null || error === undefined
            ? null
            : h('p', { className: 'mp-error', role: 'alert' }, error)),
        h('div', { className: 'mp-dialog-actions' },
          h('button', {
            type: 'button',
            className: 'mp-btn mp-btn-outline mp-btn-lg',
            ref: cancel,
            disabled: busy,
            onClick: onCancel,
          }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'mp-btn mp-btn-danger-solid mp-btn-lg',
            disabled: busy,
            onClick: onConfirm,
          }, busy ? t('removing') : t('confirmRemoveConfirm')))))
    }

    /**
     * The one page both entries render.
     * @param props.t - the plugin's locale reader.
     * @param props.view - `section` for the Settings panel (draws the page title
     * and one-liner), `page` for a bundle page (its host already drew them).
     */
    function SettingsPage({ t, view }) {
      const [state, setState] = useState(null)
      const [draft, setDraft] = useState(null)
      const [selected, setSelected] = useState(() => new Set())
      const [initialSelected, setInitialSelected] = useState(() => new Set())
      const [busy, setBusy] = useState(false)
      const [checking, setChecking] = useState(false)
      // `download` / `remove` are long enough to need their own labels; `null`
      // means no dependency action is in flight.
      const [working, setWorking] = useState(null)
      const [confirmRemove, setConfirmRemove] = useState(false)
      const [confirmError, setConfirmError] = useState(null)
      // Feedback for a dependency action; it stays inside the dependency
      // section so the save row only ever talks about saving.
      const [dependencyNote, setDependencyNote] = useState(null)
      const [message, setMessage] = useState(null)
      const initialDraft = useRef(null)

      // A status-only refresh keeps edits the user has not saved yet:
      // `load(false)` updates the live state and leaves the draft alone.
      const load = useCallback(async (reset = true) => {
        try {
          const next = await getJson('/plugin/matlab/state')
          setState(next)
          if (reset === false) return
          const nextDraft = draftFrom(next)
          const nextSelected = selectedFrom(next.config, next.groups)
          setDraft(nextDraft)
          setSelected(nextSelected)
          setInitialSelected(new Set(nextSelected))
          initialDraft.current = nextDraft
          setMessage(null)
        } catch (cause) {
          setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      // A fetch in flight reports itself. The loop owns its own next tick, so one
      // dropped request cannot leave the page stuck on "preparing" until a
      // manual refresh.
      const provisioning = state !== null && state.phase === 'provisioning'
      useEffect(() => {
        if (!provisioning) return undefined
        let alive = true
        let timer
        const tick = async () => {
          await load(false)
          if (alive) timer = setTimeout(tick, 2500)
        }
        timer = setTimeout(tick, 2500)
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [provisioning, load])

      const groups = state?.groups ?? []
      const dirty = draft !== null && state !== null && (
        JSON.stringify(draft) !== JSON.stringify(initialDraft.current)
        || !sameSet(selected, initialSelected))

      const save = useCallback(async () => {
        if (draft === null || state === null) return
        const numeric = numericPatch(draft)
        if (numeric === null) {
          setMessage({ tone: 'error', text: t('invalidNumber') })
          return
        }
        // A required group is always part of the saved selection, even if a
        // stale page state tried to drop it: the Host enforces the same rule.
        const chosen = groups
          .filter(group => group.required === true || selected.has(group.name))
          .map(group => group.name)
        if (groups.length > 0 && chosen.length === 0) {
          setMessage({ tone: 'error', text: t('noGroupSelected') })
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          const patch = fieldPatch(draft, initialDraft.current, numeric)
          // An empty catalog cannot express a selection, and "every group" is
          // stored as "all" so a later toolkit release joins automatically.
          if (groups.length > 0 && !sameSet(selected, initialSelected)) {
            patch.skillGroups = chosen.length === groups.length ? [] : chosen
          }
          await postJson('/plugin/matlab/config', { revision: state.revision, patch })
          // Reload on success only: the stored document is now what the boxes
          // show, so the save is no longer dirty, while a failure keeps the
          // edits the user has to correct.
          await load()
          setMessage({ tone: 'success', text: t('saved') })
        } catch (cause) {
          const text = cause instanceof Error ? cause.message : String(cause)
          // The draft survives a failed save: the usual causes are a value the
          // Host rejected and a revision conflict, and both are fixed here. The
          // live state is refreshed so a retry carries the current revision.
          await load(false)
          setMessage({ tone: 'error', text })
        } finally {
          setBusy(false)
        }
      }, [draft, state, groups, selected, initialSelected, load, t])

      const check = useCallback(async () => {
        setChecking(true)
        // Dependency feedback belongs in the dependency section, not next to
        // Save: the result line already lives there, and "up to date" is not an
        // edit.
        setDependencyNote(null)
        setMessage(null)
        try {
          await postJson('/plugin/matlab/update', { check: true })
          await load(false)
          // A probe that answered but found a problem reports it per artifact in
          // the table; only a request that never got an answer needs a line here.
        } catch (cause) {
          setDependencyNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setChecking(false)
        }
      }, [load])

      const download = useCallback(async () => {
        setWorking('download')
        setDependencyNote(null)
        setMessage(null)
        try {
          const outcome = await postJson('/plugin/matlab/dependencies', { action: 'download' })
          await load(false)
          if (outcome.started !== true) setDependencyNote({ tone: 'warn', text: t('downloadBusy') })
        } catch (cause) {
          setDependencyNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setWorking(null)
        }
      }, [load, t])

      const remove = useCallback(async () => {
        setWorking('remove')
        setConfirmError(null)
        setMessage(null)
        try {
          await postJson('/plugin/matlab/dependencies', { action: 'remove' })
          setConfirmRemove(false)
          await load(false)
          setDependencyNote({ tone: 'success', text: t('removed') })
        } catch (cause) {
          // The reason is shown inside the dialog that asked the question, above
          // the mask, not in the section behind it.
          setConfirmError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setWorking(null)
        }
      }, [load, t])

      if (state === null || draft === null || initialDraft.current === null) {
        return h('div', { className: 'mp-page', 'data-view': view },
          h(Styles),
          h('p', { className: message === null ? 'mp-note' : 'mp-error', role: 'status' },
            message === null ? t('loading') : message.text))
      }

      return h('div', {
        className: 'mp-page',
        'data-view': view,
      },
      h(Styles),
      // The section owns its own title and one-liner; a bundle page was already
      // titled, versioned, and described by the Plugin Manager right above this
      // form, so repeating them here would read as a second page.
      h('div', { className: 'mp-top' },
        view === 'section'
          ? h('header', { className: 'mp-head' },
            h('div', { className: 'mp-head-row' },
              h('h1', { className: 'mp-title' }, t('title')),
              state.version === null || state.version === undefined
                ? null
                : h(Tag, { tone: 'neutral' }, `v${state.version}`)),
            h('p', { className: 'mp-intro' }, t('intro')))
          : null,
        // A status refresh must not throw away edits the user has not saved.
        h(StatusLine, { t, state, onRefresh: () => { void load(false) } })),
      state.error === null
        ? null
        : h('p', { className: 'mp-error', role: 'alert' }, `${t('error')}: ${state.error}`),
      state.warnings.length === 0
        ? null
        : h('p', { className: 'mp-note' }, state.warnings.join(' · ')),
      state.editable ? null : h('p', { className: 'mp-note' }, t('readOnly')),
      // The dependency table follows the status line: "what is installed /
      // what is published" belongs next to the state it compares, before the
      // long groups list.
      h(DependenciesSection, {
        t,
        view,
        state,
        progress: state.progress ?? null,
        busy,
        checking,
        working,
        note: dependencyNote,
        onCheck: () => { void check() },
        onDownload: () => { void download() },
        onRemove: () => {
          setConfirmError(null)
          setConfirmRemove(true)
        },
      }),
      h(GroupsSection, {
        t,
        view,
        state,
        draft,
        selected,
        onSelected: setSelected,
        onDraft: setDraft,
      }),
      h(MatlabSection, { t, view, state, draft, onDraft: setDraft }),
      h(ServerSection, { t, view, state, draft, onDraft: setDraft }),
      h(DownloadSection, { t, view, state, draft, onDraft: setDraft }),
      h(SaveFooter, {
        t,
        busy,
        dirty,
        editable: state.editable,
        message,
        onSave: () => { void save() },
        onRevert: () => {
          setDraft(initialDraft.current)
          setSelected(new Set(initialSelected))
          setMessage(null)
        },
      }),
      confirmRemove
        ? h(ConfirmRemove, {
          t,
          view,
          busy: working === 'remove',
          error: confirmError,
          onCancel: () => setConfirmRemove(false),
          onConfirm: () => { void remove() },
        })
        : null)
    }

    /** The frame-wide progress toast, driven by the Host's progress record. */
    function ProgressOverlay({ t }) {
      const [progress, setProgress] = useState(null)
      const [hidden, setHidden] = useState(false)
      // The toast reappears when a run starts or fails, not on every poll: a
      // reader who sent a fetch to the background keeps it there.
      const last = useRef({ run: null, stage: null })

      useEffect(() => {
        let alive = true
        let timer
        const tick = async () => {
          let next = null
          try {
            next = await getJson('/plugin/matlab/progress')
          } catch {
            next = null
          }
          if (!alive) return
          if (next !== null) {
            const run = next.active === true ? next.startedAt ?? 'active' : null
            if (run !== null && run !== last.current.run) setHidden(false)
            if (next.stage === 'failed' && last.current.stage !== 'failed') setHidden(false)
            last.current = { run, stage: next.stage ?? null }
            setProgress(next)
          }
          timer = setTimeout(tick, next?.active === true ? 800 : 6000)
        }
        void tick()
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [])

      useEffect(() => {
        if (progress === null || progress.stage !== 'done' || progress.active === true) return undefined
        const timer = setTimeout(() => setHidden(true), 6000)
        return () => clearTimeout(timer)
      }, [progress])

      if (progress === null || hidden) return null
      const active = progress.active === true
      const failed = progress.stage === 'failed'
      const finished = progress.stage === 'done'
      if (!active && !failed && !finished) return null

      const title = finished
        ? t('progressDone')
        : failed
          ? t('progressFailed')
          : progress.kind === 'update'
            ? t('updateKindTitle')
            : t('progressTitle')
      const line = finished
        ? t('progressDone')
        : failed
          ? t('progressFailed')
          : progress.stage === 'toolkit'
            ? t('progressToolkit')
            : t('progressDownload')

      const meta = progress.stage === 'download' && progress.totalBytes !== null
        ? `${t('progressBytes')} ${formatBytes(progress.bytes)} / ${formatBytes(progress.totalBytes)}`
        : progress.stage === 'download' || progress.stage === 'toolkit'
          ? `${t('progressBytes')} ${formatBytes(progress.bytes)}`
          : `${Math.round(progress.elapsedMs / 1000)} ${t('seconds')}`

      const bar = finished
        ? h('div', { className: 'mp-bar-fill', style: { width: '100%' } })
        : progress.percent === null
          ? h('div', { className: 'mp-bar-indeterminate' })
          : h('div', { className: 'mp-bar-fill', style: { width: `${progress.percent}%` } })

      const retry = async () => {
        setHidden(false)
        try {
          await postJson('/plugin/matlab/provision')
        } catch {
          // The next poll shows the Host's own error.
        }
      }

      return h('div', { className: 'mp-toast' },
        h(Styles),
        h('div', { className: 'mp-toast-head' },
          h('span', null, title),
          h('button', {
            type: 'button',
            className: 'mp-toast-close',
            onClick: () => setHidden(true),
            'aria-label': t('progressHide'),
          }, '\u00d7')),
        // Only the stage is a live region: the byte counter changes every poll and
        // would re-announce the whole card.
        h('p', { className: 'mp-note', role: 'status' }, line),
        h('div', { className: 'mp-bar' }, bar),
        h('div', { className: 'mp-toast-meta', 'aria-hidden': 'true' },
          h('span', null, meta),
          progress.route === null ? null : h('span', null, `${t('progressRoute')} ${progress.route}`)),
        failed ? h('p', { className: 'mp-error' }, progress.error ?? t('none')) : null,
        failed || finished
          ? h('div', { className: 'mp-toast-actions' },
            h(Button, { variant: 'outline', onClick: () => { void retry() } }, t('progressRetry')),
            h(Button, { variant: 'ghost', onClick: () => setHidden(true) }, t('progressHide')))
          : null)
    }

    /**
     * The MathWorks MATLAB mark, the same vector artwork `icon.svg` ships.
     *
     * The four paths and three gradients are the official logo as MATLAB
     * R2023b draws it (`logo`): the L-shaped membrane surface, its shaded
     * ridge, and the blue edge. Keeping it inline means the Settings section
     * needs no extra asset request and stays sharp at any size.
     */
    function PluginIcon({ size }) {
      const px = size ?? 16
      return h('svg', {
        viewBox: '0 0 64 64',
        width: px,
        height: px,
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('g', { transform: 'translate(3.2 3.2) scale(3.6)' },
        h('defs', null,
          h('radialGradient', {
            id: 'mp-logo-surface',
            cx: '25.5117',
            cy: '23.835',
            r: '20.307',
            gradientTransform: 'matrix(0.8188 0.4836 -0.6511 1.008 -5.302 -34.4656)',
            gradientUnits: 'userSpaceOnUse',
          },
          h('stop', { offset: '0.3308', stopColor: '#73C8EC' }),
          h('stop', { offset: '0.4484', stopColor: '#128DBB' }),
          h('stop', { offset: '0.4836', stopColor: '#D16432' }),
          h('stop', { offset: '0.5995', stopColor: '#D15F2C' }),
          h('stop', { offset: '0.7588', stopColor: '#D0511A' }),
          h('stop', { offset: '0.9264', stopColor: '#CF3D00' })),
          h('linearGradient', {
            id: 'mp-logo-shade',
            gradientUnits: 'userSpaceOnUse',
            x1: '9.8174',
            y1: '0.3408',
            x2: '9.8174',
            y2: '16.0005',
          },
          h('stop', { offset: '0', stopColor: '#A32E17' }),
          h('stop', { offset: '0.2308', stopColor: '#972D13' }),
          h('stop', { offset: '0.645', stopColor: '#78290A' }),
          h('stop', { offset: '1', stopColor: '#582500' })),
          h('linearGradient', {
            id: 'mp-logo-edge',
            gradientUnits: 'userSpaceOnUse',
            x1: '5.9292',
            y1: '0.0004882812',
            x2: '5.9292',
            y2: '11.3101',
          },
          h('stop', { offset: '0', stopColor: '#3088CD' }),
          h('stop', { offset: '0.5471', stopColor: '#185991' }),
          h('stop', { offset: '0.8957', stopColor: '#0B3F6F' }))),
        h('path', {
          fill: 'url(#mp-logo-surface)',
          d: 'M15.609,11c-0.516-1.479-0.852-2.896-1.42-4.558c-0.283-0.837-0.588-1.782-0.869-2.627 c-0.305-0.914-0.844-1.743-1.271-2.52c-0.174-0.327-0.611-1.086-1.078-1.084c-0.141,0-0.244,0.067-0.33,0.13 C10.336,0.55,7.509,4.558,7.18,4.691C7.079,4.736,6.953,4.753,6.838,4.792c-0.258,0.1-0.447,0.215-0.648,0.389 c-0.33,0.301-0.643,0.695-0.923,1.06c-0.056,0.077-0.619,0.886-0.704,1L0.376,9.018c0,0,4.991,3.036,5.32,3.866 c0.228,0.589,1.374,2.248,1.601,2.847c0.752-0.179,1.227-0.946,1.721-1.389c0.538-0.481,1.021-1.125,1.475-1.699 c0.883-1.113,1.234-1.829,2.703-2.005c0.398-0.048,1.141,0.176,1.322,0.331c0.271,0.228,0.623,0.372,0.883,0.605 C15.859,11.984,15.775,11.496,15.609,11z',
        }),
        h('path', {
          fill: '#F5AE81',
          d: 'M12.203,4.792c0.172,1.534-0.061,2.784-0.508,2.807c-0.459,0.022-0.969-1.203-1.141-2.729 c-0.164-1.534,0.064-2.782,0.51-2.807C11.523,2.04,12.031,3.256,12.203,4.792z',
        }),
        h('path', {
          fill: 'url(#mp-logo-shade)',
          d: 'M15.955,11.295c-0.336-1.108-2.908-9.844-4.299-10.954L10.82,0.506l0.078,0.209 c0.055-0.032,0.117-0.031,0.148-0.016c0.768,0.302,2.721,6.247,2.721,6.247c0.453,1.521,0.873,2.774,1.227,3.774 c-0.51-0.331-1.057-0.534-1.578-0.55c-1.822-0.055-2.602,1.358-3.836,2.854c-0.549,0.674-1.406,1.705-1.984,2.124 c-0.963-2.684-2.767-3.931-3.353-4.273L3.634,11.31l0.021,0.008c0,0,2.509,1.195,3.487,4.682C7.156,15.999,7.174,16,7.189,16 c1.655,0,4.287-5.479,6.227-5.171c0.584,0.093,1.295,0.459,1.896,0.979C15.633,12.069,16.158,11.971,15.955,11.295z',
        }),
        h('path', {
          fill: 'url(#mp-logo-edge)',
          d: 'M11.164,0.016c-0.037-0.009-0.068-0.015-0.102-0.015C9.627-0.061,8.016,4.03,6.695,4.736 C5.328,5.465,5.242,6.155,4.798,6.762C4.359,7.374,0,8.915,0,8.915l3.634,2.395l0.521-0.363c0.769-0.495,2.087-1.48,3.251-3.163 c1.611-2.31,2.594-5.084,3.062-6.41c0,0,0.086-0.239,0.143-0.349c0.084-0.154,0.188-0.263,0.326-0.319 c0.367-0.192,0.922-0.155,0.922-0.155C11.672,0.312,11.375,0.063,11.164,0.016z M3.609,10.481L1.485,9.085 C2.663,8.644,3.82,8.157,4.579,7.731l1.233,0.93C4.931,9.599,4.094,10.188,3.609,10.481z M6.822,7.419 C6.641,7.683,6.453,7.924,6.26,8.155L5.181,7.342c0.078-0.07,0.147-0.139,0.188-0.2c0.124-0.163,0.225-0.335,0.326-0.52 c0.258-0.451,0.479-0.846,1.338-1.305c0.655-0.349,1.326-1.202,2.022-2.162C8.523,4.459,7.79,6.031,6.822,7.419z',
        })))
    }

    const name = NS
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, COPY), 'matlab-agentic: dictionaries')
      const t = ctx.locale.bind(NS)

      // Entry one: the Settings panel. The section owns everything the shell
      // does not draw for it, so it draws its title, one-liner, and status.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 45,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, ownerProps => h(SettingsPage, { t: ownerProps?.t ?? t, view: 'section' })))

      // Entry two: the bundle's own page in the Plugin Manager. It renders the
      // same page through `plugins.bundle.config` — the host asks for `page`,
      // and its summary projection (a card's one-liner) gets the intro alone.
      // The key is the bundle's package name as the profile records it; the
      // legacy key keeps the page working for a profile that still links the
      // pre-rename package name.
      for (const bundleName of ['dsh-matlab', 'dsh-plugin-matlab']) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: bundleName,
          locale: NS,
          inject: () => ({ t }),
        }, ownerProps => ownerProps?.view === 'summary'
          ? t('intro')
          : h(SettingsPage, { t: ownerProps?.t ?? t, view: 'page' })))
      }

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: NS,
        order: 45,
        locale: NS,
      }, owner => h(PluginIcon, { size: owner?.size ?? 16 })))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: `${NS}.progress`,
        order: 60,
        locale: NS,
        inject: () => ({ t }),
      }, ownerProps => h(ProgressOverlay, { t: ownerProps?.t ?? t })))
    }

    return { name, inject, apply }
  },
})
