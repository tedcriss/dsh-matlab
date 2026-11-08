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
| `skillGroups` | `[]`（全部） | 要加载的技能组；留空或 `['*']` 加载全部组（MATLAB 工具包为 24 组 / 158 个技能），列出组名则只加载这些组 |
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

2. 看技能目录：默认全量（MATLAB 工具包 24 组 / 158 个技能），至少应能看到 `matlab-core` 组里的 6 个（如 `matlab-create-live-script`）。

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

## 技能组：默认全部，可按需收窄

技能的**选择单位是“组”**（MathWorks 的 `skills-catalog/<group>`），不是单个文件——这与 MathWorks 给 Amp 的 `amp.skills.path` 完全一致。组名来自工具包的 `manifest.yaml`，也就是 `skills-catalog/` 下的目录名。**默认加载全部组**；想省上下文再按组收窄。

三种写法（都在 profile 的 `cordis.patch.yml` 里覆盖 `matlab-agentic` 这一行）：

```yaml
# 1) 默认：加载全部组（MATLAB 工具包 24 组 / 158 个技能）
- id: matlab-agentic

# 2) 收窄：只加载列出的组
- id: matlab-agentic
  config:
    skillGroups: [matlab-core, signal-processing, wireless-communications]

# 3) 等价的显式全量写法
- id: matlab-agentic
  config:
    skillGroups: ['*']
```

全量的代价：技能目录常驻约 **8,000 tokens**（158 条 name + 描述，按 DSH 的 500 字符截断实测）；只留 `[matlab-core, signal-processing]` 时约 1.6k tokens。技能越多，模型挑错技能的概率也越高，所以按领域收窄是省 token 的做法。

写错组名会**直接激活失败**，并在报错里列出所有可用组名（避免“静默少装”）。改完需要在插件页把该插件关掉再打开（或重启 DSH Desktop）。

### 各组一览（MATLAB 工具包，2026.11.a）

默认全部加载；下表用于**收窄时挑选**。`（必需）` 表示 MathWorks 在 `manifest.yaml` 里标记的 `required` 组。

| 组名 | 技能数 | 典型内容 |
| --- | --- | --- |
| `matlab-core`（必需） | 6 | 写/调试/审阅代码、Live Script、查文档、装产品 |
| `rf-and-mixed-signal` | 21 | 天线、PCB、RF/AMS/SerDes 建模 |
| `automotive` | 13 | RoadRunner 场景、驾驶数据、SUMO 协同仿真 |
| `test-and-measurement` | 13 | DAQ、相机、Arduino、OPC UA、车载网络 |
| `signal-processing` | 12 | 滤波器设计、频谱/时频分析、音频 |
| `matlab-software-development` | 11 | 测试、性能与内存优化、打包 toolbox |
| `wireless-communications` | 11 | 5G/WLAN/BLE/GNSS 波形、USRP |
| `ai-and-statistics` | 10 | 训练网络、曲线拟合、可解释性、嵌入式 AI |
| `image-processing-and-computer-vision` | 10 | 图像/体数据/点云、OCR、视觉检测 |
| `robotics-and-autonomous-systems` | 6 | 运动规划、MAVLink、惯导融合、GNSS |
| `code-generation` | 5 | 生成 C/GPU 代码、定点、部署 |
| `parallel-computing` | 5 | parfor 诊断、集群、GPU、线程池 |
| `computational-finance` | 4 | 组合优化、定价、Datafeed、Excel 链接 |
| `matlab-data-import-and-analysis` | 4 | 导入导出、表格分析、大数据选型 |
| `radar` | 4 | 雷达设计、波形、检测仿真 |
| `reporting-and-database-access` | 4 | 报告生成、Database/DuckDB/Databricks |
| `computational-biology` | 3 | SimBiology 建模/拟合/仿真 |
| `control-systems` | 3 | 系统辨识、旋转机械/电池特征 |
| `math-and-optimization` | 3 | 优化、PDE、符号计算 |
| `matlab-app-building` | 3 | App、图表、主题 |
| `matlab-external-language-interfaces` | 3 | 调 Python/Java、MEX 互操作复数 API |
| `aerospace` | 2 | 坐标转换、大气/环境计算 |
| `cloud-solutions` | 1 | MATLAB Drive 共享 |
| `matlab-programming` | 1 | 函数参数校验 |

Simulink 工具包安装后会出现它自己的组（`model-based-design-core` 等 12 组），同样可以按名字挑选。

### 如果确实要“按单个技能”挑

DSH 的 filesystem provider 以目录为根（`<root>/<name>/SKILL.md`），所以单技能选择的做法是**自建一个裁剪目录**：里面用软链/目录联接指向想要的技能，再让插件把它当作工具包根。

```powershell
# 例：只要 Live Script 和优化这两个技能
$src = "$env:USERPROFILE\.matlab\agentic-toolkits\matlab\skills-catalog"
mkdir C:\matlab-skills\skills-catalog
New-Item -ItemType Junction -Path C:\matlab-skills\skills-catalog\matlab-create-live-script -Target "$src\matlab-core\matlab-create-live-script"
New-Item -ItemType Junction -Path C:\matlab-skills\skills-catalog\matlab-solve-optimization -Target "$src\math-and-optimization\matlab-solve-optimization"
```

```yaml
- id: matlab-agentic
  config:
    toolkitRoots: ['C:\matlab-skills']
    skillGroups: [matlab-create-live-script, matlab-solve-optimization]
```

此时“组名”就是技能名；由于默认就是“加载全部条目”，`skillGroups` 可以留空——裁剪目录本身就是你的选择清单。链接会被正常跟随（已覆盖测试）。

### 确认到底加载了什么

```bash
curl http://127.0.0.1:<port>/plugin/matlab/status
```

`skills` 数组会逐个列出 `{ name, path, skills }`，例如 `{"name":"matlab-core","skills":6}`；全量选择时应为 24 项、合计 158。

## 只用本插件、不跑官方安装器时能得到什么

插件本身就能完成“获取 + 接线”，但官方安装器仍负责三件它不替代的事。实测（全新 `DSH_HOME`、空 install root、无任何 `~/.matlab` 状态）首启耗时 **约 14 秒**：

| 能力 | 只装本插件 | 需要安装器或手动补一步 |
| --- | --- | --- |
| MATLAB MCP Server 二进制 | ✅ 自动下载官方 Release（19.9 MB，实测 v0.16.0） | 离线/内网：手动下载后设 `mcpServerPath` |
| 5 个 MCP 工具 + 2 个 `guidelines://` 资源 | ✅ 探测即通过 | — |
| 技能文件落地 | ✅ `git clone --depth 1` 官方工具包（24 组 / 158 个技能） | 无 `git`：自行 clone 后设 `toolkitRoots` |
| 技能挂载数量 | ✅ 默认全量：24 组 / 158 个（实测） | 想省 token 就列组名收窄，例如 `[matlab-core, signal-processing]` |
| 复用你正在用的 MATLAB 会话（`sessionMode: existing`） | ❌ 需要 MATLAB 侧装 add-on | 跑一次 `<DSH_HOME>/matlab/bin/matlab-mcp-server.exe --setup-matlab --matlab-root=<MATLAB根>`，再在 MATLAB 里 `shareMATLABSession()` |
| Simulink 技能与 `tools/tools.json` 工具扩展 | ❌ 不会自动克隆 Simulink 工具包 | `setupAgenticToolkit("Toolkit","simulink")`，或自行 clone 后设 `toolkitRoots` |
| 记住你在安装器里选的 MATLAB 版本 | ⚠️ 改为 环境变量 → PATH → 注册表 → 最新安装目录 发现 | 多版本共存时显式设 `matlabRoot` |
| 遥测默认关闭 | ❌ 默认仍开启 | `disableTelemetry: true` |
| 二次启动 | ✅ 复用已下载的二进制与 checkout，不再联网（实测 0 次下载） | — |

结论：**MCP 与技能都能完全靠插件跑通，技能默认全量挂载（24 组 / 158 个）**；而“接管当前 MATLAB 会话”和“Simulink”这两条，仍然需要官方安装器或上面那一步手动操作。

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
node --test          # 63 个用例；插件本身无构建步骤、无运行时依赖
```

- 纯 ESM，`lib/` 即运行时，无需编译；
- 四个 `@deepseek-ai/*` 依赖都声明为 **optional peer**：它们由 DSH 安装本身提供，若声明成必需依赖，包管理器会去公共 registry 取（`@deepseek-ai/schemastery` 在 npm 上会连带拉取未发布的 DSH 包而安装失败）；
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
