/**
 * The plugin's Web UI: a Settings page and the dependency progress dialog.
 *
 * Both render as React into slots the shell already allocates:
 * `settings.section` (one page in Settings) and `shell.overlay` (the frame-wide
 * floating layer). All data comes from the plugin's own JSON routes, so this
 * file carries no policy: it shows what the Host resolved, posts field edits
 * through DSH's `settings` service, and asks the Host to fetch what is missing.
 *
 * Styling uses the host's `--dsw-alias-*` theme tokens only, and every control
 * is written here rather than imported from a client package, so a host upgrade
 * cannot blank the page.
 *
 * @module dsh-plugin-matlab/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-matlab',
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
        subtitle: 'MathWorks 原样的 MCP 工具与技能目录，由 DSH 挂载。',
        status: '连接状态',
        phase: '阶段',
        matlab: 'MATLAB',
        server: 'MCP Server',
        pluginVersion: '插件版本',
        route: '下载线路',
        tools: '工具',
        resources: '资源',
        skills: '技能',
        groups: '技能组',
        warnings: '告警',
        error: '错误',
        none: '无',
        notDetected: '未检测到',
        refresh: '刷新',
        save: '保存',
        revert: '放弃修改',
        saving: '正在保存…',
        saved: '已保存',
        conflict: '设置已被其他窗口修改，已重新载入。',
        editableUnavailable: '当前 profile 没有 settings 服务，请直接在 cordis.patch.yml 中修改。',
        groupsTitle: '技能组',
        groupsHint: '开关决定模型能看到哪些 MATLAB 技能。默认全开；全部勾选时保存为“全部”，新增的组也会自动纳入。标记“必需”的组始终启用，不能关闭。',
        groupColumn: '技能组',
        skillsColumn: '技能数',
        selectAll: '全选',
        selectNone: '全不选',
        required: '必需',
        skillsUnit: '个技能',
        noToolkit: '还没有找到 MATLAB 技能目录。装一次依赖后这里会列出技能组。',
        matlabTitle: 'MATLAB',
        matlabRoot: 'MATLAB 根目录',
        matlabRootHint: '留空则按 安装器记录 → 环境变量 → PATH → 注册表 → 安装目录 自动发现。',
        displayMode: '启动方式',
        desktop: '带桌面',
        nodesktop: '无桌面',
        sessionMode: '会话模式',
        auto: '自动（优先复用共享会话）',
        existing: '只复用共享会话',
        newSession: '总是新开',
        initialWorkingFolder: '起始目录',
        initialWorkingFolderHint: '留空则使用 DSH 当前工作目录。',
        initialize: '启动时拉起 MATLAB',
        initializeHint: '关闭时 MCP Server 在第一次工具调用时才启动 MATLAB。',
        telemetry: '禁用遥测',
        telemetryHint: '向 MCP Server 传 --disable-telemetry。',
        serverTitle: 'MCP Server',
        mcpServerPath: '可执行文件路径',
        mcpServerPathHint: '留空则自动发现（安装器布局、插件数据目录）或按下方线路下载。',
        serverName: '工具命名空间',
        serverNameHint: '工具会显示为 mcp__<命名空间>__<工具>。',
        agentName: 'MATLAB 中显示的 Agent 名',
        agentNameHint: 'MATLAB 命令窗口里显示的名字，例如“… is connected to MATLAB…”。默认 DeepSeek。',
        callTimeout: '单次调用超时（毫秒）',
        callTimeoutHint: '仿真与测试套件很慢，默认 10 分钟。',
        networkTitle: '依赖下载',
        githubProxy: 'GitHub 加速前缀',
        githubProxyHint: '例如 https://gh-proxy.com。留空则沿用 DSH 市场的 GitHub 加速设置。',
        region: '下载区域',
        regionAuto: '跟随 DSH 市场',
        regionChina: '中国区（内置加速线路）',
        regionGlobal: '直连',
        routes: '当前线路',
        timeout: '单次准备预算（毫秒）',
        timeoutHint: '下载二进制或安装工具包的总预算；只约束后台任务。',
        wait: '启动最多等待（毫秒）',
        waitHint: '0 表示首次准备完全在后台进行，不阻塞启动；最大不超过 60000。',
        watch: '监视工具包变化',
        watchHint: '工具包更新后自动重载技能目录。',
        dependenciesTitle: '依赖',
        dependenciesHint: '进入本页时已读取本地依赖与版本；点“检查更新”读取官方最新 Tag。只有在本地缺失依赖、或检查后发现更新时，才能下载最新依赖。',
        artifactColumn: '模块',
        localTagColumn: '本地 Tag',
        latestTagColumn: '最新 Tag',
        unknownTag: '未知',
        notChecked: '未检查',
        checkUpdates: '检查更新',
        downloadLatest: '下载最新依赖',
        downloadBlocked: '本地已是最新；先检查更新，确认有更新后才可下载',
        downloading: '正在下载…',
        removeLocal: '清空本地依赖',
        removing: '正在清空…',
        removed: '本地依赖已清空',
        downloadBusy: '已有下载在进行，完成后再试',
        removeBusy: '有下载正在进行，完成后再清空',
        confirmRemoveTitle: '清空本地依赖？',
        confirmRemoveBody: '将删除插件已下载的 MATLAB MCP Server 与 Agentic Toolkit（$DSH_HOME/matlab 下由本插件安装的文件），不会动你的 MATLAB 安装、mcpServerPath 或 toolkitRoots 指向的目录。删除后 MATLAB 工具与技能会不可用，需要重新下载。',
        confirmRemoveCancel: '取消',
        confirmRemoveConfirm: '确认删除',
        checking: '正在检查…',
        upToDate: '已是最新',
        checkFailed: '检查失败，原因见上方',
        updateAvailable: '有可用更新',
        notInstalled: '未安装',
        toolkitLabel: '工具包',
        updateKindTitle: '正在更新 MATLAB 依赖',
        retry: '重试',
        progressTitle: '正在准备 MATLAB 依赖',
        progressToolkit: '正在下载 MATLAB Agentic Toolkit 发布包…',
        progressDownload: '正在下载 MATLAB MCP Server…',
        progressDone: 'MATLAB 依赖已就绪',
        progressFailed: 'MATLAB 依赖准备失败',
        progressBytes: '已下载',
        progressRoute: '线路',
        progressHide: '后台继续',
        progressRetry: '重试',
        elapsed: '已用',
        seconds: '秒',
      },
      en: {
        nav: 'MATLAB',
        title: 'MATLAB Agentic Toolkit',
        subtitle: "MathWorks' own MCP tools and skill catalog, mounted by DSH.",
        status: 'Connection',
        phase: 'Phase',
        matlab: 'MATLAB',
        server: 'MCP Server',
        pluginVersion: 'Plugin version',
        route: 'Route',
        tools: 'Tools',
        resources: 'Resources',
        skills: 'Skills',
        groups: 'Skill groups',
        warnings: 'Warnings',
        error: 'Error',
        none: 'none',
        notDetected: 'not detected',
        refresh: 'Refresh',
        save: 'Save',
        revert: 'Discard',
        saving: 'Saving…',
        saved: 'Saved',
        conflict: 'Another window changed these settings; the page reloaded them.',
        editableUnavailable: 'This profile has no settings service; edit cordis.patch.yml instead.',
        groupsTitle: 'Skill groups',
        groupsHint: 'Switches decide which MATLAB skills the model can see. All groups are on by default; saving with every group checked stores "all", so new groups join automatically. A group marked "required" is always on and cannot be turned off.',
        groupColumn: 'Skill group',
        skillsColumn: 'Skills',
        selectAll: 'Select all',
        selectNone: 'Select none',
        required: 'required',
        skillsUnit: 'skills',
        noToolkit: 'No MATLAB skill catalog yet. Installing the dependencies once will list the groups here.',
        matlabTitle: 'MATLAB',
        matlabRoot: 'MATLAB root',
        matlabRootHint: 'Empty discovers it: installer record → environment → PATH → registry → install folders.',
        displayMode: 'Start mode',
        desktop: 'With desktop',
        nodesktop: 'No desktop',
        sessionMode: 'Session mode',
        auto: 'Auto (prefer a shared session)',
        existing: 'Shared session only',
        newSession: 'Always start a new one',
        initialWorkingFolder: 'Working folder',
        initialWorkingFolderHint: 'Empty uses the DSH working directory.',
        initialize: 'Start MATLAB at startup',
        initializeHint: 'Off starts MATLAB on the first tool call instead.',
        telemetry: 'Disable telemetry',
        telemetryHint: 'Passes --disable-telemetry to the MCP server.',
        serverTitle: 'MCP Server',
        mcpServerPath: 'Executable path',
        mcpServerPathHint: 'Empty discovers it (installer layout, plugin data) or downloads it over the routes below.',
        serverName: 'Tool namespace',
        serverNameHint: 'Tools appear as mcp__<namespace>__<tool>.',
        agentName: 'Agent name shown in MATLAB',
        agentNameHint: 'The name MATLAB prints when the agent connects. Defaults to DeepSeek.',
        callTimeout: 'Call timeout (ms)',
        callTimeoutHint: 'Simulations and test suites are slow; 10 minutes by default.',
        networkTitle: 'Dependency downloads',
        githubProxy: 'GitHub acceleration prefix',
        githubProxyHint: 'For example https://gh-proxy.com. Empty follows the GitHub acceleration DSH is configured with.',
        region: 'Download region',
        regionAuto: "Follow DSH's market",
        regionChina: 'China (built-in accelerated routes)',
        regionGlobal: 'Direct',
        routes: 'Routes in force',
        timeout: 'Transfer budget (ms)',
        timeoutHint: 'Budget for one binary download or toolkit install; it bounds the background job only.',
        wait: 'Startup wait (ms)',
        waitHint: '0 keeps the first fetch entirely in the background; 60000 is the useful maximum.',
        watch: 'Watch the toolkit',
        watchHint: 'Reload the skill catalog when the toolkit changes on disk.',
        dependenciesTitle: 'Dependencies',
        dependenciesHint: 'Entering this page already read the local artifacts and their versions; "Check for updates" reads the newest published tags. Downloading is offered only when something is missing or the check found a newer tag.',
        artifactColumn: 'Artifact',
        localTagColumn: 'Local tag',
        latestTagColumn: 'Latest tag',
        unknownTag: 'unknown',
        notChecked: 'not checked',
        checkUpdates: 'Check for updates',
        downloadLatest: 'Download the newest',
        downloadBlocked: 'Everything local is current; run a check first, then download once it reports an update',
        downloading: 'Downloading…',
        removeLocal: 'Delete local dependencies',
        removing: 'Deleting…',
        removed: 'The local dependencies were deleted',
        downloadBusy: 'A download is already running; try again when it finishes',
        removeBusy: 'A download is running; delete when it finishes',
        confirmRemoveTitle: 'Delete the local dependencies?',
        confirmRemoveBody: 'This deletes the MATLAB MCP Server and Agentic Toolkit copies this plugin downloaded under $DSH_HOME/matlab. Your MATLAB installation, mcpServerPath, and toolkitRoots folders are untouched. MATLAB tools and skills stop working until they are downloaded again.',
        confirmRemoveCancel: 'Cancel',
        confirmRemoveConfirm: 'Delete',
        checking: 'Checking…',
        upToDate: 'Up to date',
        checkFailed: 'Check failed; see the reason above',
        updateAvailable: 'Update available',
        notInstalled: 'not installed',
        toolkitLabel: 'Toolkit',
        updateKindTitle: 'Updating MATLAB dependencies',
        retry: 'Retry',
        progressTitle: 'Preparing MATLAB dependencies',
        progressToolkit: 'Downloading the MATLAB Agentic Toolkit release…',
        progressDownload: 'Downloading the MATLAB MCP Server…',
        progressDone: 'MATLAB dependencies are ready',
        progressFailed: 'Preparing the MATLAB dependencies failed',
        progressBytes: 'Downloaded',
        progressRoute: 'Route',
        progressHide: 'Keep in background',
        progressRetry: 'Retry',
        elapsed: 'elapsed',
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
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
      return payload
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
      return `${(bytes / 1048576).toFixed(1)} MB`
    }

    const STYLES = `
.mp-page{display:flex;flex-direction:column;gap:18px;max-width:760px;padding:4px 2px 0;color:var(--dsw-alias-label-primary)}
/* The settings scroller keeps a 24px bottom padding and sticky aligns to its
   content edge, so the bar is pushed down by that padding and paints a matching
   solid shadow below it — otherwise the page shows through under the bar. Both
   values degrade quietly if the host changes its padding. */
.mp-savebar{position:sticky;bottom:-24px;z-index:6;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px;padding:12px 0 14px;background:var(--dsw-alias-bg-base);border-top:1px solid var(--dsw-alias-border-l1);box-shadow:0 -12px 20px -20px rgba(0,0,0,.45),0 40px 0 0 var(--dsw-alias-bg-base)}
.mp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.mp-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.mp-card-title{font-size:14px;font-weight:600;margin:0}
.mp-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0}
.mp-row{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:10px 16px;align-items:center}
.mp-row-block{display:flex;flex-direction:column;gap:6px}
.mp-label{font-size:13px;color:var(--dsw-alias-label-primary)}
.mp-input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.mp-input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));opacity:.72}
.mp-input:focus::placeholder{opacity:.5}
.mp-radio-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 20px;padding:3px 0}
.mp-radio{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer;padding:3px 2px;border-radius:6px}
.mp-radio:hover{color:var(--dsw-alias-brand-primary)}
.mp-radio input{margin:0;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}
.mp-radio input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mp-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mp-toggle{display:flex;align-items:flex-start;gap:8px;font-size:13px}
.mp-toggle input{margin:3px 0 0}
.mp-btn{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.mp-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.mp-btn:disabled{opacity:.5;cursor:default}
.mp-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.mp-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mp-btn-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff}
.mp-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.mp-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mp-badge-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.mp-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.mp-badge-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mp-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;font-size:12px}
.mp-kv dt{color:var(--dsw-alias-label-secondary)}
.mp-kv dd{margin:0;overflow-wrap:anywhere}
.mp-groups-wrap{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.mp-groups-head,.mp-group{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:12px;align-items:center;padding:6px 12px}
.mp-groups-head{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.mp-groups-head span:last-child{text-align:right}
.mp-groups{max-height:320px;overflow-y:auto;overscroll-behavior:contain}
.mp-group{margin:0;font-size:13px;cursor:pointer;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mp-group:last-child{border-bottom:0}
.mp-group:hover{background:var(--dsw-alias-bg-layer-2)}
.mp-group-required{cursor:default}
.mp-group-required:hover{background:transparent}
.mp-group-check{display:flex;align-items:center;gap:8px;min-width:0}
.mp-group input{margin:0;flex:none}
.mp-group-name{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;min-width:0;overflow-wrap:anywhere}
.mp-group-count{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-align:right}
.mp-error{font-size:12px;color:var(--dsw-alias-state-error-primary);margin:0;overflow-wrap:anywhere}
.mp-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}
.mp-tags{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.mp-tags-row{display:grid;grid-template-columns:minmax(96px,1fr) minmax(0,1.1fr) minmax(0,1.1fr) max-content;gap:12px;align-items:center;padding:7px 12px;font-size:13px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mp-tags-row:last-child{border-bottom:0}
.mp-tags-head{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.mp-tags-name{min-width:0;overflow-wrap:anywhere}
.mp-tags-tag{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;min-width:0;overflow-wrap:anywhere;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.mp-tags-tag-idle{color:var(--dsw-alias-label-secondary);font-family:inherit}
.mp-tags-error{grid-column:1 / -1}
.mp-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,17,20,.45)}
.mp-modal-card{width:min(460px,100%);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 20px 56px rgba(0,0,0,.28);padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.mp-modal-title{font-size:14px;font-weight:600;margin:0}
.mp-toast{position:fixed;right:20px;bottom:20px;width:320px;max-width:calc(100vw - 40px);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 10px 30px rgba(0,0,0,.18);padding:14px 16px;display:flex;flex-direction:column;gap:10px;pointer-events:auto}
.mp-toast-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600}
.mp-toast-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}
.mp-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.mp-bar-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .25s linear}
.mp-bar-indeterminate{height:100%;width:40%;background:var(--dsw-alias-brand-primary);animation:mp-slide 1.2s ease-in-out infinite}
@keyframes mp-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.mp-toast-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;justify-content:space-between;gap:8px}
.mp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
`

    function Styles() {
      return h('style', null, STYLES)
    }

    function Badge({ tone, children }) {
      return h('span', { className: `mp-badge mp-badge-${tone ?? 'idle'}` }, children)
    }

    function phaseTone(phase) {
      if (phase === 'ready') return 'success'
      if (phase === 'failed') return 'error'
      if (phase === 'provisioning') return 'warn'
      return 'idle'
    }

    function Field({ label, hint, children }) {
      return h('div', { className: 'mp-row mp-row-block' },
        h('label', { className: 'mp-label' }, label),
        children,
        hint === undefined ? null : h('p', { className: 'mp-hint' }, hint))
    }

    function TextInput({ value, onChange, placeholder, disabled }) {
      return h('input', {
        className: 'mp-input',
        type: 'text',
        value,
        placeholder,
        disabled: disabled === true,
        onChange: event => onChange(event.target.value),
        spellCheck: false,
      })
    }

    function NumberInput({ value, onChange, min, placeholder }) {
      return h('input', {
        className: 'mp-input',
        type: 'number',
        min,
        value: String(value),
        placeholder,
        onChange: event => onChange(event.target.value),
      })
    }

    /**
     * A single-choice row.
     *
     * Every choice this page offers has at most four short options, so a row of
     * radios shows all of them at once instead of hiding three behind a
     * dropdown: nothing to open, nothing to scroll, one click to switch.
     */
    function RadioGroup({ name, value, options, onChange }) {
      return h('div', { className: 'mp-radio-row', role: 'radiogroup' },
        options.map(option => h('label', { key: option.value, className: 'mp-radio' },
          h('input', {
            type: 'radio',
            name,
            value: option.value,
            checked: value === option.value,
            onChange: () => onChange(option.value),
          }),
          h('span', null, option.label))))
    }

    function Toggle({ checked, onChange, label, hint }) {
      return h('div', { className: 'mp-row-block' },
        h('label', { className: 'mp-toggle' },
          h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }),
          h('span', null, label)),
        hint === undefined ? null : h('p', { className: 'mp-hint', style: { marginLeft: 22 } }, hint))
    }

    function Button({ children, onClick, disabled, variant, title }) {
      return h('button', {
        type: 'button',
        className: `mp-btn${variant === 'primary' ? ' mp-btn-primary' : ''}${variant === 'danger' ? ' mp-btn-danger' : ''}`,
        onClick,
        disabled: disabled === true,
        title,
      }, children)
    }

    /** The editable fields, in the order the page renders them. */
    const TEXT_FIELDS = ['matlabRoot', 'initialWorkingFolder', 'mcpServerPath', 'serverName', 'githubProxy']

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


    function StatusCard({ t, state, onRefresh }) {
      const routeList = state.github?.routes ?? []
      const tools = state.probe?.ok === true ? state.probe.tools.length : undefined
      const resources = state.probe?.ok === true ? state.probe.resources.length : undefined
      return h('div', { className: 'mp-card' },
        h('div', { className: 'mp-card-head' },
          h('div', null,
            h('h2', { className: 'mp-card-title' }, t('title')),
            h('p', { className: 'mp-hint' }, t('subtitle'))),
          h('div', { className: 'mp-actions' },
            h(Badge, { tone: phaseTone(state.phase) }, state.phase),
            h(Button, { onClick: onRefresh }, t('refresh')))),
        h('dl', { className: 'mp-kv' },
          h('dt', null, t('pluginVersion')),
          h('dd', null, state.version ?? t('none')),
          h('dt', null, t('matlab')),
          h('dd', null, state.matlab?.root ?? t('notDetected')),
          h('dt', null, t('server')),
          h('dd', null, state.server?.path ?? t('notDetected')),
          h('dt', null, t('route')),
          h('dd', null, routeList.length === 0 ? t('none') : routeList.join(' → ')),
          h('dt', null, t('groups')),
          h('dd', null, String(state.groups.length)),
          h('dt', null, t('tools')),
          h('dd', null, tools === undefined ? t('none') : `${tools} / ${resources}`)),
        state.error === null ? null : h('p', { className: 'mp-error' }, `${t('error')}: ${state.error}`),
        state.warnings.length === 0 ? null : h('p', { className: 'mp-note' }, `${t('warnings')}: ${state.warnings.join(' · ')}`),
        state.editable ? null : h('p', { className: 'mp-note' }, t('editableUnavailable')))
    }

    function GroupsCard({ t, state, selected, onSelected }) {
      const groups = state.groups
      const editable = state.editable
      const requiredNames = groups.filter(group => group.required === true).map(group => group.name)
      const rows = groups.map(group => {
        const required = group.required === true
        return h('label', {
          key: group.name,
          className: required ? 'mp-group mp-group-required' : 'mp-group',
          title: group.description === undefined || group.description === '' ? undefined : group.description,
        },
          h('span', { className: 'mp-group-check' },
            h('input', {
              type: 'checkbox',
              checked: required || selected.has(group.name),
              disabled: !editable || required,
              onChange: event => {
                if (required) return
                const next = new Set(selected)
                if (event.target.checked) next.add(group.name)
                else next.delete(group.name)
                onSelected(next)
              },
            }),
            h('span', { className: 'mp-group-name' },
              h('span', null, group.displayName || group.name),
              required ? h('span', { className: 'mp-badge' }, t('required')) : null)),
          h('span', { className: 'mp-group-count' }, `${group.skills} ${t('skillsUnit')}`))
      })
      return h('div', { className: 'mp-card' },
        h('div', { className: 'mp-card-head' },
          h('h2', { className: 'mp-card-title' }, t('groupsTitle')),
          h('div', { className: 'mp-actions' },
            h(Button, {
              onClick: () => onSelected(new Set(groups.map(group => group.name))),
              disabled: groups.length === 0 || !editable,
            }, t('selectAll')),
            h(Button, {
              onClick: () => onSelected(new Set(requiredNames)),
              disabled: groups.length === 0 || !editable,
            }, t('selectNone')))),
        h('p', { className: 'mp-hint' }, t('groupsHint')),
        groups.length === 0
          ? h('p', { className: 'mp-note' }, t('noToolkit'))
          : h('div', { className: 'mp-groups-wrap' },
            h('div', { className: 'mp-groups-head' },
              h('span', null, t('groupColumn')),
              h('span', null, t('skillsColumn'))),
            h('div', { className: 'mp-groups', role: 'group', 'aria-label': t('groupsTitle') }, rows)))
    }

    function MatlabCard({ t, state, draft, onDraft }) {
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('matlabTitle')),
        h(Field, { label: t('matlabRoot'), hint: t('matlabRootHint') },
          h(TextInput, {
            value: draft.matlabRoot,
            disabled: !state.editable,
            placeholder: PLACEHOLDERS.matlabRoot,
            onChange: value => onDraft({ ...draft, matlabRoot: value }),
          })),
        h(Field, { label: t('displayMode') },
          h(RadioGroup, {
            name: 'matlab-display-mode',
            value: draft.displayMode,
            onChange: value => onDraft({ ...draft, displayMode: value }),
            options: [
              { value: 'desktop', label: t('desktop') },
              { value: 'nodesktop', label: t('nodesktop') },
            ],
          })),
        h(Field, { label: t('sessionMode') },
          h(RadioGroup, {
            name: 'matlab-session-mode',
            value: draft.sessionMode,
            onChange: value => onDraft({ ...draft, sessionMode: value }),
            options: [
              { value: 'auto', label: t('auto') },
              { value: 'existing', label: t('existing') },
              { value: 'new', label: t('newSession') },
            ],
          })),
        h(Field, { label: t('initialWorkingFolder'), hint: t('initialWorkingFolderHint') },
          h(TextInput, {
            value: draft.initialWorkingFolder,
            placeholder: PLACEHOLDERS.initialWorkingFolder,
            onChange: value => onDraft({ ...draft, initialWorkingFolder: value }),
          })),
        h(Toggle, {
          checked: draft.initializeMatlabOnStartup,
          onChange: value => onDraft({ ...draft, initializeMatlabOnStartup: value }),
          label: t('initialize'),
          hint: t('initializeHint'),
        }),
        h(Toggle, {
          checked: draft.disableTelemetry,
          onChange: value => onDraft({ ...draft, disableTelemetry: value }),
          label: t('telemetry'),
          hint: t('telemetryHint'),
        }))
    }

    function ServerCard({ t, state, draft, onDraft }) {
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('serverTitle')),
        h(Field, { label: t('mcpServerPath'), hint: t('mcpServerPathHint') },
          h(TextInput, {
            value: draft.mcpServerPath,
            placeholder: PLACEHOLDERS.mcpServerPath,
            onChange: value => onDraft({ ...draft, mcpServerPath: value }),
          })),
        h(Field, { label: t('serverName'), hint: t('serverNameHint') },
          h(TextInput, {
            value: draft.serverName,
            placeholder: PLACEHOLDERS.serverName,
            onChange: value => onDraft({ ...draft, serverName: value }),
          })),
        h(Field, { label: t('agentName'), hint: t('agentNameHint') },
          h(TextInput, {
            value: draft.agentName,
            placeholder: PLACEHOLDERS.agentName,
            onChange: value => onDraft({ ...draft, agentName: value }),
          })),
        h(Field, { label: t('callTimeout'), hint: t('callTimeoutHint') },
          h(NumberInput, {
            value: draft.toolCallTimeoutMs,
            min: 1000,
            placeholder: PLACEHOLDERS.toolCallTimeoutMs,
            onChange: value => onDraft({ ...draft, toolCallTimeoutMs: value }),
          })))
    }

    function NetworkCard({ t, state, draft, onDraft }) {
      const routeList = state.github?.routes ?? []
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('networkTitle')),
        h(Field, { label: t('githubProxy'), hint: t('githubProxyHint') },
          h(TextInput, {
            value: draft.githubProxy,
            placeholder: PLACEHOLDERS.githubProxy,
            onChange: value => onDraft({ ...draft, githubProxy: value }),
          })),
        h(Field, { label: t('region') },
          h(RadioGroup, {
            name: 'matlab-download-region',
            value: draft.downloadRegion,
            onChange: value => onDraft({ ...draft, downloadRegion: value }),
            options: [
              { value: 'auto', label: t('regionAuto') },
              { value: 'china', label: t('regionChina') },
              { value: 'global', label: t('regionGlobal') },
            ],
          })),
        h(Field, { label: t('routes') },
          h('p', { className: 'mp-note' }, routeList.length === 0 ? t('none') : routeList.join(' → '))),
        h(Field, { label: t('timeout'), hint: t('timeoutHint') },
          h(NumberInput, {
            value: draft.provisionTimeoutMs,
            min: 10000,
            placeholder: PLACEHOLDERS.provisionTimeoutMs,
            onChange: value => onDraft({ ...draft, provisionTimeoutMs: value }),
          })),
        h(Field, { label: t('wait'), hint: t('waitHint') },
          h(NumberInput, {
            value: draft.provisionWaitMs,
            min: 0,
            placeholder: PLACEHOLDERS.provisionWaitMs,
            onChange: value => onDraft({ ...draft, provisionWaitMs: value }),
          })),
        h(Toggle, {
          checked: draft.watchSkills,
          onChange: value => onDraft({ ...draft, watchSkills: value }),
          label: t('watch'),
          hint: t('watchHint'),
        }))
    }

    /**
     * The release tag inside a version line.
     *
     * The server reports its version as `github.com/matlab/matlab-mcp-server
     * v0.16.0`; the local-tag column wants the tag alone.
     */
    function releaseTag(text) {
      if (typeof text !== 'string') return undefined
      const match = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/u.exec(text)
      if (match === null) return undefined
      return match[0].startsWith('v') ? match[0] : `v${match[0]}`
    }

    /** One artifact's row: its name, the installed release tag, and the published one. */
    function UpdateRow({ t, label, status, checked }) {
      const installed = status?.installed === true
      const local = status?.current
      const latest = status?.latest
      const localTag = installed === false
        ? t('notInstalled')
        : local === undefined || local === ''
          ? t('unknownTag')
          : local
      // A check that has not run yet has nothing to report for the third column;
      // once it has, the published tag is shown even when it equals the local one.
      const hasLatest = checked === true && latest !== undefined && latest !== null && latest !== ''
      return h('div', { className: 'mp-tags-row', role: 'row' },
        h('span', { className: 'mp-tags-name', role: 'rowheader' }, label),
        h('span', { className: 'mp-tags-tag', role: 'cell' }, localTag),
        h('span', { className: 'mp-tags-tag', role: 'cell' },
          h('span', { className: hasLatest ? undefined : 'mp-tags-tag-idle' }, hasLatest ? latest : t('notChecked')),
          status?.outdated === true ? h(Badge, { tone: 'warn' }, t('updateAvailable')) : null),
        status?.error === undefined || status.error === null
          ? null
          : h('span', { className: 'mp-error mp-tags-error' }, status.error))
    }

    /**
     * One card for the local artifacts: what is installed, what is published, and
     * the three things a user can do about it.
     *
     * Local presence and tags come from the state the page already loaded, so
     * entering the page is itself the local check; only "what is published"
     * needs the online probe behind {@link onCheck}.
     */
    function DependenciesCard({ t, state, busy, checking, working, note, onCheck, onDownload, onRemove }) {
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
      const summary = outdated
        ? t('updateAvailable')
        : failed
          ? t('checkFailed')
          : t('upToDate')
      const workingDownload = working === 'download'
      const workingRemove = working === 'remove'
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('dependenciesTitle')),
        h('p', { className: 'mp-hint' }, t('dependenciesHint')),
        h('div', { className: 'mp-tags', role: 'table' },
          h('div', { className: 'mp-tags-row mp-tags-head', role: 'row' },
            h('span', { role: 'columnheader' }, t('artifactColumn')),
            h('span', { role: 'columnheader' }, t('localTagColumn')),
            h('span', { role: 'columnheader' }, t('latestTagColumn')),
            h('span', { 'aria-hidden': 'true' })),
          h(UpdateRow, { t, label: t('serverTitle'), status: server, checked: updates !== null }),
          h(UpdateRow, { t, label: t('toolkitLabel'), status: toolkit, checked: updates !== null })),
        updates === null ? null : h('p', { className: 'mp-note' }, summary),
        h('div', { className: 'mp-actions' },
          h(Button, { onClick: onCheck, disabled: busy || checking || working !== null }, checking ? t('checking') : t('checkUpdates')),
          h(Button, {
            variant: 'primary',
            onClick: onDownload,
            disabled: busy || working !== null || !canDownload,
            title: canDownload ? undefined : t('downloadBlocked'),
          }, workingDownload ? t('downloading') : t('downloadLatest')),
          h(Button, {
            variant: 'danger',
            onClick: onRemove,
            disabled: busy || working !== null || (!serverInstalled && !toolkitInstalled),
          }, workingRemove ? t('removing') : t('removeLocal'))),
        note === null || note === undefined
          ? null
          : h('p', { className: note.tone === 'error' ? 'mp-error' : 'mp-note' }, note.text))
    }

    /** The confirmation the destructive action must pass through. */
    function ConfirmRemove({ t, busy, onCancel, onConfirm }) {
      return h('div', { className: 'mp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('confirmRemoveTitle') },
        h('div', { className: 'mp-modal-card' },
          h('h3', { className: 'mp-modal-title' }, t('confirmRemoveTitle')),
          h('p', { className: 'mp-hint' }, t('confirmRemoveBody')),
          h('div', { className: 'mp-actions' },
            h(Button, { onClick: onCancel, disabled: busy }, t('confirmRemoveCancel')),
            h(Button, { variant: 'danger', onClick: onConfirm, disabled: busy },
              busy ? t('removing') : t('confirmRemoveConfirm')))))
    }

    /**
     * The page's save bar.
     *
     * It is sticky rather than last-in-flow: the page is much taller than the
     * settings viewport (24 groups plus every card), and a save button nobody
     * scrolls back to is a save button nobody finds.
     */
    function SaveBar({ t, busy, dirty, editable, message, onSave, onRevert }) {
      return h('div', { className: 'mp-savebar' },
        h(Button, { variant: 'primary', onClick: onSave, disabled: busy || !dirty || !editable },
          busy ? t('saving') : t('save')),
        h(Button, { onClick: onRevert, disabled: busy || !dirty }, t('revert')),
        message === null
          ? null
          : h('span', { className: message.tone === 'error' ? 'mp-error' : 'mp-note' }, message.text))
    }

    function SettingsPage({ t }) {
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
      // Feedback for a dependency action; it stays inside the dependency card so
      // the save bar only ever talks about saving.
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

      useEffect(() => {
        if (state === null || state.phase !== 'provisioning') return undefined
        const timer = setTimeout(() => { void load(false) }, 2500)
        return () => clearTimeout(timer)
      }, [state, load])

      const groups = state?.groups ?? []
      const dirty = draft !== null && state !== null && (
        JSON.stringify(draft) !== JSON.stringify(initialDraft.current)
        || !sameSet(selected, initialSelected))

      const save = useCallback(async () => {
        if (draft === null || state === null) return
        setBusy(true)
        setMessage(null)
        try {
          // A required group is always part of the saved selection, even if a
          // stale page state tried to drop it: the Host enforces the same rule.
          const chosen = groups
            .filter(group => group.required === true || selected.has(group.name))
            .map(group => group.name)
          const everySelected = groups.length > 0 && chosen.length === groups.length
          // Every group checked is stored as "all", so groups a later toolkit
          // adds are included without the user saving a new list.
          const declared = everySelected ? [] : chosen
          await postJson('/plugin/matlab/config', {
            revision: state.revision,
            patch: {
              ...draft,
              toolCallTimeoutMs: Number(draft.toolCallTimeoutMs) || state.config.toolCallTimeoutMs,
              provisionTimeoutMs: Number(draft.provisionTimeoutMs) || state.config.provisionTimeoutMs,
              provisionWaitMs: Math.max(0, Math.min(60000, Number(draft.provisionWaitMs) || 0)),
              skillGroups: declared,
            },
          })
          await load()
          setMessage({ tone: 'success', text: t('saved') })
        } catch (cause) {
          const text = cause instanceof Error ? cause.message : String(cause)
          // Reload first and report after: `load()` clears the message, so
          // setting it before the reload would hide the reason from the user.
          await load()
          setMessage({ tone: 'error', text })
        } finally {
          setBusy(false)
        }
      }, [draft, state, groups, selected, load, t])

      const check = useCallback(async () => {
        setChecking(true)
        // Dependency feedback belongs in the dependency card, not next to Save:
        // the result line already lives there, and "up to date" is not an edit.
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
      }, [load, t])

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
        setMessage(null)
        try {
          await postJson('/plugin/matlab/dependencies', { action: 'remove' })
          setConfirmRemove(false)
          await load()
          setDependencyNote({ tone: 'success', text: t('removed') })
        } catch (cause) {
          setDependencyNote({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setWorking(null)
        }
      }, [load, t])

      if (state === null || draft === null || initialDraft.current === null) {
        return h('div', { className: 'mp-page' },
          h(Styles),
          h('p', { className: message === null ? 'mp-note' : 'mp-error' },
            message === null ? t('saving') : message.text))
      }

      return h('div', { className: 'mp-page' },
        h(Styles),
        h(StatusCard, { t, state, onRefresh: () => { void load() } }),
        // The dependencies card follows the status card: "what is installed /
        // what is published" belongs next to the state it compares, before the
        // long groups list.
        h(DependenciesCard, {
          t,
          state,
          busy,
          checking,
          working,
          note: dependencyNote,
          onCheck: () => { void check() },
          onDownload: () => { void download() },
          onRemove: () => setConfirmRemove(true),
        }),
        h(GroupsCard, { t, state, selected, onSelected: setSelected }),
        h(MatlabCard, { t, state, draft, onDraft: setDraft }),
        h(ServerCard, { t, state, draft, onDraft: setDraft }),
        h(NetworkCard, { t, state, draft, onDraft: setDraft }),
        h(SaveBar, {
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
            busy: working === 'remove',
            onCancel: () => setConfirmRemove(false),
            onConfirm: () => { void remove() },
          })
          : null)
    }

    /** The frame-wide progress dialog, driven by the Host's progress record. */
    function ProgressOverlay({ t }) {
      const [progress, setProgress] = useState(null)
      const [hidden, setHidden] = useState(false)

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
            setProgress(next)
            if (next.active === true) setHidden(false)
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

      return h('div', { className: 'mp-toast', role: 'status', 'aria-live': 'polite' },
        h(Styles),
        h('div', { className: 'mp-toast-head' },
          h('span', null, title),
          active ? null : h('button', {
            type: 'button',
            className: 'mp-toast-close',
            onClick: () => setHidden(true),
            'aria-label': t('progressHide'),
          }, '\u00d7')),
        h('p', { className: 'mp-hint' }, line),
        h('div', { className: 'mp-bar' }, bar),
        h('div', { className: 'mp-toast-meta' },
          h('span', null, meta),
          progress.route === null ? null : h('span', null, `${t('progressRoute')} ${progress.route}`)),
        failed ? h('p', { className: 'mp-error' }, progress.error ?? t('none')) : null,
        failed || finished
          ? h('div', { className: 'mp-actions' },
            h(Button, { onClick: () => { void retry() } }, t('progressRetry')),
            h(Button, { onClick: () => setHidden(true) }, t('progressHide')))
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

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 45,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, ownerProps => h(SettingsPage, { t: ownerProps?.t ?? t, close: ownerProps?.close })))

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
