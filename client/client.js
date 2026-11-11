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
        version: '版本',
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
        groupsHint: '开关决定模型能看到哪些 MATLAB 技能。默认全开；全部勾选时保存为“全部”，新增的组也会自动纳入。',
        selectAll: '全选',
        selectNone: '全不选',
        required: '必需',
        skillsUnit: '个技能',
        noToolkit: '还没有找到工具包 checkout。装一次依赖后这里会列出技能组。',
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
        timeoutHint: '下载或克隆的总预算；只约束后台任务。',
        wait: '启动最多等待（毫秒）',
        waitHint: '0 表示首次准备完全在后台进行，不阻塞启动；最大不超过 60000。',
        watch: '监视工具包变化',
        watchHint: '工具包更新后自动重载技能目录。',
        maintenance: '维护',
        maintenanceHint: '检查二进制与工具包是否就绪；缺什么就下载什么，全程在后台进行。',
        updatesTitle: '更新依赖',
        updatesHint: '检查 MathWorks 与工具包仓库发布的最新版本；只有比当前新时才下载。更新会先停掉正在运行的 MCP 桥与技能目录，再重新挂载。',
        checkUpdates: '检查更新',
        updateNow: '更新依赖',
        checking: '正在检查…',
        updating: '正在更新…',
        upToDate: '已是最新',
        updateAvailable: '有可用更新',
        updatesNever: '尚未检查。',
        currentLabel: '当前',
        latestLabel: '最新',
        notInstalled: '未安装',
        toolkitLabel: '工具包',
        updateKindTitle: '正在更新 MATLAB 依赖',
        installMissing: '检查并安装缺失依赖',
        installed: '依赖已就绪',
        retry: '重试',
        progressTitle: '正在准备 MATLAB 依赖',
        progressClone: '正在克隆 MATLAB Agentic Toolkit…',
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
        version: 'Version',
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
        groupsHint: 'Switches decide which MATLAB skills the model can see. All groups are on by default; saving with every group checked stores "all", so new groups join automatically.',
        selectAll: 'Select all',
        selectNone: 'Select none',
        required: 'required',
        skillsUnit: 'skills',
        noToolkit: 'No toolkit checkout yet. Installing the dependencies once will list the groups here.',
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
        timeoutHint: 'Budget for one download or clone; it bounds the background job only.',
        wait: 'Startup wait (ms)',
        waitHint: '0 keeps the first fetch entirely in the background; 60000 is the useful maximum.',
        watch: 'Watch the toolkit',
        watchHint: 'Reload the skill catalog when the toolkit changes on disk.',
        maintenance: 'Maintenance',
        maintenanceHint: 'Check the binary and the toolkit; anything missing is fetched in the background.',
        updatesTitle: 'Updates',
        updatesHint: 'Compares the installed artifacts with the newest published ones; only a newer version is downloaded. The running MCP bridge and skill catalog are stopped and remounted around the update.',
        checkUpdates: 'Check for updates',
        updateNow: 'Update dependencies',
        checking: 'Checking…',
        updating: 'Updating…',
        upToDate: 'Up to date',
        updateAvailable: 'Update available',
        updatesNever: 'Not checked yet.',
        currentLabel: 'Current',
        latestLabel: 'Latest',
        notInstalled: 'not installed',
        toolkitLabel: 'Toolkit',
        updateKindTitle: 'Updating MATLAB dependencies',
        installMissing: 'Check and install what is missing',
        installed: 'Dependencies are ready',
        retry: 'Retry',
        progressTitle: 'Preparing MATLAB dependencies',
        progressClone: 'Cloning the MATLAB Agentic Toolkit…',
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
.mp-page{display:flex;flex-direction:column;gap:18px;max-width:760px;padding:4px 2px 40px;color:var(--dsw-alias-label-primary)}
.mp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.mp-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.mp-card-title{font-size:14px;font-weight:600;margin:0}
.mp-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0}
.mp-row{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:10px 16px;align-items:center}
.mp-row-block{display:flex;flex-direction:column;gap:6px}
.mp-label{font-size:13px;color:var(--dsw-alias-label-primary)}
.mp-input,.mp-select{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.mp-input:focus,.mp-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mp-toggle{display:flex;align-items:flex-start;gap:8px;font-size:13px}
.mp-toggle input{margin:3px 0 0}
.mp-btn{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.mp-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.mp-btn:disabled{opacity:.5;cursor:default}
.mp-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.mp-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.mp-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mp-badge-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.mp-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.mp-badge-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mp-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;font-size:12px}
.mp-kv dt{color:var(--dsw-alias-label-secondary)}
.mp-kv dd{margin:0;overflow-wrap:anywhere}
.mp-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 16px}
.mp-group{display:flex;align-items:flex-start;gap:8px;font-size:13px;padding:3px 0}
.mp-group input{margin-top:3px}
.mp-group-name{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.mp-group-count{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mp-error{font-size:12px;color:var(--dsw-alias-state-error-primary);margin:0;overflow-wrap:anywhere}
.mp-note{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}
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

    function NumberInput({ value, onChange, min }) {
      return h('input', {
        className: 'mp-input',
        type: 'number',
        min,
        value: String(value),
        onChange: event => onChange(event.target.value),
      })
    }

    function Select({ value, options, onChange }) {
      return h('select', {
        className: 'mp-select',
        value,
        onChange: event => onChange(event.target.value),
      }, options.map(option => h('option', { key: option.value, value: option.value }, option.label)))
    }

    function Toggle({ checked, onChange, label, hint }) {
      return h('div', { className: 'mp-row-block' },
        h('label', { className: 'mp-toggle' },
          h('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }),
          h('span', null, label)),
        hint === undefined ? null : h('p', { className: 'mp-hint', style: { marginLeft: 22 } }, hint))
    }

    function Button({ children, onClick, disabled, variant }) {
      return h('button', {
        type: 'button',
        className: `mp-btn${variant === 'primary' ? ' mp-btn-primary' : ''}`,
        onClick,
        disabled: disabled === true,
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
      const declared = Array.isArray(config.skillGroups) ? config.skillGroups : []
      const every = declared.length === 0 || declared.includes('*')
      if (every) return new Set(groups.map(group => group.name))
      return new Set(declared.filter(name => groups.some(group => group.name === name)))
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
          h('dt', null, t('matlab')),
          h('dd', null, state.matlab?.root ?? t('notDetected')),
          h('dt', null, t('server')),
          h('dd', null, state.server?.path ?? t('notDetected')),
          h('dt', null, t('version')),
          h('dd', null, state.server?.version ?? t('none')),
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
      const rows = groups.map(group => h('label', { key: group.name, className: 'mp-group' },
        h('input', {
          type: 'checkbox',
          checked: selected.has(group.name),
          disabled: !state.editable,
          onChange: event => {
            const next = new Set(selected)
            if (event.target.checked) next.add(group.name)
            else next.delete(group.name)
            onSelected(next)
          },
        }),
        h('span', { className: 'mp-group-name' },
          h('span', null, group.displayName || group.name),
          h('span', { className: 'mp-group-count' }, `${group.skills} ${t('skillsUnit')}`),
          group.required ? h('span', { className: 'mp-badge' }, t('required')) : null)))
      return h('div', { className: 'mp-card' },
        h('div', { className: 'mp-card-head' },
          h('h2', { className: 'mp-card-title' }, t('groupsTitle')),
          h('div', { className: 'mp-actions' },
            h(Button, {
              onClick: () => onSelected(new Set(groups.map(group => group.name))),
              disabled: groups.length === 0 || !state.editable,
            }, t('selectAll')),
            h(Button, {
              onClick: () => onSelected(new Set()),
              disabled: groups.length === 0 || !state.editable,
            }, t('selectNone')))),
        h('p', { className: 'mp-hint' }, t('groupsHint')),
        groups.length === 0
          ? h('p', { className: 'mp-note' }, t('noToolkit'))
          : h('div', { className: 'mp-groups' }, rows))
    }

    function MatlabCard({ t, state, draft, onDraft }) {
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('matlabTitle')),
        h(Field, { label: t('matlabRoot'), hint: t('matlabRootHint') },
          h(TextInput, {
            value: draft.matlabRoot,
            disabled: !state.editable,
            onChange: value => onDraft({ ...draft, matlabRoot: value }),
          })),
        h(Field, { label: t('displayMode') },
          h(Select, {
            value: draft.displayMode,
            onChange: value => onDraft({ ...draft, displayMode: value }),
            options: [
              { value: 'desktop', label: t('desktop') },
              { value: 'nodesktop', label: t('nodesktop') },
            ],
          })),
        h(Field, { label: t('sessionMode') },
          h(Select, {
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
            onChange: value => onDraft({ ...draft, mcpServerPath: value }),
          })),
        h(Field, { label: t('serverName'), hint: t('serverNameHint') },
          h(TextInput, {
            value: draft.serverName,
            onChange: value => onDraft({ ...draft, serverName: value }),
          })),
        h(Field, { label: t('agentName'), hint: t('agentNameHint') },
          h(TextInput, {
            value: draft.agentName,
            onChange: value => onDraft({ ...draft, agentName: value }),
          })),
        h(Field, { label: t('callTimeout'), hint: t('callTimeoutHint') },
          h(NumberInput, {
            value: draft.toolCallTimeoutMs,
            min: 1000,
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
            onChange: value => onDraft({ ...draft, githubProxy: value }),
          })),
        h(Field, { label: t('region') },
          h(Select, {
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
            onChange: value => onDraft({ ...draft, provisionTimeoutMs: value }),
          })),
        h(Field, { label: t('wait'), hint: t('waitHint') },
          h(NumberInput, {
            value: draft.provisionWaitMs,
            min: 0,
            onChange: value => onDraft({ ...draft, provisionWaitMs: value }),
          })),
        h(Toggle, {
          checked: draft.watchSkills,
          onChange: value => onDraft({ ...draft, watchSkills: value }),
          label: t('watch'),
          hint: t('watchHint'),
        }))
    }

    function MaintenanceCard({ t, busy, onInstall, onRefresh }) {
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('maintenance')),
        h('p', { className: 'mp-hint' }, t('maintenanceHint')),
        h('div', { className: 'mp-actions' },
          h(Button, { variant: 'primary', onClick: onInstall, disabled: busy }, t('installMissing')),
          h(Button, { onClick: onRefresh }, t('refresh'))))
    }

    /** One artifact's current/latest line inside the Updates card. */
    function UpdateRow({ t, label, status }) {
      const outdated = status?.outdated === true
      const value = status?.installed !== true
        ? t('notInstalled')
        : `${t('currentLabel')} ${status.current ?? '?'}`
      return h('div', { className: 'mp-row' },
        h('span', { className: 'mp-label' }, label),
        h('span', { className: 'mp-group-name' },
          h('span', null, value),
          status?.latest === undefined ? null : h('span', { className: 'mp-group-count' }, `${t('latestLabel')} ${status.latest}`),
          outdated ? h(Badge, { tone: 'warn' }, t('updateAvailable')) : null,
          status?.error === undefined ? null : h('span', { className: 'mp-error' }, status.error)))
    }

    function UpdatesCard({ t, state, busy, checking, onCheck, onUpdate }) {
      const updates = state.updates
      const outdated = updates !== null && (updates.toolkit?.outdated === true || updates.server?.outdated === true)
      const summary = updates === null
        ? t('updatesNever')
        : outdated
          ? t('updateAvailable')
          : t('upToDate')
      return h('div', { className: 'mp-card' },
        h('h2', { className: 'mp-card-title' }, t('updatesTitle')),
        h('p', { className: 'mp-hint' }, t('updatesHint')),
        h(UpdateRow, { t, label: t('serverTitle'), status: updates?.server }),
        h(UpdateRow, { t, label: t('toolkitLabel'), status: updates?.toolkit }),
        h('p', { className: 'mp-note' }, summary),
        h('div', { className: 'mp-actions' },
          h(Button, { onClick: onCheck, disabled: busy }, checking ? t('checking') : t('checkUpdates')),
          outdated ? h(Button, { variant: 'primary', onClick: onUpdate, disabled: busy }, t('updateNow')) : null))
    }

    function SaveBar({ t, busy, dirty, editable, message, onSave, onRevert }) {
      return h('div', { className: 'mp-actions' },
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
          const everySelected = groups.length > 0 && selected.size === groups.length
          const declared = everySelected
            ? []
            : groups.filter(group => selected.has(group.name)).map(group => group.name)
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
          setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
          await load()
        } finally {
          setBusy(false)
        }
      }, [draft, state, groups, selected, load, t])

      const install = useCallback(async () => {
        setBusy(true)
        setMessage(null)
        try {
          await postJson('/plugin/matlab/provision')
          await load(false)
        } catch (cause) {
          setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setBusy(false)
        }
      }, [load])

      const check = useCallback(async () => {
        setChecking(true)
        setMessage(null)
        try {
          await postJson('/plugin/matlab/update', { check: true })
          await load(false)
        } catch (cause) {
          setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setChecking(false)
        }
      }, [load])

      const update = useCallback(async () => {
        setBusy(true)
        setMessage(null)
        try {
          await postJson('/plugin/matlab/update', {})
          await load(false)
        } catch (cause) {
          setMessage({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setBusy(false)
        }
      }, [load])

      if (state === null || draft === null || initialDraft.current === null) {
        return h('div', { className: 'mp-page' },
          h(Styles),
          h('p', { className: message === null ? 'mp-note' : 'mp-error' },
            message === null ? t('saving') : message.text))
      }

      return h('div', { className: 'mp-page' },
        h(Styles),
        h(StatusCard, { t, state, onRefresh: () => { void load() } }),
        h(GroupsCard, { t, state, selected, onSelected: setSelected }),
        h(MatlabCard, { t, state, draft, onDraft: setDraft }),
        h(ServerCard, { t, state, draft, onDraft: setDraft }),
        h(NetworkCard, { t, state, draft, onDraft: setDraft }),
        h(UpdatesCard, {
          t,
          state,
          busy,
          checking,
          onCheck: () => { void check() },
          onUpdate: () => { void update() },
        }),
        h(MaintenanceCard, { t, busy, onInstall: () => { void install() }, onRefresh: () => { void load(true) } }),
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
        }))
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
          : progress.stage === 'clone'
            ? t('progressClone')
            : t('progressDownload')

      const meta = progress.stage === 'download' && progress.totalBytes !== null
        ? `${t('progressBytes')} ${formatBytes(progress.bytes)} / ${formatBytes(progress.totalBytes)}`
        : progress.stage === 'download'
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
