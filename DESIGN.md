# 设计说明：dsh-plugin-matlab

> 目标一句话：**让 DSH 用上 MATLAB 的能力，同时让 DSH 里不存在第二份 MATLAB 能力。**

本文记录这个插件为什么长成现在这样。实现细节在看代码时才是必要的；这里只保留取舍、边界和对错标准。

---

## 1. 问题与约束

三方各自都已经把该做的事做完了：

| 一方 | 已经提供的东西 |
| --- | --- |
| MathWorks | `matlab-mcp-server`：一个 stdio MCP 服务，负责启动/复用 MATLAB 并暴露 5 个工具与 2 个资源；`matlab-agentic-toolkit`：24 个技能组、158 个 `SKILL.md`，以及声明技能组的 `manifest.yaml` |
| DSH | `@deepseek-ai/dsh-mcp-client`：把任意 MCP 服务的工具注册进 `ctx.tools`，命名 `mcp__<server>__<tool>`；`@deepseek-ai/dsh-skill-filesystem`：扫描若干目录，把 `<root>/<skill>/SKILL.md` 变成会话技能目录 |
| 用户 | 一个已安装的 MATLAB、一个可能已经由官方安装器装好的工具包与二进制 |

所以缺口不是“能力”，而是**接线**：

1. DSH 的 MCP 桥需要一个具体的 `command` / `args`，这些值取决于本机 MATLAB 装在哪、会话怎么连；
2. DSH 的技能提供方需要具体的目录列表，这些目录取决于工具包装在哪、用户要哪几组；
3. 失败要能被解释，而不是“工具没出现”。

设计约束由此确定：

- **不重写协议、不包装工具**：任何“自己实现一个 `evaluate_matlab_code`”的方案都等于制造第二份真相，版本、参数、行为都会漂移；
- **不复制内容**：技能文件一旦被拷贝进插件，MathWorks 更新就与用户脱节；参考路径才是可持续的；
- **不改写 MathWorks 的安装**：`setupAgenticToolkit` 是官方安装权威，插件只读它的产物；
- **失败要说清原因**：连接类插件的价值一半在于诊断。

## 2. 核心设计：三件事，两份配置

插件只做 **发现（discover）→ 校验（probe）→ 挂载（mount）**，最终产出两份配置交给 DSH 现有的两个插件：

```
                        ┌─────────────────────────────────────────────┐
  安装器 config.json ─┐  │ matlab-agentic（本插件）                     │
  注册表 / PATH      ├─▶│  discover matlabRoot + binary + toolkit      │
  环境变量            │  │  probe: 一次 stdio MCP 握手                   │
                     │  │  build args: 翻译成 MATLAB 官方 CLI           │
  manifest.yaml ─────┘  └───────────────┬─────────────────────────────┘
                                        │ ctx.plugin(child, config)
                    ┌───────────────────┴────────────────────┐
                    ▼                                        ▼
   dsh-skill-filesystem                           dsh-mcp-client
   providerName: 'matlab'                         transport: 'stdio'
   includeDefaultRoots: false                     command: <binary>
   customSkillDirs: [<group1>, <group2>…]         args: [--matlab-session-mode=…, --matlab-root=…, …]
```

两个挂载点都是**现成的 DSH 官方插件**，因此：

- 工具的命名、超时、重连、错误映射、图片结果处理全部沿用 `dsh-mcp-client` 的既有语义（包括“同名 server 互斥”“启动失败保留上一代工具集”等）；
- 技能的发现、frontmatter 解析、按需加载正文、热更新全部沿用 `dsh-skill-filesystem` 的既有语义；
- 本插件被卸载/热替换时，两个子插件随 Cordis fiber 一起销毁，不留下半挂载状态。

### 为什么技能用 `customSkillDirs` 而不是拷贝或软链

MathWorks 给 Amp 的做法就是“把 `skills-catalog/<group>` 逐个加到 `amp.skills.path`”；DSH 的 `customSkillDirs` 是同一个概念。于是：

- 一组技能 = 一个根目录，`<root>/<skill>/SKILL.md` 正好是 DSH 的目录包形态，无需转换；
- `includeDefaultRoots: false` 让这个 provider **只**拥有 MATLAB 技能，项目技能与用户技能仍由 profile 里原有的 filesystem provider 负责，优先级（100/200 项目 → 300 自定义）不变；
- `watch: true` 让 `setupAgenticToolkit("update")` 之后的更新自动进入下一次技能目录。

### 为什么是“每组一个根”而不是“整个 skills-catalog 一个根”

DSH 的 filesystem provider 只扫描一层（`<root>/<name>/SKILL.md`），而 MathWorks 的目录是两层（`skills-catalog/<group>/<skill>/SKILL.md`）。把组目录作为根，既满足 DSH 的一层扫描，又保持了 MathWorks 的分组语义——**分组是用户按需加载的单位**，MathWorks 明确建议只装需要的组，否则技能触发准确率下降。

## 3. 连接性职责的边界

明确列出“插件应该管”和“插件不应该管”，是实现不再膨胀的关键。

| 属于插件 | 理由 |
| --- | --- |
| 发现 MATLAB 安装位置 | 没有别人能做：MCP 服务只接受一个 `--matlab-root` |
| 发现/获取 `matlab-mcp-server` 二进制 | 同上；且要能复用官方安装器放好的那一份 |
| 发现工具包 checkout、读 `manifest.yaml` | 组名、必需组、扩展工具文件都是 MathWorks 的数据，必须读而不是硬编码 |
| 把设置翻译成 MATLAB 官方 CLI 并守规则 | 例如 `--matlab-session-mode=existing` 不能与 `--matlab-root` 同时出现 |
| 一次 MCP 握手探测 | 把“工具没出现”变成“服务能起但 initialize 被拒” |
| 提供状态与日志 | 连接类插件的可运维性 |
| 给不可用的 OS 临时目录兜底 `--log-folder` | 实测：某些 Windows 上服务默认日志目录创建失败，服务直接退出 |

| 不属于插件 | 理由 / 替代 |
| --- | --- |
| 运行 MATLAB 代码、解析代码、跑测试 | 这是 `matlab-mcp-server` 的职责 |
| 打包/复制 `SKILL.md` | 参考 MathWorks 的 checkout，保持原件 |
| 改写 `~/.matlab/agentic-toolkits` 或 `setupAgenticToolkit` 的状态 | 官方安装器是权威；插件只读 |
| 自己实现 MATLAB 工具（哪怕“更方便”） | 会出现第二份语义 |
| 管理 MATLAB 许可证、启动 MATLAB 桌面 | 属于 MATLAB 自身与 MCP 服务 |
| 覆盖其他插件的技能根或工具名 | 技能限 `matlab-core` 等组；工具限 `mcp__matlab__*` |

## 4. 关键决策与理由

### 4.1 复用 DSH 的 MCP 桥，而不是自己开一条连接

`dsh-mcp-client` 已经把协议版本协商、工具集原子换代、重连退避、调用取消、图片结果落盘、超时等等都实现并测试过。插件里若直接 `@modelcontextprotocol/client` 自建连接，就等于把这些语义复制一份并独立演化。**代价**是插件依赖该官方包的存在与版本（见 §6 兼容性），**收益**是所有行为与 profile 中其他 MCP 服务保持一致。

### 4.2 用 `ctx.plugin()` 挂子插件，而不是往 `cordis.patch.yml` 里写死静态配置

静态 YAML 无法表达“本机 MATLAB 装在哪”。DSH 的 loader 支持 `!!js` 表达式，但把发现逻辑写进 YAML 会让它无法测试、无法诊断、也无法在 Windows 注册表里查。所以配置在 `apply()` 里计算，再以子插件形式挂载；这同时获得与 HMR、fiber 销毁、服务注入的一致性。

### 4.3 默认只加载 `required: true` 技能组

官方安装器默认勾选全部 24 组（用户可改）。把 158 个技能的目录一次性塞进上下文，会显著增加每次请求的 token 并降低技能触发准确率——MathWorks 自己在文档里反复提醒“只装需要的”。所以插件默认取 `matlab-core`（每组 `required: true`），其余组由用户显式列出；`skillGroups: ['*']` 是“我就要全部”的显式逃生口，不改变默认值。这是“尊重厂商建议”而不是“尊重厂商默认勾选”。

如果本机没有跑过官方安装器，插件自己会 `git clone --depth 1` 拿到完整工具包（24 组 / 158 技能），所以“技能文件缺失”不会发生；差异只在**默认挂载多少**。

选择单位是“组”，因为 MathWorks 的布局是 `skills-catalog/<group>/<skill>/SKILL.md`，而 DSH 的 provider 以目录为根——只有把组目录当根才能同时满足两者，也正好保留了“组”这个厂商给出的按需加载单位。细到单个技能时，插件支持自建裁剪目录（`skills-catalog/<技能名>` 用软链指向真实技能），此时技能名就是组名；读取器必须跟随符号链接与目录联接，否则 Windows 的 junction 会被 `Dirent.isDirectory()` 判为 false 而静默丢弃。真正需要安装器或一步手动操作才能得到的能力有三项：`sessionMode: existing` 所需的 MATLAB add-on（`matlab-mcp-server --setup-matlab`）、Simulink 工具包，以及安装器记录下来的 MATLAB 版本偏好。

### 4.4 读安装器 `config.json`，作为 MATLAB 版本的首选事实来源

`config.json` 里的 `matlab.root` 是用户在 MATLAB 里主动选的版本，比 `PATH` 里可能存在的旧版本更可信。因此优先序是：显式配置 → 环境变量 → 安装器记录 → `PATH` → Windows 注册表 → 平台安装目录（取最新版本）。安装器记录的 `mcpServerVersion` 也用于状态展示，便于发现“二进制与安装记录不一致”。

### 4.5 插件数据目录作为默认日志目录

实测在 Windows 上，服务默认在 `%TEMP%` 下创建日志子目录会失败并直接退出（`Failed to create subdirectory in "…\Temp"`），即使该目录对当前用户可写。`--log-folder` 指向插件数据目录（`$DSH_HOME/matlab/logs`）即可正常工作。这是一个纯粹的连接性修复，也顺带让 MATLAB 日志可发现。

### 4.6 探测用一次独立进程，而不是复用 MCP 桥的状态

探测的语义是“这个命令 + 这些参数能不能完成 initialize，并暴露出哪些工具”。它不启动 MATLAB（`initialize-matlab-on-startup` 默认 false），耗时约 0.2–1 秒，失败时能给出 stderr 尾部。即使探测失败，默认仍会挂载 MCP 桥（`failOnStartupError: false`），让“能连但探测协议不兼容”不阻断使用；要严格失败则打开该开关。

### 4.7 缺失时自动准备，但只在必要时

`autoProvision: true` 时：二进制缺失 → 从 GitHub Release 下载（先试现名 `matlab-mcp-server-<os>-<arch>`，再试旧名 `matlab-mcp-core-server-<matlabarch>`）；工具包缺失 → `git clone --depth 1` 到插件数据目录（`HTTPS_PROXY` 会翻译成 `git -c http.proxy`）。已存在任何官方产物时绝不下载，避免留下第二份、可能过期的副本。

### 4.8 不做设置页面

插件声明了 schemastery `Config`，其中用户会反复调整的字段标了 `.volatile()`，因此可以直接通过 profile 的 `cordis.patch.yml` 或设置表单修改。自带一个前端页面的收益（一次性配置）低于成本（client bundle、i18n、slot 兼容），且会让插件在“只做连接性”的重心上偏航。诊断信息通过 `/plugin/matlab/status` 提供。

### 4.9 `apply` 必须 resolve 为 `undefined`（真实事故）

首版 `apply` 把状态对象 `return` 了出去，线上表现是：

```
matlab-agentic: connected; tools appear as mcp__matlab__<tool>
[error] TypeError: Invalid effect            ← Fiber._reload
[error] mcp-client(matlab): tool registration failed ... cannot create effect on inactive context
```

Cordis 的 `Fiber._execute` 会校验插件激活的**返回值**：函数算 disposer、null/undefined 算无副作用、thenable 会继续等待、可迭代对象逐个收集 disposer，**其余一律 `TypeError: Invalid effect`** 并卸载该 fiber。插件“连接成功”之后再抛错，子插件随之失去活跃上下文，工具一个都没注册上。

因此契约是：**`apply` 只做副作用，不返回值**。诊断状态由内部 `activate()` 返回（供测试与状态路由使用），`apply` 丢弃它。这条约束已由 `test/cordis-contract.integration.test.js` 用真实 Cordis 覆盖，并保留了一个反向对照用例（返回值的插件必须被 `Invalid effect` 拒绝），防止测试本身失真。

## 5. 失败模式

每条失败都有确定的归属和可读的后果：

| 失败点 | 行为 | 用户看到 |
| --- | --- | --- |
| 找不到工具包 | `autoProvision` 为真则克隆，否则告警继续 | 日志 + `status.toolkit: []`；工具仍可用 |
| `skillGroups` 里有未知组 | **激活失败**（配置错误自包含，尽早失败） | 报错里列出所有可用组名 |
| 找不到 MATLAB | 告警继续，让 MCP 服务自己报错 | `status.matlab: undefined` + 服务 stderr |
| 二进制缺失且无法下载 | **激活失败**，报错给出三条可行建议 | 明确的下一步 |
| 探测失败 | 告警；`failOnStartupError` 为真则失败 | `status.probe.error` + stderr |
| MCP 桥连接失败 | 记录 `phase: "failed"` 与原因；不中断 profile | 错误日志 + 状态路由 |
| 技能注册服务不存在 | 告警跳过技能，工具照常 | 日志说明 profile 未加载 skills |
| `apply` 返回了非 `undefined` 值 | **fiber 卸载**，`TypeError: Invalid effect` | 见 §4.9；已修复并有回归测试 |

“配置错误立刻失败、运行时依赖缺失降级继续”这条线是刻意划的：前者用户能立刻修，后者可能只是暂时没装。

## 6. 兼容性与版本

- 插件对 DSH 侧只依赖两个公开包：`@deepseek-ai/dsh-mcp-client` 的 `StdioConfig`（`transport/serverName/command/args/env/cwd/toolCallTimeoutMs/failOnStartupError`）与 `@deepseek-ai/dsh-skill-filesystem` 的 `Config`（`providerName/includeDefaultRoots/customSkillDirs/watch`）。二者都是稳定文档化字段；
- `peerDependencies` 用 `*`：真实的解析由 DSH 运行时的安装范围（installation scope）提供，写死小版本反而会在 DSH 升级时阻止加载；
- MATLAB 侧只依赖**文档化的 CLI 与文件格式**：`--matlab-*` 参数、`bin/` 布局、`config.json`、`manifest.yaml` 的 `skill-groups` / `mcp-server-extensions`、`skills-catalog/<group>/<skill>/SKILL.md`。这些是 MathWorks 公开契约，插件不含版本号判断，因此新版工具包无需改插件；
- `manifest.yaml` 的解析是**目标式**的：只抽两个 section，读不懂就回退到扫描 `skills-catalog/` 目录，永远不因为格式演进把技能丢掉。

## 7. 安全

- 子进程只用 argv 传递参数，不拼接 shell 字符串；`shell: false`；
- 下载只从 MathWorks 的 GitHub Release，校验体积下限，先写临时文件再原子改名并置可执行位；
- 不读取、不写入 MATLAB 许可证或凭据；`dsh-mcp-client` 默认会清理名字含 `KEY/PASSWORD/SECRET/TOKEN` 的环境变量，插件只补充 `WINDIR`（Windows 上 MATLAB 必需）；
- 状态路由只读、无副作用，且仅在 profile 里有 `ctx.webServer` 时注册；
- 工具调用本身的高风险（执行任意 MATLAB 代码）由 DSH 既有的权限与审批机制在 `tools/pre-execute` 上治理，插件不另开审批通道，也不弱化它。

## 8. 验证标准

设计是否成立，用这几条判定（均已在本机实测通过）：

1. **真机握手**：用 MathWorks 安装器装好的 `matlab-mcp-server.exe` v0.16.0，探测返回 5 个工具、2 个资源、协议 `2025-06-18`；
2. **真机发现**：从 `~/.matlab/agentic-toolkits/config.json` 取到 `R2023b`，从同目录取到二进制与含 24 组的工具包 checkout；
3. **绑定正确**：默认选中 `matlab-core`（6 个技能），技能根为该组目录；MCP 参数含 `--matlab-session-mode=auto --matlab-root=… --matlab-display-mode=desktop --log-folder=…`；
4. **规则正确**：`existing` 模式自动丢弃 `--matlab-root` / `--matlab-display-mode` / `--initial-working-folder` 并给出警告；
5. **失败可读**：未知技能组、缺失二进制、探测失败、桥连接失败各自有不同的、可操作的报告；
6. **技能格式兼容**：158 个 `SKILL.md` 的 `name` 全为 kebab-case 且与目录同名、`description` 齐全——这很关键，因为 DSH 的 filesystem provider 对不合格技能是**静默丢弃**，不会告诉模型“这个技能坏了”；
7. **配置契约**：用真实 schemastery 校验 `Config` 的默认值、枚举与类型拒绝路径；并验证 `.volatile()` 字段经 `resolveOptions` 解包后能取到用户设置（否则设置会被静默忽略）。

## 9. 已知限制与后续方向

- **Workspace 级隔离**：目前是 profile 级单例（`serverName: matlab`）。若将来 DSK 支持按 Agent/workspace 覆写插件配置，同一 profile 里跑两个独立 MATLAB 会话才可实现（`dsh-mcp-client` 本身支持按 scope 复用命名空间）。
- **不使用 MCP 资源注入**：`guidelines://coding` 等资源已可被模型通过 MCP 资源工具按需读取，但不会自动进入系统提示。自动注入属于 DSH 的资源策略问题，不在这里私开通道。
- **不管理 MATLAB 安装本身**：`matlab-install-products` 技能可以让 Agent 参与安装，但安装过程仍归 MATLAB。
- **Simulink 只是顺带支持**：检测到 Simulink 工具包时会加载其技能组与 `tools/tools.json` 扩展；未做针对 Simulink 的专门验证（本机未安装 Simulink）。
- **代理**：下载走 DSH 启动器安装的全局 dispatcher（`HTTPS_PROXY` 生效）；`git clone` 单独翻译代理。若在没有 DSH 启动器的环境里直接 `node` 调用下载函数，需要 `NODE_USE_ENV_PROXY=1`。
