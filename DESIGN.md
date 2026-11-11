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
| 用户 | 一个已安装的 MATLAB；依赖由插件自己装在 `$DSH_HOME/matlab` |

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
  插件数据目录 ───────┐  │ matlab-agentic（本插件）                     │
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
| 发现/获取 `matlab-mcp-server` 二进制 | 同上；只认插件自己的副本，不在外部目录里找 |
| 发现工具包 checkout、读 `manifest.yaml` | 组名、必需组、扩展工具文件都是 MathWorks 的数据，必须读而不是硬编码 |
| 把设置翻译成 MATLAB 官方 CLI 并守规则 | 例如 `--matlab-session-mode=existing` 不能与 `--matlab-root` 同时出现 |
| 一次 MCP 握手探测 | 把“工具没出现”变成“服务能起但 initialize 被拒” |
| 提供状态与日志 | 连接类插件的可运维性 |
| 给不可用的 OS 临时目录兜底 `--log-folder` | 实测：某些 Windows 上服务默认日志目录创建失败，服务直接退出 |

| 不属于插件 | 理由 / 替代 |
| --- | --- |
| 运行 MATLAB 代码、解析代码、跑测试 | 这是 `matlab-mcp-server` 的职责 |
| 打包/复制 `SKILL.md` | 参考 MathWorks 的 checkout，保持原件 |
| 读取 `~/.matlab/agentic-toolkits` 或任何外部安装副本 | 依赖只属于插件；外部副本会制造第二份、版本可能不同的事实 |
| 自己实现 MATLAB 工具（哪怕“更方便”） | 会出现第二份语义 |
| 管理 MATLAB 许可证、启动 MATLAB 桌面 | 属于 MATLAB 自身与 MCP 服务 |
| 覆盖其他插件的技能根或工具名 | 技能限 `matlab-core` 等组；工具限 `mcp__matlab__*` |

## 4. 关键决策与理由

### 4.1 复用 DSH 的 MCP 桥，而不是自己开一条连接

`dsh-mcp-client` 已经把协议版本协商、工具集原子换代、重连退避、调用取消、图片结果落盘、超时等等都实现并测试过。插件里若直接 `@modelcontextprotocol/client` 自建连接，就等于把这些语义复制一份并独立演化。**代价**是插件依赖该官方包的存在与版本（见 §6 兼容性），**收益**是所有行为与 profile 中其他 MCP 服务保持一致。

### 4.2 用 `ctx.plugin()` 挂子插件，而不是往 `cordis.patch.yml` 里写死静态配置

静态 YAML 无法表达“本机 MATLAB 装在哪”。DSH 的 loader 支持 `!!js` 表达式，但把发现逻辑写进 YAML 会让它无法测试、无法诊断、也无法在 Windows 注册表里查。所以配置在 `apply()` 里计算，再以子插件形式挂载；这同时获得与 HMR、fiber 销毁、服务注入的一致性。

### 4.3 默认加载全部技能组，收窄是显式选择

默认值取“全部组”（`skillGroups: []` 或 `['*']`）而不是厂商的 `required` 标记：用户要的是“装上就能用全部 MATLAB 知识”，而不是先读文档才知道要开哪些组。MathWorks 安装器本身也默认勾选全部 24 组，这个默认与厂商的默认行为一致。

代价是明确的、可量化的：158 条目录项常驻约 **8,000 tokens**（按 DSH 的 500 字符描述截断实测），而只留 `matlab-core` 约 575 tokens；技能越多，触发准确率也会下降——MathWorks 自己的建议是“只装需要的”。因此把收窄做成一行配置，并在 README 的表里给出各组的技能数与 token 量级，让用户在“全量便利”和“上下文成本”之间自己选：

```yaml
- id: matlab-agentic
  config:
    skillGroups: [matlab-core, signal-processing]
```

`required` 标记现在有两层含义：默认选择仍是全部；用户收窄时，必需组却是**不能排除**的。页面把必需组的勾选框锁定为已选且禁用，“全不选”也保留它们；Host 侧的 `selectSkillGroups` 会在保存的名单缺少必需组时补回，并且按工具包顺序输出。这样厂商“每个用户都需要”的声明不会被一份旧名单或页面 bug 绕过。

插件会自己安装官方工具包的最新 Release（当前为 `MATK-2026.11.a`，24 组 / 158 技能），所以“技能文件缺失”不会发生；差异只在挂载多少。

选择单位是“组”，因为 MathWorks 的布局是 `skills-catalog/<group>/<skill>/SKILL.md`，而 DSH 的 provider 以目录为根——只有把组目录当根才能同时满足两者，也正好保留了“组”这个厂商给出的按需加载单位。细到单个技能时，插件支持自建裁剪目录（`skills-catalog/<技能名>` 用软链指向真实技能），此时技能名就是组名；读取器必须跟随符号链接与目录联接，否则 Windows 的 junction 会被 `Dirent.isDirectory()` 判为 false 而静默丢弃。真正需要额外一步才能得到的能力有两项：`sessionMode: existing` 所需的 MATLAB add-on（`matlab-mcp-server --setup-matlab`）与 Simulink 工具包（自行解压后设 `toolkitRoots`）。

### 4.4 依赖只从插件数据目录来

`$DSH_HOME/matlab` 是依赖的唯一位置：`bin/` 放 MCP Server，`toolkits/` 放解压出来的工具包（带一个记录 Release Tag 的 `.dsh-matlab-release.json`），`logs/` 放服务日志。插件**不读取** `~/.matlab/agentic-toolkits`（MathWorks 安装器的目录），也不读它的 `config.json`——那份记录里的 `matlab.root` 曾经是 MATLAB 版本的首选提示，但它同时让“二进制与工具包从哪来”有了两个答案，版本一旦不同就会出现“DSH 里跑的到底是哪一份”。MATLAB 自身的发现顺序因此收敛为：显式配置 → 环境变量 → `PATH` → Windows 注册表 → 平台安装目录（取最新版本）。

代价是用户不能再指望安装器替 DSH 准备依赖；回报是“缺了就下载、要更新就更新”只有一个答案，而且删掉 `$DSH_HOME/matlab` 就能干净地重来。显式的 `mcpServerPath` / `toolkitRoots` 仍是用户自己的选择，不算自动发现。

### 4.5 插件数据目录作为默认日志目录

实测在 Windows 上，服务默认在 `%TEMP%` 下创建日志子目录会失败并直接退出（`Failed to create subdirectory in "…\Temp"`），即使该目录对当前用户可写。`--log-folder` 指向插件数据目录（`$DSH_HOME/matlab/logs`）即可正常工作。这是一个纯粹的连接性修复，也顺带让 MATLAB 日志可发现。

### 4.6 探测用一次独立进程，而不是复用 MCP 桥的状态

探测的语义是“这个命令 + 这些参数能不能完成 initialize，并暴露出哪些工具”。它不启动 MATLAB（`initialize-matlab-on-startup` 默认 false），耗时约 0.2–1 秒，失败时能给出 stderr 尾部。即使探测失败，默认仍会挂载 MCP 桥（`failOnStartupError: false`），让“能连但探测协议不兼容”不阻断使用；要严格失败则打开该开关。

### 4.7 缺失时自动准备，但绝不占用启动

`autoProvision: true` 时：二进制缺失 → 从 GitHub Release 下载（先试现名 `matlab-mcp-server-<os>-<arch>`，再试旧名 `matlab-mcp-core-server-<matlabarch>`）；工具包缺失 → 下载它最新 Release 的源码包（`archive/refs/tags/<tag>.tar.gz`，3.4 MB）并解压到插件数据目录。已存在任何官方产物时绝不下载，避免留下第二份、可能过期的副本。

**工具包为什么是 Release 源码包而不是仓库**：MathWorks 的 Release 页面本身不带资产，可下载内容就是 GitHub 为该 tag 生成的源码包。拉这个包是**一次 HTTP 响应**，而 `git clone` 要几百次往返、几个包体，还要本机有 `git`；同一台机器实测 3.36 MB 的包经 `gh-proxy.com` 2.4 秒装完（1433 个文件），克隆要 46 秒。更关键的是语义：发布包对应一个**官方 Tag**，所以“本地是什么版本”有确切答案，而不是“当时 `main` 是什么”。解压器只依赖 `node:zlib`，支持 ustar/pax 长路径、只接受落在目标目录内的路径，符号链接只在指向目录内部时才重建。

关键在于这两件事**不在激活路径上等**。DSH Desktop 会在宿主机 60 秒内没有启动完成时直接判失败（`Host startup exceeded 60 seconds`，见 2.0.22-next 的 `desktop-runtime`），而首次获取是 19.9 MB 下载加 3.4 MB 工具包——加速后仍可能合计 1～2 分钟（本机实测二进制 52 秒）。因此激活只做本地发现：已有产物就地挂载（毫秒级），缺失的那一半记进 `plan`，交由后台任务 `provision()` 完成后再挂载，`status.phase` 在期间为 `provisioning`。`provisionWaitMs`（默认 0）允许 profile 选择“最多等这么久”，但默认不赌网络。

代价说清楚：首次启动后的头一两分钟里，模型还看不到 MATLAB 工具与技能（日志与状态路由会明说“正在后台获取”），第二次启动则完全不再联网。这个取舍是正确的，因为另一种结果——宿主机起不来——连“稍后可用”都换不到。

### 4.8 配置先生成表单，再补一页专用设置页

插件声明了 schemastery `Config`，其中用户会反复调整的字段标了 `.volatile()`，因此可以直接通过 profile 的 `cordis.patch.yml` 或 DSH 自带的配置表单修改；诊断信息通过 `/plugin/matlab/status` 提供。这一层永远够用，也是任何 profile 的最小可用面。

在此基础上才有的“设置 → MATLAB”一页（§4.11）是**可选的表现层**：它只读取同一份配置与状态，写入也走 DSH 的 `settings.update`，所以页面消失（宿主没有 `settings` 服务、客户端 bundle 未加载）不会让配置失去写法。反过来，只有当页面能证明自己“只是另一种写法”时才值得存在——技能组有 24 个、依赖要看两侧 Tag 并做下载/清空，这两件事在表单里确实难读，页面才有理由。

### 4.9 `apply` 必须 resolve 为 `undefined`（真实事故）

首版 `apply` 把状态对象 `return` 了出去，线上表现是：

```
matlab-agentic: connected; tools appear as mcp__matlab__<tool>
[error] TypeError: Invalid effect            ← Fiber._reload
[error] mcp-client(matlab): tool registration failed ... cannot create effect on inactive context
```

Cordis 的 `Fiber._execute` 会校验插件激活的**返回值**：函数算 disposer、null/undefined 算无副作用、thenable 会继续等待、可迭代对象逐个收集 disposer，**其余一律 `TypeError: Invalid effect`** 并卸载该 fiber。插件“连接成功”之后再抛错，子插件随之失去活跃上下文，工具一个都没注册上。

因此契约是：**`apply` 只做副作用，不返回值**。诊断状态由内部 `activate()` 返回（供测试与状态路由使用），`apply` 丢弃它。这条约束已由 `test/cordis-contract.integration.test.js` 用真实 Cordis 覆盖，并保留了一个反向对照用例（返回值的插件必须被 `Invalid effect` 拒绝），防止测试本身失真。

### 4.10 沿用 DSH 的 GitHub 加速，且首次获取不阻塞启动

首版把“下载慢”当成网络环境问题推给用户（README 只写“设 `HTTPS_PROXY`”），结果是在中国大陆的机器上，首次启动要在 DSH 启动路径里直连 GitHub 下载 19.9 MB 的二进制。实测（2026-11-10，同一分钟）：**直连 7 KB/s，经 DSH 市场用的公共前缀 250 KB/s**，直连需要几十分钟——这一次的直接后果有日志为证：

```text
14:45:24.798 matlab-agentic: cloning https://github.com/matlab/matlab-agentic-toolkit.git
14:46:22.286 [desktop] host.start.failed durationMs 60019 {"message":"Host startup exceeded 60 seconds"}
```

所以这里有两件事，缺一不可：

1. **走 DSH 已经选好的加速线路**（快）；
2. **首次获取放到后台**（不占启动）——因为加速也保证不了 60 秒内完成，实测加速后二进制仍需 52 秒。

“给插件加一个代理服务器”是能工作的方案，但它会引入第二个事实来源：DSH 已经在**设置 → 插件 → 插件配置 → GitHub 加速**里管理区域、自定义前缀与回退顺序（`dshmarket` 的 `lib/regions.js`），运维还能用 `DSHM_GITHUB_PROXY` 覆盖。插件若自己存一份代理地址，用户就得在两处保持一致，而任何一处失效都会变成“插件坏了”。所以这里**不新增代理，只消费 DSH 已经做出的决定**，优先级从最具体到最一般：

1. 本插件的 `githubProxy`（profile 里能直接写，纯 CLI 或没有市场的 profile 也有说法）；
2. `DSHM_GITHUB_PROXY`（运维的环境覆盖，与 DSH 市场同名的变量）；
3. `<profile>/.dsh-market/state.json` 的 `githubProxy` 与 `region`——即市场设置里那份；profile 目录取自 `profileContext`（市场读的是同一个服务），其次 `DSH_PROFILE_DIR`/`DSH_PROFILE`，最后扫 `profiles/` 下最新的市场状态；
4. 区域缺省 `global`，也就是直连。

`githubProxy` 只接受 `https://` 前缀、不含凭据、查询串与锚点：下载下来的是随后要执行的程序，明文线路等于允许中间人替换它。环境变量里给错值时只告警并忽略（那是运维的设置）；配置里给错值则激活失败，并给出可用的写法——遵循 §5 的“配置错误立刻失败，运行时依赖缺失降级继续”。

线路的用法与公共反代一致：完整目标 URL 作为路径（`{prefix}/{url}`）。二进制的下载与工具包的发布包共享一张表，顺序是**加速线路在前、直连收尾**。这里与 DSH 市场的 git 线路（直连在前）刻意不同：市场只用 git 线路读 ref 广告；这里搬的是几 MB 的包体，慢的正是这一段；直连保底仍在，镜像整体失效时退化为“慢”而不是“启动不了”。

有界同样重要：`provisionTimeoutMs`（默认 300 秒）是单次首次准备的总预算，每条线路再加“无响应头 20 秒 / 无数据 30 秒即中止”的看门狗。这样一条死线路最多花掉几十秒；全部线路失败时后台任务把失败写进 `status.error` 与日志，下一次启动重新发现、重新尝试，而不是把启动挂住。

成功路径用实测确认过（同一台中国网络机器、全新 `DSH_HOME`、空安装根）：激活 **0.10 秒**返回 `phase: provisioning`；后台 `github: gh-proxy.com -> ghfast.top -> direct (region china)`，工具包的 `MATK-2026.11.a` 源码包（3,359,163 字节 / 1433 个文件）经 `gh-proxy.com` 下载解压后挂上 24 组 / 158 个技能（本机单测实跑 2.4 秒），二进制 19,905,376 字节经 `gh-proxy.com` 装好（`--version` 为 `v0.16.0`），真实 MCP 握手探测到 5 个工具 / 2 个资源，`phase: ready`。状态路由同时给出 `github.{region,proxy,routes,source}`、`server.route` 与 `toolkitRelease.tag`，所以“它到底走了哪条线路、本地是哪一版”不需要靠猜。

### 4.11 设置页与进度对话框：配置交回 DSH，界面只占槽位

**配置仍然只有一份。** 页面不写自己的 JSON：它把字段补丁 POST 给 `lib/api.js`，后者调用 `settings.update(profileEntryId, patch, revision)`——DSH 校验 schema、写 profile 补丁、再 reconcile Loader。因此页面能改的字段恰好是 schema 里 `.volatile()` 的那些（`settings.update` 拒绝非 volatile 字段，页面拿到 400），而 `cordis.patch.yml` 与页面互为两种写法；`revision` 用来发现“另一个窗口先改了”（409，页面重新载入）。全选技能组时写 `skillGroups: []`（=全部），厂商以后新增的组会自动纳入，不会因为页面存过一份旧名单而漏掉。

**写路由必须是 `handler`，不能是 `resource`。** DSH 的 web carrier 把 `resource` 定义成 Fetch `Request → Response` 的只读形状，只放行 `GET`/`HEAD`；其它方法在函数运行前就被框架回 405（`Allow: GET, HEAD`）。首版把 `/config`、`/provision`、`/update` 也注册成 resource，于是页面上的保存、检查更新、安装依赖全部收到 405，而读状态却正常——这正是 1.0.1 修的回归。现在读路由仍是 resource，三个写路由改用 `handler(req, res)`：自己读有上限的 JSON body、校验 `content-type: application/json` 与同源 `Origin`，并用 JSON 回应每个结果（包括后台任务抛出的失败）。`test/api.test.js` 用一个复刻 carrier 方法规则的本地 HTTP server 覆盖这条边界，避免下次再靠“单元测试直接调 resource”把回归放过去。

**改完立刻生效，靠的是 Cordis 的 volatile 语义。** volatile 变更不重启插件，只把新值提交进运行中的引用并发 `loader/volatile-update`。插件监听该事件（120 ms 合并一次），dispose 掉两个子插件（技能目录、MCP 桥）再按新值重挂：技能组变 → 只换 `customSkillDirs`；MATLAB 参数、命名空间、超时变 → 重建 MCP 桥。重挂时还会重新解析 MATLAB 根与 GitHub 加速线路：前者决定新桥启动哪个 MATLAB，后者决定下一次下载走哪条线路；若沿用激活时的旧值，页面改了 `matlabRoot` / `githubProxy` 也要等重启才生效。不联网、不重启，日志一行 `settings applied`。若后台正在取依赖，重挂排队到取完（`remountRequested`）。

**进度对话框只是一个槽位。** `shell.overlay` 是框架级浮动层（本身可点击穿透，占用者自己决定 pointer-events），正好放右下角提示；`settings.section` 是“设置里一页”的席位。两个注册都不替换宿主 UI：`id` 用自己的，`order` 只决定排序。组件是手写 React（`client/client.js`），只用 `--dsw-alias-*` 主题变量、不 import 任何客户端基础库——DSH 自己的插件文档说得很直白：基础库 API 会变，一个抛错组件会把整个槽位条目打空。

**“安装完成钩子”在这套框架里不存在。** 插件只有在第一次被 Loader 加载之后才有代码在跑；`pnpm add` 阶段没有任何监听者能接“装好了”。所以“装完就下”落到“首次激活就开始下”：激活只做本地发现（毫秒级），缺的那一半交给后台并立刻开始报进度，界面弹出对话框，宿主 60 秒上限不受影响。`provisionWaitMs` 留给愿意等的 profile。

**数据流很短。** 页面只读 `/plugin/matlab/{state,progress}`、只写 `/plugin/matlab/{config,provision,update,dependencies}` 六个同源 JSON 路由；没有 iframe、没有第二套 HTML、没有第二份校验。`phase/progress/groups/config` 就是插件内部那份真相的投影。

**空框要说清楚"留空会发生什么"。** `matlabRoot` 与 `mcpServerPath` 本来就能自动发现，页面又把发现结果当作空框的占位提示显示出来——用户看到的就是"留空会用这个"，而不是一个凭空的例子；发现不到时才退回示例路径。来自配置的值不算"发现"（`source === 'config'` 时不显示），否则用户刚清空自己的值就会看到它冒充自动发现结果。其余字段（起始目录、命名空间、超时、加速前缀等）放示例值；三处短枚举（启动方式、会话模式、下载区域）用单行单选，所有选项可见，不用先点开才知道有什么。

### 4.12 依赖：本地检查 + 在线检查 + 三个动作

依赖装好之后不会自己变新，而“每次启动都检查”又会把网络探测塞回启动路径。所以只有**本地检查**是自动的：进入设置页读的就是激活时已经解析好的状态，不额外联网。对官方的检查是**用户发起**的动作：点“检查更新”才做两次很小的只读探测，一个字节的业务数据都不下载。

卡片是一张三列表（模块 / 本地 Tag / 最新 Tag）：本地列来自 `--version` 里的 `vX.Y.Z` 与安装目录里 `.dsh-matlab-release.json` 记的 Tag（旧版 `git clone` 的副本没有这个文件，显示“未知”而不是编一个版本）；产物确实不存在才写“未安装”。首版把“还没比较”直接渲染成“未安装”，让一个已经挂载了 24 组技能的工具包看起来缺失，这是必须避免的误报：状态投影要么来自磁盘事实，要么明确说“尚未检查”。1.1.7 起同一张卡片取代了原来的“更新依赖”和“维护”两张卡，并给出三个动作：

- **检查更新**：只读探测。MCP Server 与工具包都看 `releases/latest`——与安装时 `releases/latest/download/…` 指向同一个 release；某条线路拒绝或限流 `api.github.com` 时，退到发布页本身（`og:url` 里的 tag 就是 `releases/latest` 指向的那个），所以限流不会让检查整体失败。最新列**即使与本地相同也写出官方 Tag**：用户问的是“官方现在是哪一版”，不是“要不要更新”。
- **下载最新依赖**：只在两种情况下可点——本地缺少任一产物，或检查后发现官方 Tag 与本地不同。它**不复用**磁盘上的旧副本：先 dispose 正在跑的 MCP 桥与技能目录，删掉插件自己的两份产物，再走与首次安装相同的后台路径重新下载并挂载（`kind: install`）。这样按钮承诺的“最新”是确定的，而不是“旧的 + 补丁”。
- **清空本地依赖**：删除 `$DSH_HOME/matlab` 下插件安装的二进制与工具包，删前必须过一层二次确认（破坏性动作不能一点就走）。它只动插件自己的文件：`mcpServerPath` 与 `toolkitRoots` 指向的目录从不参与删除，`toolkitRoots` 里的工具包也不参与版本比较——那是用户的目录，不是插件的安装。

比较规则：MCP Server 是 semver（逐段数值比较，镜像晚同步不会触发“降级”）；工具包是月度发布 Tag（`MATK-2026.11.a`），相等即最新，不做数值比较。

真正的替换必须**先停下在跑的那一半**：Windows 不允许替换被进程打开的可执行文件，技能监视器也不该看着目录在自己脚下被重写。工具包先解压到 `<install>.incoming`，**只有完整解压成功**才 `rm` 旧目录并 `rename` 就位（失败时 `.incoming` 被清掉）；二进制走“临时文件 + 原子改名”。更新失败时状态是 `failed` 并写明原因，插件随后用磁盘上的旧副本把技能与 MCP 桥重新挂回来（`recoverAfterFailedUpdate`），所以一次失败的更新不会把可用能力弄没。

整条链路都没有后台轮询或自动更新：静默替换用户正在依赖的工具属于越权（§4.8 的“配置与页面分工”在这里同样适用——每一件影响运行中能力的事都应该由用户按下按钮）。

### 4.13 让 MATLAB 显示 “DeepSeek”：一个只改一条消息的 stdio 桥

MATLAB 把连接方当作一个“客户端”来命名：命令窗口打印“<名字> is connected to MATLAB…”。（桌面标题追加的是固定后缀 `| Agent Connected`，与名字无关。）名字来自 MCP `initialize` 请求的 `clientInfo`——MathWorks 的 `connectionindicator.clientName` 先取 `Title`，为空才取 `Name`。

DSH 的 `@deepseek-ai/dsh-mcp-client` 把 `{ name: "dsh-mcp-client", version: "0.0.1" }` 写死在 `new Client(...)` 里，既不发 `title`，也没有任何配置字段可以覆盖；而 `matlab-mcp-server` 只认 MCP 协议里的这一处。于是插件在两者之间放了一个极小的 stdio 桥（`lib/mcp-bridge.js`）：

- 客户端→服务端方向按行解析，只把 `method === "initialize"` 的那一条的 `params.clientInfo.title` 补成 `agentName`；其余行原样返回（不做 JSON 往返），无法理解的输入也不会被改写；
- 服务端→客户端方向完全不过解析，直接 pipe，所以 MATLAB 代码输出了换行、非 JSON 噪声或大块内容都不受影响；
- 写入尊重子进程的回压（`write()` 返回 false 时暂停 stdin），`end` 时补发没有换行的最后一行并关闭子进程，SIGTERM/SIGINT 转发给服务端；
- 桥本身用 `process.execPath` 启动：宿主是 Electron 时配 `ELECTRON_RUN_AS_NODE=1`（已实测该二进制在 node 模式下运行本桥正常），是纯 node 时该变量无副作用，因此不依赖 PATH 上有没有 node；
- 启动探测也走同一个桥，避免“探测进程先连上 MATLAB、显示成另一个名字”的不一致。

为什么不去打 dsh-mcp-client 的猴子补丁、也不 fork 那个包：那会让插件与另一个包的内部实现绑死，一次升级就可能静默失效；而这条消息是插件**唯一**需要影响的东西，改写点就应该恰好这么小。代价是 stdio 路径上多一个 Node 进程，但它只做行切分与一次 JSON 解析，延迟可忽略，且失败会在连接阶段立刻暴露（探测先替用户发现）。

实测：真实二进制经真实桥初始化后，服务端日志记录 `"client-name":"dsh-plugin-matlab","client-title":"DeepSeek"`，即 `connectionindicator` 会采用 DeepSeek。

**同一个桥还负责“按对话的工作区目录”。** `useWorkspaceFolder` 打开后，MATLAB 的当前文件夹应当跟着**发起调用的那个对话**走，而一个 MATLAB 会话只有一个当前文件夹——它不能是服务端启动参数（那样只对第一个对话成立）。MathWorks 的 `evaluate_matlab_code` 恰好有一个 `project_path` 参数，语义就是“执行前把当前文件夹设到这里”，所以文件夹应该**随调用传递**：

- 宿主在 `tools/pre-execute` 里看到真正发起调用的 agent（`exec.agent.session`），用 DSH 的 `workingDirectory.get(session)` 取该对话的目录，写进一个很小的记录文件（`$DSH_HOME/matlab/workspace-folder.json`）；
- 桥在每条 `tools/call` 上读这条记录，只在工具是 `evaluate_matlab_code`、且模型没有自己给 `project_path` 时补上它；其它工具（`run_matlab_file` 等）的 schema 没有这个参数，模型自己提供文件夹时也以模型为准；
- 同步写文件是刻意的：`pre-execute` 返回 `next()` 之前记录必须落盘，异步写会与紧接着的调用抢跑。写失败只是丢掉一次提示，绝不阻断工具调用；
- 后写覆盖先写，这与设定本身的语义一致：**一个 MATLAB 只有一份当前文件夹**，两个对话同时调用时，谁最后调用，文件夹就属于谁。

为什么不在 `tools/pre-execute` 里直接改参数：DSH 在 `createExecution` 里就把 `arguments` 深冻结了，`pre-execute` 只能回答 allow/ask/deny；参数只能在传输层改，而这正好是这座桥已经存在的位置。翻车面也小：记录文件缺失或损坏时，桥原样转发调用。

## 5. 失败模式

每条失败都有确定的归属和可读的后果：

| 失败点 | 行为 | 用户看到 |
| --- | --- | --- |
| 找不到工具包 | `autoProvision` 为真则安装最新 Release，否则告警继续 | 日志 + `status.toolkit: []`；工具仍可用 |
| `skillGroups` 里有未知组 | **激活失败**（配置错误自包含，尽早失败） | 报错里列出所有可用组名 |
| 找不到 MATLAB | 告警继续，让 MCP 服务自己报错 | `status.matlab: undefined` + 服务 stderr |
| 二进制缺失 | 后台下载；本次启动的工具稍后挂载 | 日志 `downloading …`；`status.phase: provisioning` → `ready` |
| 二进制缺失且无法下载 | 后台任务失败，`status.error` 写明每条线路的原因 | 日志 + 状态路由；下次启动重试 |
| `autoProvision` 关闭且二进制缺失 | **激活失败**，报错给出三条可行建议 | 明确的下一步 |
| 一条加速线路失败 | 换下一条线路，记录失败原因 | 日志里逐条列出；`status.github.routes` 显示链条 |
| 首次准备花光预算（`provisionTimeoutMs`） | 后台任务失败，写明各线路原因与未尝试条数 | 启动已经完成，不受影响 |
| 加速前缀配置非法 | **激活失败**，给出 `https://gh-proxy.com` 这种写法 | 配置错误早失败 |
| `DSHM_GITHUB_PROXY` 非法 | 告警并忽略该变量，继续解析区域与市场前缀 | 日志一条 warning |
| 设置页写非 volatile 字段 | 400，页面显示 DSH 的报错 | 只有 `.volatile()` 能从页面改 |
| 写路由误用 `resource` | 框架对非 GET/HEAD 直接 405，保存/检查/安装全部失效 | 1.0.1 起写路由用 `handler`，并用真 HTTP 测试锁住 |
| 两个窗口同时改配置 | 409，页面重新载入当前值 | revision 冲突 |
| profile 没有 `settings` 服务 | 503，页面提示改 `cordis.patch.yml` | 极简组合仍然可配置 |
| 后台准备期间改设置 | 重挂排队到准备完成，日志随后一行 `settings applied` | 不会出现两套挂载 |
| 检查更新时网络不可用 | 两项各自记录 `error`，页面显示检查失败 | 只读探测，不改变任何东西 |
| 命名桥无法启动 | 探测/连接失败，报错里带桥的路径与服务端 stderr | 不会假装连上 |
| 更新时下载中断 | 状态 `failed`，磁盘上的旧副本下次启动仍可使用 | 日志写明原因 |
| 检查后发现没有更新 | `started: false, upToDate: true` | 页面显示“已是最新” |
| 探测失败 | 告警；`failOnStartupError` 为真则失败 | `status.probe.error` + stderr |
| MCP 桥连接失败 | 记录 `phase: "failed"` 与原因；不中断 profile | 错误日志 + 状态路由 |
| 技能注册服务不存在 | 告警跳过技能，工具照常 | 日志说明 profile 未加载 skills |
| `apply` 返回了非 `undefined` 值 | **fiber 卸载**，`TypeError: Invalid effect` | 见 §4.9；已修复并有回归测试 |

“配置错误立刻失败、运行时依赖缺失降级继续”这条线是刻意划的：前者用户能立刻修，后者可能只是暂时没装。

## 6. 兼容性与版本

- 插件对 DSH 侧只依赖两个公开包：`@deepseek-ai/dsh-mcp-client` 的 `StdioConfig`（`transport/serverName/command/args/env/cwd/toolCallTimeoutMs/failOnStartupError`）与 `@deepseek-ai/dsh-skill-filesystem` 的 `Config`（`providerName/includeDefaultRoots/customSkillDirs/watch`）。二者都是稳定文档化字段；
- 插件自身的版本只在 `package.json` 里写一次：`lib/version.js` 读它，MCP 探测的 `clientInfo` 与状态路由的 `plugin`/`version` 都取自那里，发版时不必改第二处；
- `peerDependencies` 用 `*`：真实的解析由 DSH 运行时的安装范围（installation scope）提供，写死小版本反而会在 DSH 升级时阻止加载；
- MATLAB 侧只依赖**文档化的 CLI 与文件格式**：`--matlab-*` 参数、`bin/` 布局、Release 资产名、`manifest.yaml` 的 `skill-groups` / `mcp-server-extensions`、`skills-catalog/<group>/<skill>/SKILL.md`。这些是 MathWorks 公开契约，插件不含版本号判断，因此新版工具包无需改插件；
- `manifest.yaml` 的解析是**目标式**的：只抽两个 section，读不懂就回退到扫描 `skills-catalog/` 目录，永远不因为格式演进把技能丢掉。

## 7. 安全

- 子进程只用 argv 传递参数，不拼接 shell 字符串；`shell: false`；
- 下载只从 MathWorks 的 GitHub（Release 资产或该 tag 的源码包），经可选的反代前缀（仅 `https://`、无凭据/查询串）。二进制校验体积下限与文件头（Windows 要求 `MZ`，POSIX 接受 ELF/Mach-O 或 `#!` 脚本），先写临时文件再原子改名并置可执行位；工具包校验 gzip 魔数与 tar 头校验和，**拒绝任何绝对路径、`..` 段或指向目标目录之外的符号链接**，只解压到一个空的暂存目录，完整成功后才替换旧目录——公共反代在上游失效时常用自家 HTML 错误页冒充 200，不能把它当程序或技能装上；
- 解压后不执行任何来自工具包的内容：技能是 `SKILL.md` 文本，`tools/tools.json` 只是 MCP 工具定义；插件本身只运行 MathWorks 的 `matlab-mcp-server` 二进制；
- 不读取、不写入 MATLAB 许可证或凭据；`dsh-mcp-client` 默认会清理名字含 `KEY/PASSWORD/SECRET/TOKEN` 的环境变量，插件只补充 `WINDIR`（Windows 上 MATLAB 必需）；
- 状态路由只读、无副作用，且仅在 profile 里有 `ctx.webServer` 时注册；写路由使用 carrier 的 `handler`，校验同源与 `application/json`，body 上限 256 KiB；
- MathWorks 遥测默认关闭（`disableTelemetry: true`，透传 `--disable-telemetry=true`）；只有用户显式取消勾选才会向 MathWorks 发送使用数据。插件自身不收集、不上报任何遥测；
- 工具调用本身的高风险（执行任意 MATLAB 代码）由 DSH 既有的权限与审批机制在 `tools/pre-execute` 上治理，插件不另开审批通道，也不弱化它。

## 8. 验证标准

设计是否成立，用这几条判定（均已在本机实测通过）：

1. **真机握手**：插件自己下载到 `$DSH_HOME/matlab/bin` 的 `matlab-mcp-server.exe` v0.16.0，探测返回 5 个工具、2 个资源、协议 `2025-06-18`；
2. **真机发现**：`$DSH_HOME/matlab` 里取到二进制与含 24 组的工具包（`.dsh-matlab-release.json` 记录 `MATK-2026.11.a`），MATLAB 根由 环境变量 / PATH / 注册表 / 安装目录 发现（本机为 `R2023b`）；
3. **绑定正确**：默认选中全部 24 组（158 个技能），技能根为各 `skills-catalog/<group>` 目录；MCP 参数含 `--matlab-session-mode=auto --matlab-root=… --matlab-display-mode=desktop --log-folder=…`；
4. **规则正确**：`existing` 模式自动丢弃 `--matlab-root` / `--matlab-display-mode` / `--initial-working-folder` 并给出警告；
5. **失败可读**：未知技能组、缺失二进制、探测失败、桥连接失败各自有不同的、可操作的报告；
6. **技能格式兼容**：158 个 `SKILL.md` 的 `name` 全为 kebab-case 且与目录同名、`description` 齐全——这很关键，因为 DSH 的 filesystem provider 对不合格技能是**静默丢弃**，不会告诉模型“这个技能坏了”；
7. **配置契约**：用真实 schemastery 校验 `Config` 的默认值、枚举与类型拒绝路径；并验证 `.volatile()` 字段经 `resolveOptions` 解包后能取到用户设置（否则设置会被静默忽略）。
8. **首次获取走加速线路且不占启动**（本机实测）：激活 0.10 秒返回 `phase: provisioning`；后台 `github: gh-proxy.com -> ghfast.top -> direct (region china)`，19.9 MB 二进制经 `gh-proxy.com` 装好、`--version` 返回 `v0.16.0`，`MATK-2026.11.a` 源码包（3.36 MB / 1433 个文件）2.4 秒装完并挂上 24 组 / 158 个技能，真实 MCP 握手 5 工具 / 2 资源，随后 `phase: ready`；第二次启动 0 次下载、0 后台任务。
9. **设置页与进度对话框的宿主契约**：`test/api.test.js` 覆盖 `state/progress/config/provision/update/dependencies` 六条路由、写路由必须是 `handler`（并用本地 HTTP server 复刻 carrier 的 GET/HEAD 规则做真 POST）、非 volatile 拒绝、503 与 409 冲突、405/415/403、必需技能组无法被排除、遥测默认值；`test/activate.test.js` 覆盖组清单投影、`loader/volatile-update` 触发的重挂（含 MATLAB 根与加速线路重解析）、下载进度的百分比、清空依赖（只删插件自己的产物并清空状态）与“先清后下”的下载顺序。真实浏览器里的渲染需要在重启后目视确认（插件代码无法在宿主运行期间重启宿主），这一条注明为“待目视”，不冒充已验证。

## 9. 已知限制与后续方向

- **Workspace 级隔离**：目前是 profile 级单例（`serverName: matlab`）。若将来 DSK 支持按 Agent/workspace 覆写插件配置，同一 profile 里跑两个独立 MATLAB 会话才可实现（`dsh-mcp-client` 本身支持按 scope 复用命名空间）。
- **不使用 MCP 资源注入**：`guidelines://coding` 等资源已可被模型通过 MCP 资源工具按需读取，但不会自动进入系统提示。自动注入属于 DSH 的资源策略问题，不在这里私开通道。
- **不管理 MATLAB 安装本身**：`matlab-install-products` 技能可以让 Agent 参与安装，但安装过程仍归 MATLAB。
- **Simulink 只是顺带支持**：检测到 Simulink 工具包时会加载其技能组与 `tools/tools.json` 扩展；未做针对 Simulink 的专门验证（本机未安装 Simulink）。
- **加速路线跟随 DSH，不另建配置中心**：插件读 DSH 市场持久化的区域与前缀，也接受 `DSHM_GITHUB_PROXY` 与自己的 `githubProxy`（见 §4.10）。若 DSH 将来改变市场状态的存放位置或字段名，插件会退化为“直连 + 配置前缀可用”，不会因此无法启动；反过来说，插件不会把自己的线路写回市场状态，两边的写入权仍归 DSH。
- **首次启动有一段“工具还没出现”的窗口**：获取在后台（本机实测二进制 52 秒、工具包 2.4 秒），期间模型看不到 MATLAB 工具与技能，`status.phase` 为 `provisioning`。这是为了不越过 DSH Desktop 的 60 秒启动上限（§4.7）；想让首次启动等到完成，用 `provisionWaitMs`（但必须 ≤ 60 秒）。若将来 DSH 提供“安装期预置”或“就绪前阻塞但不判失败”的机制，这一段应该交给它。
- **后台挂载依赖 Cordis 的延迟 `ctx.plugin`**：插件被卸载后后台任务若仍在跑，挂载会以 “inactive context” 失败并被记录为 `status.error`，不会污染进程；成功路径已由 `test/activate.test.js` 的“never holds activation”用例覆盖。
- **设置页的字段集合等于 volatile 集合**：想从页面改一个字段，就得把它标成 `.volatile()`，代价是该字段的变更不再走“重启插件”的默认语义，而由本插件自己重挂（§4.11）。这是有意的交换：页面要即时生效，就必须自己承担重挂的正确性，而重挂路径有测试覆盖；若将来某个字段需要“重启才生效”的语义，就别把它放进页面。
- **进度对话框不做取消**：一次下载开始后不能在页面里中途取消；关掉对话框只是隐藏，后台继续（这正是“不阻塞启动”的另一面）。要中止只能退出宿主进程。
- **stdio 路径上多一个桥进程**（§4.13）：只改 initialize，其余透传；如果将来 DSH 的 MCP 客户端支持 `clientInfo.title`，这个桥应当直接删掉。
- **更新只由用户触发**：没有后台轮询、没有自动更新（§4.12）。想“始终最新”的部署可以自己跑一次 HTTP 调用 `POST /plugin/matlab/dependencies`（`{"action":"download"}`），但插件不会替人决定；清空依赖同理，必须用户确认。
- **外部安装器不再参与**：`~/.matlab/agentic-toolkits` 与它的 `config.json` 都不再被读取（§4.4），所以安装器里选的 MATLAB 版本偏好不再影响 DSH；多版本共存时请显式设 `matlabRoot`。
