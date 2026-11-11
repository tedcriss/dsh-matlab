# 商店提交材料

本文件是 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录所需的全部内容。

已提交过两次，均已被合并：

1. 首次收录：PR [#13361](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13361)
2. 上一次更新：PR [#14160](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14160)（改描述、补“安装后重启 DSH”、说明改为安装最新 Release、修正遥测默认值）

维护者在合并 #14160 时补了一句“下载来的二进制不做校验和检查就会运行”，并在评审意见里要求补摘要校验。1.1.9（2026-11-11）按该意见实现了下载校验：MCP Server 二进制在下载过程中计算 SHA-256，与 GitHub Release API 公布的资产 `digest` 比对，不一致就删除临时文件、拒绝安装并换线路；工具包补上 `content-length` 与实际字节数核对（gzip CRC 与 tar 头校验原本就有）。**评审补的那句话因此过时**。

1.2.0 又改了三件与安装有关的事，所以条目要再更新一次（见 §1）：

- 商店改为从 **Release 的预构建包**安装（`tarball:` 字段），不再按源码克隆整仓库；包约 102 KB，且资产名不带版本号，市场因此能沿 `releases/latest/download/` 自动更新到下一次 Release；
- 激活不再等待 `--version` 与 MCP 握手探测（两者改为后台诊断），热挂载更稳；**通常不再需要重启 DSH**，描述里那句“安装后需重启”被换掉；
- `githubProxy` 可以写多个前缀，下载前用 `HEAD` 实测、最快者优先；旧的工具包目录与旧资产名的二进制会在替换时清掉。

1.2.1 修了工具包解压器的越界判断（符号链接目标比安装根短时会被误判为目录内），由新增的 Release 流程在 Linux 上跑测试时发现；描述与条目不变。

## 1. 要提交的唯一文件

路径：`data/plugins/tedcriss__dsh-matlab.yml`（覆盖已有同名文件）

```yaml
url: https://github.com/tedcriss/dsh-matlab
name: tedcriss/dsh-matlab
category: tools
tarball: https://github.com/tedcriss/dsh-matlab/releases/latest/download/dsh-plugin-matlab.tgz
description:
  en: 'Adds the MathWorks MATLAB Agentic Toolkit skills and the MATLAB MCP Server tools to DeepSeek Harness. Needs a local MATLAB R2021a or later. Installs from the plugin''s own release archive; a DSH restart is usually unnecessary, and a page refresh shows the MATLAB settings page. By default (autoProvision) it downloads the MathWorks MCP Server binary and installs the newest Agentic Toolkit release on first use, choosing the fastest configured GitHub acceleration route. MathWorks telemetry is disabled by default; set disableTelemetry to false to re-enable it.'
  zh: '把 MathWorks 的 MATLAB Agentic Toolkit 技能与 MATLAB MCP Server 工具接入 DeepSeek Harness。需要本机 MATLAB R2021a 及以上。从插件自己的 Release 包安装；通常不需要重启 DSH，刷新页面即可看到 MATLAB 设置页。默认（autoProvision）首次使用时会下载 MathWorks MCP Server 并安装工具包的最新 Release，并在可用线路中自动选择最快的 GitHub 加速。MathWorks 遥测默认关闭，把 disableTelemetry 设为 false 才会重新开启。'
```

说明：

- 只有 `description.en` 是必填；`zh` 已有，保持同步。
- **`tarball` 的资产名必须不带版本号。** 商店规范要求 GitHub Release 托管的 `https` `.tgz`；`releases/latest/download/<文件名>` 只在请求时解析 `latest`，文件名是照字面取的。带版本号的名字在下一个 Release 就会 404。本仓库的 `scripts/release.mjs` 与 `.github/workflows/release.yml` 都把资产固定命名为 `dsh-plugin-matlab.tgz`，就是为了这一条。
- 这个 URL 形态也是 DSH 市场识别“可随 Release 更新”的唯一形态：它读 `raw.githubusercontent.com/tedcriss/dsh-matlab/<tag>/package.json` 核对版本，再把下一次安装指向 `releases/download/<tag>/dsh-plugin-matlab.tgz`。换成 `download/vX.Y.Z/` 也能装，但会失去自动更新。
- 描述里的每一句都对得上代码：插件不实现 MATLAB 能力（只挂载 MathWorks 的 MCP Server 与技能目录）；`autoProvision` 默认 `true`；`disableTelemetry` 默认 `true`（= 遥测关闭）；`lib/github.js` 的 `rankRoutes()` 在下载前实测加速线路；“通常不需要重启”对应市场的热挂载，且插件激活已不再等待诊断（`lib/activate.js` 的 `collectDiagnostics`）。
- 不加 `icon:`：商店回退到作者头像，`icon.svg` 仍是插件自己的图标。
- 不加 `npm:`：没有 npm 包，这一项也不允许手写；`tarball` 已覆盖“预构建安装”。

## 2. 截图：声明在**本仓库**里

商店的详情页截图不从上面那个 YAML 里写，而是读插件仓库自己的 `screenshots.json`：

- `screenshots.json` → `["assets/settings.png"]`
- `assets/settings.png` → **设置 → MATLAB 整页长截图**（1600 × 6238，含带插件版本号的状态卡、“依赖”三列表与三个按键、全部 24 个技能组、带自动发现值/示例提示的输入框、“使用当前对话的工作区目录”开关与单行单选项，以及固定在底部的保存条）

1.2.0 起截图不再进安装包（`package.json` 的 `files` 去掉 `assets` 与 `docs`），但仍在仓库里给商店读；README 的图片引用已改成绝对 URL，两处都能显示。

想换图只需替换这两个文件再推本仓库，不用到商店仓库开 PR，下一次夜间构建自动生效。

生成方式（可复现）：在 DSH Web 界面打开 设置 → MATLAB，用浏览器开发者工具把设置面板的滚动容器撑到内容高度（`overflow: visible; height: auto`），再把技能组列表的 `max-height` 去掉，然后对设置面板做整页截图（`Page.captureScreenshot`，`captureBeyondViewport`，`scale: 2`）。

## 3. PR 标题与正文

标题：

```text
Update tedcriss/dsh-matlab: install from the release archive, no restart
```

正文：

```markdown
## What this updates

`tedcriss/dsh-matlab` (first listed in #13361, last updated in #14160) — description only, no new entry.

- The entry gains `tarball:`, so the market installs one prebuilt ~102 KB archive
  from this repository's Release instead of a full-repository source install. The
  asset name carries no version, so `releases/latest/download/` keeps resolving
  across releases and the market's release-update path keeps working.
- "DSH must be restarted after installing" is no longer true and is gone from the
  description: the market mounts the row live, activation no longer waits for the
  server's `--version` and startup probe (they run as background diagnostics), and
  a page refresh shows the settings page. A restart remains the fallback when the
  market reports that its live mount failed.
- The description now states that the plugin picks the fastest configured GitHub
  acceleration route, which `lib/github.js` measures with a `HEAD` before each
  download.
- The "downloaded binary is run without a checksum check" sentence added in #14160
  is obsolete since 1.1.9 (the body is hashed while streaming and compared with the
  release's published digest), so it is not carried over.

## Checklist

- [x] Changed one file: `data/plugins/tedcriss__dsh-matlab.yml` (my own entry)
- [x] `package.json` still declares `dsh.bundle` (`cordis.patch.yml` inserts the
      `matlab-agentic` row)
- [x] `tarball` is an https `.tgz` on this repository's own GitHub Release, with a
      version-free asset name
- [x] Description matches the code (`autoProvision`, `disableTelemetry`,
      `rankRoutes`, background diagnostics)
- [x] Screenshots declared in the plugin repository, GitHub-hosted, relative path
- [x] No README hand-edits
```

## 提交前自查

1. `package.json` 的 `dsh.bundle` 仍在（CI 第一步会读它）；
2. 仓库满 1 天（早已满足）；
3. `screenshots.json` 指向的文件确实在 `main` 上（`assets/settings.png`）；
4. PR 只改 `data/plugins/tedcriss__dsh-matlab.yml` 一个文件，不动别人的条目与生成的 README；
5. `tarball` 指向的资产在最新 Release 上确实存在，且直连可下载：
   `curl -sIL https://github.com/tedcriss/dsh-matlab/releases/latest/download/dsh-plugin-matlab.tgz | head -1`；
6. 描述与代码一致：`autoProvision` 默认 `true`、`disableTelemetry` 默认 `true`、加速线路实测择优、安装后通常无需重启。
