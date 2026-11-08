# dsh-plugin-matlab

把 **MathWorks 官方的 MATLAB 能力**接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)：

- **MATLAB MCP Server 工具** — `evaluate_matlab_code`、`run_matlab_file`、`run_matlab_test_file`、`check_matlab_code`、`detect_matlab_toolboxes`，以及两个 `guidelines://` 资源；
- **MATLAB Agentic Toolkit 技能** — 24 个技能组、158 个 `SKILL.md`（按组按需加载）；
- 若本机同时装了 Simulink Agentic Toolkit，其技能组与 `--extension-file` 工具扩展也会一并接入。

插件本身**不实现任何 MATLAB 能力**。它只做三件连接性的事：**找到** MathWorks 的二进制与技能目录，**校验**它能跑通（一次 MCP 握手），**挂载** DSH 自带的两个传输层（MCP 桥、技能目录提供方）。工具与技能内容全部是 MathWorks 原件，不复制、不改写、不重新打包。

> 设计与取舍见 [DESIGN.md](DESIGN.md)。命令与字段速查见下文。

---

## 它怎么工作

```
                  ┌──────────────────────── DSH 侧（已有） ───────────────────────┐
MathWorks 侧       │                                                              │
┌───────────────┐  │  @deepseek-ai/dsh-mcp-client      →  mcp__matlab__<tool>      │
│ matlab-mcp-   │──┼─▶ stdio 子进程，原样透传 MATLAB CLI 参数                      │
│ server(.exe)  │  │                                                              │
└───────────────┘  │  @deepseek-ai/dsh-skill-filesystem →  会话技能目录             │
┌───────────────┐  │        customSkillDirs = <toolkit>/skills-catalog/<group>     │
│ <toolkit>/    │──┘                                                              │
│ skills-catalog│                                                                 │
└───────────────┘  本插件只负责：发现 → 探测 → 组装这两份配置并挂载                  │
```

这一点和 MathWorks 自己给 Amp 的接法完全一致（`amp.skills.path` 指向 `skills-catalog/<group>`），也就是**同一个“原生指向”**：技能组目录就是根，二进制就是二进制。

## 环境要求

| 依赖 | 说明 |
| --- | --- |
| MATLAB R2021a 或更新 | 需已在系统上安装；插件会从安装器记录、注册表、`PATH`、安装目录中自动找 |
| MATLAB MCP Server | v0.16.0 起验证；二进制缺失且允许自动准备时会从 MathWorks GitHub Release 下载 |
| MATLAB Agentic Toolkit | 目录中包含 `manifest.yaml` 与 `skills-catalog/` 的任意 checkout |
| DSH | 需要 profile 中已组合 `@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/dsh-skill-filesystem`（base bundle 自带） |

推荐先在 MATLAB 里执行官方安装器，本插件随后会自动发现它装好的一切：

```matlab
setupAgenticToolkit("install")          % 装 MCP Server + 工具包
shareMATLABSession()                    % 可选：让 DSH 复用你正在用的 MATLAB 会话
```

安装器会把东西放在 `~/.matlab/agentic-toolkits/`：`bin/matlab-mcp-server.exe`、`matlab/`（工具包 checkout）、`config.json`。本插件读取这份 `config.json`，因此**你在 MATLAB 里选的 MATLAB 版本会被直接沿用**。

## 安装

本包目前**未发布到 npm**，因此按本地 checkout 安装。DSH Desktop 与 `dsh` 都支持从本地路径安装插件。

### 方式一：装进当前 profile（推荐）

```bash
git clone git@gitee.com:xuyuntao/dsh-matlab.git
cd <profile 目录>          # 例如 ~/.dsh/profiles/desktop
pnpm add file:/path/to/dsh-matlab
```

然后在 profile 的 `cordis.patch.yml` 里加入（`cordis.patch.yml` 也可作为 bundle 层自动插入，见方式二）：

```yaml
- insert:
    - id: matlab-agentic
      name: 'dsh-plugin-matlab'
```

重启 Host，或让 loader 重载该条目。桌面端也可以在“插件”页确认 `matlab-agentic` 已启用。

### 方式二：作为 bundle 层

`package.json` 已声明 `dsh.bundle.patch`，`cordis.patch.yml` 会插入 `matlab-agentic` 这一行。把本包加入 profile 的 `dsh.profile.bundles` 后，在桌面端“插件”页开关它即可；发布到 npm 之后 `dsh plugin --profile desktop add dsh-plugin-matlab` 也能直接生效。

### 另一种：直接改 profile 的依赖

```yaml
# profile 的 package.json
"dependencies": { "dsh-plugin-matlab": "file:../../path/to/dsh-matlab" }
```

再 `pnpm install`，效果同上。

## 配置

全部字段都可在 profile 的 `cordis.patch.yml` 中覆盖；带 `volatile` 的字段出现在设置表单里，改完即重连。

```yaml
- id: matlab-agentic
  config:
    matlabRoot: 'C:\Program Files\MATLAB\R2025b'
    skillGroups: [matlab-core, signal-processing]
    sessionMode: auto
```

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `serverName` | `matlab` | 工具前缀，最终形如 `mcp__matlab__evaluate_matlab_code` |
| `toolCallTimeoutMs` | `600000` | 单次 MATLAB 调用上限；仿真/测试套件很慢，故默认 10 分钟 |
| `failOnStartupError` | `false` | 为 `true` 时连接失败会让插件激活失败，而不是仅告警 |
| `matlabRoot` | 自动 | 传给 `--matlab-root`；留空则按 安装器记录 → 环境变量 → PATH → 注册表 → 安装目录 顺序发现 |
| `sessionMode` | `auto` | `auto` 优先接管已 `shareMATLABSession()` 的会话，否则新开；`new` 总是新开；`existing` 只接管 |
| `displayMode` | `desktop` | `nodesktop` 表示不弹 MATLAB 桌面 |
| `initialWorkingFolder` | DSH 工作目录 | MATLAB 启动目录 |
| `initializeMatlabOnStartup` | `false` | 为 `true` 时 MCP 服务一启动就拉起 MATLAB |
| `disableTelemetry` | `false` | 透传 `--disable-telemetry=true` |
| `mcpServerPath` | 自动 | 指定 `matlab-mcp-server` 可执行文件；留空则发现或下载 |
| `autoProvision` | `true` | 缺失时下载二进制、克隆 MATLAB 工具包 checkout |
| `installRoot` | `~/.matlab/agentic-toolkits` | MathWorks 安装器根目录（只读使用） |
| `toolkitRoots` | `[]` | 额外/替代的工具包 checkout；给定时优先 |
| `skillGroups` | `[]`（仅必需组） | 要加载的技能组；留空只加载每个工具包的 `required: true` 组 |
| `extensionFiles` | `[]` | 额外 MCP 工具定义文件（Simulink 工具包的 `tools/tools.json` 会自动带上） |
| `watchSkills` | `true` | 工具包变更时热更新技能目录 |
| `probe` / `probeTimeoutMs` | `true` / `20000` | 连接前做一次 MCP 握手探测 |
| `statusRoute` | `true` | 提供 `GET /plugin/matlab/status` |

## 验证

1. 重启后在对话里问：

   ```
   本机 MATLAB 是什么版本？装了哪些 toolbox？
   ```

   模型应调用 `mcp__matlab__detect_matlab_toolboxes`。

2. 看技能目录是否出现 `matlab-core` 组里的 6 个技能（如 `matlab-create-live-script`）。

3. 直接读连接状态：

   ```bash
   curl http://127.0.0.1:<port>/plugin/matlab/status
   ```

   ```json
   {
     "phase": "ready",
     "installer": { "configFound": true, "matlabRoot": "C:\\Program Files\\MATLAB\\R2023b" },
     "server": { "path": "...\\bin\\matlab-mcp-server.exe", "version": "github.com/matlab/matlab-mcp-server v0.16.0" },
     "probe": { "ok": true, "tools": ["check_matlab_code", "..."], "resources": ["guidelines://coding"] },
     "skills": [{ "name": "matlab-core", "skills": 6 }]
   }
   ```

## 排错

| 现象 | 原因与处理 |
| --- | --- |
| `phase: "tools"` 且日志 `probe failed` | 二进制能启动但握手失败：看 `status.probe.stderr`，多为 MATLAB 许可或 `--matlab-root` 指错 |
| 日志 `matlabRoot does not exist` | `matlabRoot` 指向已卸载版本；清空该字段让其重新发现 |
| 没有 `mcp__matlab__*` 工具 | profile 未组合 `dsh-mcp-client`，或 `serverName` 与他人冲突（同名实例互斥） |
| 技能目录里没有 MATLAB 技能 | 未找到工具包 checkout；执行 `setupAgenticToolkit("install")`，或设 `toolkitRoots` |
| Windows 下 MATLAB 起不来且无日志 | MATLAB 需要 `WINDIR`；插件已显式透传，若仍失败请检查启动器环境 |
| 下载失败（企业代理） | DSH 启动器会把 `HTTPS_PROXY` 应用到 `fetch`；纯 Node 环境下需 `NODE_USE_ENV_PROXY=1`。也可手动下载二进制后设 `mcpServerPath` |
| 安装时 pnpm 提示缺少 peer `@deepseek-ai/*` | 预期行为：这些包由 DSH 运行时的安装范围提供，不需要装进 profile |

## 开发

```bash
pnpm install         # 只为开发：装 @deepseek-ai/cordis，用于激活契约测试
node --test          # 60 个用例；插件本身无构建步骤、无运行时依赖
```

- 纯 ESM，`lib/` 即运行时，无需编译；
- 与 MATLAB 有关的用例是**真机集成**：设置了 `MATLAB_MCP_SERVER`，或 `~/.matlab/agentic-toolkits/bin/` 存在时，真的会拉起 MathWorks 服务做一次 MCP 握手，并逐个校验 158 个 `SKILL.md` 是否符合 DSH 的技能 frontmatter 规则；否则自动跳过；
- `test/cordis-contract.integration.test.js` 用**真实 Cordis** 激活插件（只替换传输层），因为插件 `apply` 的返回值会被 Cordis 当作 effect 校验——这条契约出错时线上表现是 `TypeError: Invalid effect`；
- 目录说明：
  - `lib/activate.js` — 绑定逻辑（发现 → 探测 → 挂载两个传输层）
  - `lib/toolkit.js` + `lib/yaml-mini.js` — 读 MathWorks `manifest.yaml`（技能组、`mcp-server-extensions`）
  - `lib/installer.js` — 读 `config.json`（MATLAB 版本、服务版本）
  - `lib/matlab-root.js` / `lib/mcp-binary.js` / `lib/release.js` — 发现与获取
  - `lib/args.js` — 把设置翻译成 MATLAB MCP Server 官方参数（含 `existing` 模式的互斥规则）
  - `lib/probe.js` — 一次性 stdio MCP 握手

## 许可

插件代码 MIT。MATLAB、Simulink 及相关工具包名称是 The MathWorks, Inc. 的商标；本插件不包含也不重新分发其任何内容，只调用 MathWorks 公开发布的产物。技能与工具的使用受 MathWorks 许可条款约束。
