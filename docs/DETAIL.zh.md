# MATLAB 智能体工具包

把 MathWorks 自己的 MATLAB 能力面接进 DSH，而不重造一份。

## 增加了什么

- **工具**：来自 MATLAB MCP Server，注册为 `mcp__matlab__<tool>`——`evaluate_matlab_code`、`run_matlab_file`、`run_matlab_test_file`、`check_matlab_code`、`detect_matlab_toolboxes`，以及两个 `guidelines://` 资源。
- **技能**：来自 MATLAB Agentic Toolkit，由 `dsh-skill-filesystem` 直接从 `skills-catalog/<group>` 加载。默认全量（MATLAB 工具包 24 组 / 158 个技能）；用 `skillGroups` 列组名可收窄，以节省上下文。
- **Simulink**：若同时安装了 Simulink Agentic Toolkit，它的技能组与 `tools/tools.json` MCP 扩展也会一起接入。

## 不做什么

它不自己运行 MATLAB 代码、不复制任何 `SKILL.md`、不改写 `~/.matlab` 下的任何内容。工具由 `matlab-mcp-server` 提供，技能由工具包 checkout 提供，传输层是 `dsh-mcp-client` 与 `dsh-skill-filesystem`。

## 环境要求

MATLAB R2021a 或更新、MATLAB MCP Server 二进制、MATLAB Agentic Toolkit checkout。官方安装器一次装齐：

```matlab
setupAgenticToolkit("install")
```

插件会发现 `~/.matlab/agentic-toolkits` 里的这份安装，沿用你在 MATLAB 里选定的版本，并复用安装器放好的二进制。若什么都没装，它会自行下载二进制并克隆工具包——放在**后台**做，因为 DSH Desktop 会放弃 60 秒内没启动完成的宿主机；在准备完成并挂载之前，`status.phase` 是 `provisioning`。

## 值得注意的设置

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `skillGroups` | 全部组 | 要加载哪些 `skills-catalog` 组；留空即全部 |
| `sessionMode` | `auto` | `existing` 复用执行过 `shareMATLABSession()` 的 MATLAB |
| `matlabRoot` | 自动发现 | 服务启动哪个 MATLAB |
| `displayMode` | `desktop` | `nodesktop` 不显示 MATLAB 桌面 |
| `toolCallTimeoutMs` | 600000 | 仿真与测试套件远超 DSH 默认值 |
| `githubProxy` | 沿用 DSH | GitHub 加速前缀；留空则沿用 DSH 自己的设置（`DSHM_GITHUB_PROXY` 或市场里的自定义前缀） |
| `downloadRegion` | `auto` | `china` 用内置加速线路，`global` 直连；`auto` 跟随 DSH 市场的区域 |

在 github.com 很慢的网络上，首次启动不会直连下载：二进制与工具包克隆都依次尝试 `gh-proxy.com`、`ghfast.top`、直连，每条线路都有超时预算，镜像失效只浪费几十秒而不是整段启动。

## 诊断

`GET /plugin/matlab/status` 会给出：解析到的 MATLAB 根目录、二进制路径与版本、探测结果（工具与资源名）、已加载技能组及技能数、当前生效的 GitHub 加速（`github.region` / `github.routes` / `server.route`），以及激活期间的告警。

完整字段见 [README](../README.md)，取舍理由见 [DESIGN](../DESIGN.md)。
