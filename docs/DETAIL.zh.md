# MATLAB 智能体工具包

把 MathWorks 自己的 MATLAB 能力面接进 DSH，而不重造一份。

## 增加了什么

- **工具**：来自 MATLAB MCP Server，注册为 `mcp__matlab__<tool>`——`evaluate_matlab_code`、`run_matlab_file`、`run_matlab_test_file`、`check_matlab_code`、`detect_matlab_toolboxes`，以及两个 `guidelines://` 资源。
- **技能**：来自 MATLAB Agentic Toolkit，由 `dsh-skill-filesystem` 直接从 `skills-catalog/<group>` 加载。默认全量（MATLAB 工具包 24 组 / 158 个技能）；用 `skillGroups` 列组名可收窄，以节省上下文。
- **Simulink**：若同时安装了 Simulink Agentic Toolkit，它的技能组与 `tools/tools.json` MCP 扩展也会一起接入。
- **设置页**（`设置 → MATLAB`）：连接状态（含插件版本）、依赖卡片（本地/最新 Tag，检查更新、下载最新依赖、清空本地依赖三个按键，清空前二次确认）、按组开关技能（可上下滚动的两列列表，必需组锁定不可关闭）、MATLAB 根目录与 MCP Server 路径、下载线路、“用当前对话的工作区目录作为起始目录”开关；保存走 DSH 自己的 settings 服务，立即生效、不用重启。MathWorks 遥测默认关闭。
- **进度对话框**：首次下载二进制或安装工具包发布包时出现在右下角，慢线路看得见，而不是像卡死。

## 不做什么

它不自己运行 MATLAB 代码、不复制任何 `SKILL.md`、不改写 `~/.matlab` 下的任何内容。工具由 `matlab-mcp-server` 提供，技能由工具包提供，传输层是 `dsh-mcp-client` 与 `dsh-skill-filesystem`。

## 环境要求

MATLAB R2021a 或更新。MCP Server 二进制与 Agentic Toolkit（最新 Release 的源码包，例如 `MATK-2026.11.a`）属于插件自己，放在 `$DSH_HOME/matlab`；`~/.matlab/agentic-toolkits` 里安装器装的那一份**不会被读取**，插件也不 clone 仓库，本机不需要 `git`。

商店安装走本仓库 Release 上的预构建包 `dsh-plugin-matlab.tgz`（约 100 KB，带 `dsh.bundle`，无安装期脚本），不是整仓库源码；装好后市场会热挂载 `matlab-agentic` 这一行，**通常不需要重启 DSH**，刷新页面即可，只有市场提示“热挂载失败”时才重启一次。

首次启动会在后台下载二进制并安装工具包——因为 DSH Desktop 会放弃 60 秒内没启动完成的宿主机；准备完成并挂载之前 `status.phase` 是 `provisioning`，右下角有进度对话框。之后可以在设置页检查发布版本（本地 Tag / 官方最新 Tag 两列都给出），只有确实更新时才替换；不同 Release 的旧目录与旧二进制名会在替换时一起清掉。

## 值得注意的设置

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `skillGroups` | 全部组 | 要加载哪些 `skills-catalog` 组；留空即全部 |
| `sessionMode` | `auto` | `existing` 复用执行过 `shareMATLABSession()` 的 MATLAB |
| `matlabRoot` | 自动发现 | 服务启动哪个 MATLAB |
| `displayMode` | `desktop` | `nodesktop` 不显示 MATLAB 桌面 |
| `toolCallTimeoutMs` | 600000 | 仿真与测试套件远超 DSH 默认值 |
| `agentName` | `DeepSeek` | MATLAB 连接时打印的 Agent 名 |
| `disableTelemetry` | `true` | 向 MCP Server 传 `--disable-telemetry=true`；默认不上报遥测 |
| `githubProxy` | 沿用 DSH | GitHub 加速前缀，可写多个（逗号分隔）由插件测速择优；留空则沿用 DSH 自己的设置（`DSHM_GITHUB_PROXY` 或市场里的自定义前缀） |
| `downloadRegion` | `auto` | `china` 用内置加速线路，`global` 直连；`auto` 跟随 DSH 市场的区域 |

在 github.com 很慢的网络上，首次启动不会直连下载：二进制与工具包发布包都依次尝试 `gh-proxy.com`、`ghfast.top`、直连，每条线路都有超时预算，镜像失效只浪费几十秒而不是整段启动。每次下载前插件会先用 `HEAD` 量一遍候选加速线路，把最快的排到最前；`githubProxy` 可以写多个前缀，它们一起参与这次测量。

下载来的二进制随后会被执行，因此安装不再把镜像当作可信来源：先读取 GitHub Release API 公布的资产 `sha256` 摘要（优先直连 `api.github.com`，镜像不能同时是“包体”和“摘要”的唯一来源），下载中边写临时文件边算哈希，不一致就删文件、拒绝安装；Release 公布的字节数与响应 `content-length` 也会核对。工具包源码包没有可核对的上游摘要，校验的是传输完整与 gzip/tar 结构正确，完整成功后才替换技能目录。

## 诊断

`GET /plugin/matlab/status` 会给出：插件自身的名字与版本（读自 `package.json`）、解析到的 MATLAB 根目录、二进制路径与版本、工具包来自哪个 Release Tag（`toolkitRelease.tag`）、探测结果（工具与资源名）、已加载技能组及技能数、当前生效的 GitHub 加速（`github.region` / `github.routes` / `server.route`），以及激活期间的告警。

设置页另用六个同源 JSON 路由：`GET /plugin/matlab/{state,progress}` 读取，`POST /plugin/matlab/{config,provision,update,dependencies}` 写入。写路由在 DSH 的 web carrier 上必须注册为 `handler`（`resource` 只接受 GET/HEAD，其它方法会被框架直接回 405）。写路由要等 DSH 真正提交后才回答，`state` 又按已提交的配置投影，而不是上次挂载的快照，所以保存后立刻重载页面读到的就是已存的值。

完整字段见 [README](../README.md)，取舍理由见 [DESIGN](../DESIGN.md)。
