# 商店提交材料（已提交，PR #14160）

本文件是 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录所需的全部内容。

提交过两次：

1. 首次收录：PR [#13361](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13361)，已合并；
2. 本次更新自己的那一条：PR [#14160](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14160)（2026-11-11 提交，已合并）——改描述、补上“安装后重启 DSH”、说明改为安装最新 Release、修正遥测默认值。维护者在合并时补了一句“下载来的二进制不做校验和检查就会运行”，并在评审意见里要求补上摘要校验。

1.1.9（2026-11-11）按该意见实现了下载校验（见 §1.1）：MCP Server 二进制在下载过程中计算 SHA-256，与 GitHub Release API 公布的资产 `digest` 比对，不一致就删除临时文件、拒绝安装并换线路；工具包补上 `content-length` 与实际字节数核对（gzip CRC 与 tar 头校验原本就有）。**评审补的那句话因此过时**，下一次更新条目时按 §1.1 的文本删掉即可。

条目文件与 PR 文案以本文件为准；截图由本仓库自己的 `screenshots.json`（→ `assets/settings.png`）提供。

## 1. 要提交的唯一文件

路径：`data/plugins/tedcriss__dsh-matlab.yml`（覆盖已有同名文件）

```yaml
url: https://github.com/tedcriss/dsh-matlab
name: tedcriss/dsh-matlab
category: tools
description:
  en: 'Adds the MathWorks MATLAB Agentic Toolkit skills and the MATLAB MCP Server tools to DeepSeek Harness. Needs a local MATLAB R2021a or later, and DSH must be restarted after installing the plugin. By default (autoProvision) it downloads the MathWorks MCP Server binary and installs the newest Agentic Toolkit release on first use. MathWorks telemetry is disabled by default; set disableTelemetry to false to re-enable it.'
  zh: '把 MathWorks 的 MATLAB Agentic Toolkit 技能与 MATLAB MCP Server 工具接入 DeepSeek Harness。需要本机 MATLAB R2021a 及以上，且安装插件后需重启 DSH。默认（autoProvision）首次使用时会下载 MathWorks MCP Server 并安装工具包的最新 Release。MathWorks 遥测默认关闭，把 disableTelemetry 设为 false 才会重新开启。'
```

说明：

- 只有 `description.en` 是必填；`zh` 已有，保持同步。
- 描述里的每一句都对得上代码：插件不实现 MATLAB 能力（只挂载 MathWorks 的 MCP Server 与技能目录）；`autoProvision` 默认 `true`；`disableTelemetry` 默认 `true`（= 遥测关闭），所以文案写“默认关闭，设为 `false` 才会重新开启”。这里不再出现“克隆工具包”，因为 1.1.8 起改为安装最新 Release。
- 不加 `icon:`：商店回退到作者头像，`icon.svg` 仍是插件自己的图标。
- 不加 `tarball:`：本包未发布 npm，源码安装即可（`dsh.bundle` 已声明）。
- 不加 `npm:`：没有 npm 包，这一项也不允许手写。

### 1.1 1.1.9 之后要提交的描述（删掉“不做校验和”那句）

维护者在 [PR #14160](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14160) 合并时补的最后一句话，在 1.1.9 之后不再属实：

```yaml
description:
  en: 'Adds the MathWorks MATLAB Agentic Toolkit skills and the MATLAB MCP Server tools to DeepSeek Harness. Needs a local MATLAB R2021a or later, and DSH must be restarted after installing the plugin. By default (autoProvision) it downloads the MathWorks MCP Server binary and installs the newest Agentic Toolkit release on first use. MathWorks telemetry is disabled by default; set disableTelemetry to false to re-enable it.'
  zh: '把 MathWorks 的 MATLAB Agentic Toolkit 技能与 MATLAB MCP Server 工具接入 DeepSeek Harness。需要本机 MATLAB R2021a 及以上，且安装插件后需重启 DSH。默认（autoProvision）首次使用时会下载 MathWorks MCP Server 并安装工具包的最新 Release。MathWorks 遥测默认关闭，把 disableTelemetry 设为 false 才会重新开启。'
```

被删掉的原文（中英各一句）：

```text
When the download region is China (set in the plugin or by DSH's market) or a GitHub prefix is configured, the server binary and the toolkit archive are fetched through that prefix first (gh-proxy.com and ghfast.top by default) and then directly, and the downloaded server binary is run without a checksum check.
下载区域为 china（插件里设置或 DSH 市场已选）或配置了 GitHub 前缀时，MCP Server 二进制和工具包压缩包会先经该前缀（默认 gh-proxy.com、ghfast.top）下载，失败再直连；下载来的二进制不做校验和检查就会运行。
```

替换理由：`lib/release.js` 现在在写入临时文件的同时计算 SHA-256，与 `api.github.com/.../releases/{latest|tags/<tag>}` 返回的资产 `digest` 比对，不一致会删除临时文件并拒绝安装（`lib/integrity.js`、`test/release.test.js`）；`lib/provision.js` 也会核对响应声明的字节数。直连 API 不可达时才退回加速线路读取摘要，并在日志里注明摘要来自镜像；连摘要都取不到时日志明确写“本次未校验”。

## 2. 截图：声明在**本仓库**里

商店的详情页截图不从上面那个 YAML 里写，而是读插件仓库自己的 `screenshots.json`：

- `screenshots.json` → `["assets/settings.png"]`
- `assets/settings.png` → **设置 → MATLAB 整页长截图**（1600 × 6238，含带插件版本号的状态卡、“依赖”三列表与三个按键、全部 24 个技能组、带自动发现值/示例提示的输入框、“使用当前对话的工作区目录”开关与单行单选项，以及固定在底部的保存条）

想换图只需替换这两个文件再推本仓库，不用到商店仓库开 PR，下一次夜间构建自动生效。

生成方式（可复现）：在 DSH Web 界面打开 设置 → MATLAB，用浏览器开发者工具把设置面板的滚动容器撑到内容高度（`overflow: visible; height: auto`），再把技能组列表的 `max-height` 去掉，然后对设置面板做整页截图（`Page.captureScreenshot`，`captureBeyondViewport`，`scale: 2`）。

## 3. PR 标题与正文

标题：

```text
Update tedcriss/dsh-matlab: restart note and a settings screenshot
```

正文：

```markdown
## What this updates

`tedcriss/dsh-matlab` (first listed in #13361) — description only, no new entry.

- The description now says the plugin must be restarted after installation. DSH loads
  plugin code when the Host starts, so `pnpm add` alone adds nothing visible: the MATLAB
  settings page, the progress dialog and the `mcp__matlab__*` tools all appear on the
  next start.
- "clones the toolkit" is no longer true: 1.1.0 installs the newest Agentic Toolkit
  release (the source archive of its release tag) instead of cloning the repository.
- The settings page screenshot is declared in the plugin's own repository
  (`screenshots.json` → `assets/settings.png`), so storefronts can show the full page.

## Checklist

- [x] Changed one file: `data/plugins/tedcriss__dsh-matlab.yml` (my own entry)
- [x] `package.json` still declares `dsh.bundle` (`cordis.patch.yml` inserts the
      `matlab-agentic` row)
- [x] Description matches the code (`autoProvision`, `disableTelemetry`, no capability
      claims of its own)
- [x] Screenshots declared in the plugin repository, GitHub-hosted, relative path
- [x] No README hand-edits
```

## 提交前自查

1. `package.json` 的 `dsh.bundle` 仍在（CI 第一步会读它）；
2. 仓库满 1 天（早已满足）；
3. `screenshots.json` 指向的文件确实在 `main` 上（`assets/settings.png`）；
4. PR 只改 `data/plugins/tedcriss__dsh-matlab.yml` 一个文件，不动别人的条目与生成的 README；
5. 描述与代码一致：`autoProvision` 默认 `true`、`disableTelemetry` 默认 `true`、“安装后需重启 DSH”与 `lib/index.js`/`lib/activate.js` 的行为一致。
