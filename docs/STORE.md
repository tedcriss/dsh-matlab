# 商店提交材料

本文件是 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录所需的全部内容。

## 0. 已有 PR 与审查意见（截至 2026-11-11）

| PR | 状态 | 审查结论 | 本次条目如何处理 |
| --- | --- | --- | --- |
| [#13361](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13361) | 已合并 | 合并时在 main 上补了前置条件与默认行为（MATLAB R2021a+、`autoProvision` 首次下载、遥测默认值），并说明“措辞如需调整，直接开 PR 改条目” | 保留前置条件、`autoProvision` 默认行为与遥测默认值这三句 |
| [#14160](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14160) | 已合并 | 要求下载后核对 GitHub Release 资产的 `digest`（sha256，优先直连 `api.github.com`），不一致拒绝安装；实现后他会把描述里“不做校验”那句拿掉 | 1.1.9 已实现（边下边算哈希、校验失败删临时文件并换线路）；新描述保留“verified against the SHA-256 digest …”，不再出现“不校验” |
| [#14185](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14185) | 已合并 | 合并时保留了加速线路披露，并补充“摘要经镜像读取时只能发现损坏/截断”这一限定 | 两段都原样保留：线路披露 + “If api.github.com cannot be reached the digest is read through the same mirror …” |
| [#14195](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14195) | 已关闭（未合并） | **`name` 必须是 `owner/repo`**。纯显示名会让站点标题变成 `tedcriss/MATLAB Agentic Toolkit`、README 链接读成 MathWorks 官方产品；存量显示名是历史遗留，合并时会被改回；想要更直观的链接文字应改仓库名并走改名流程 | `name` 保持 `tedcriss/dsh-matlab`，本次 PR 不碰 `name`；需要更好链接文字时另走仓库改名 |
| [#14203](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14203) | 已合并 | 为条目增加 `tarball:`，指向 v1.1.9 的预构建资产（钉 tag、资产名带版本号） | 保留 `tarball` 字段，改为 `releases/latest/download/dsh-plugin-matlab.tgz`：资产名已不带版本号，正是 `contributing.md` 推荐的第一种形态；钉 tag 的 `download/<tag>/` 形态不被市场的“可随 Release 更新”识别（`release-updates.ts` 只认 `latest/download/<asset>`），会让商店永远装同一版 |

没有未处理的 inline review / review 意见：五个 PR 的 `reviews` 与 `pulls/*/comments` 都是空的，反馈都在合并说明与关闭说明里，已逐条对应到上表。

## 1. 变更背景（1.2.x）

- 商店改为从 **Release 的预构建包**安装：包约 102 KB（原 793 KB），资产名不带版本号，`latest/download` 因此不会在下一个 Release 失效，市场也能沿它识别新版本；
- 激活不再等待 `--version` 与 MCP 握手探测（改为后台诊断 `collectDiagnostics`），**通常不需要重启 DSH**：市场热挂载这一行，刷新页面即可；
- `githubProxy` 可写多个前缀，下载前用 `HEAD` 实测、最快者优先；旧工具包目录与旧资产名的二进制在替换时清掉；
- 1.2.1 修了工具包解压器的越界判断（符号链接目标比安装根短时被误判为目录内），由新增的 Release 流程在 Linux 上跑测试时发现。

## 2. 要提交的唯一文件

路径：`data/plugins/tedcriss__dsh-matlab.yml`（覆盖已有同名文件）

> **线上条目现状（2026-11-11 抓取 `awesome-dsh-plugin.com/plugins.json`）**：`tarball` 是
> `https://github.com/tedcriss/dsh-matlab/releases/download/v1.1.9/dsh-plugin-matlab-1.1.9.tgz`
> ——带版本号、钉在 1.1.9，所以商店永远装那一版；描述里还写着“安装后需重启 DSH”。本次提交把
> `tarball` 换成下面的浮动地址、把描述换成“通常无需重启”，这两处必须一起改。

```yaml
url: https://github.com/tedcriss/dsh-matlab
name: tedcriss/dsh-matlab
category: tools
tarball: https://github.com/tedcriss/dsh-matlab/releases/latest/download/dsh-plugin-matlab.tgz
description:
  en: 'Adds the MathWorks MATLAB Agentic Toolkit skills and the MATLAB MCP Server tools to DeepSeek Harness. Needs a local MATLAB R2021a or later. Installs from the plugin''s own prebuilt release archive. A DSH restart is usually unnecessary: the market mounts the plugin live, and a page refresh shows the MATLAB settings page; restart only when the market reports that the live mount failed. By default (autoProvision) it downloads the MathWorks MCP Server binary and installs the newest Agentic Toolkit release on first use. With the China download region or a configured GitHub prefix, both are fetched through the fastest measured acceleration prefix first (the plugin''s own, DSH''s market setting, or the built-in gh-proxy.com and ghfast.top routes) and then directly. The downloaded server binary is verified against the SHA-256 digest GitHub publishes for its release asset when the release metadata can be read, and a mismatch refuses the install; if api.github.com cannot be reached the digest is read through the same mirror, so the check then only catches a corrupted or truncated download. MathWorks telemetry is disabled by default; set disableTelemetry to false to re-enable it.'
  zh: '把 MathWorks 的 MATLAB Agentic Toolkit 技能与 MATLAB MCP Server 工具接入 DeepSeek Harness。需要本机 MATLAB R2021a 及以上。从插件自己的预构建 Release 包安装。通常不需要重启 DSH：市场会热挂载插件，刷新页面即可看到 MATLAB 设置页；只有市场提示热挂载失败时才需要重启。默认（autoProvision）首次使用时会下载 MathWorks MCP Server 并安装工具包的最新 Release。下载区域为 china 或配置了 GitHub 前缀时，两者都会先经实测最快的加速前缀（插件自己的、DSH 市场的，或中国区内置的 gh-proxy.com、ghfast.top）下载，失败再直连。能读取 Release 元数据时，下载的 MCP Server 二进制会按 GitHub 公布的资产 SHA-256 摘要校验，不一致就拒绝安装；api.github.com 连不上时摘要也经同一个镜像读取，这时的校验只能发现下载损坏或被截断。MathWorks 遥测默认关闭，把 disableTelemetry 设为 false 才会重新开启。'
```

说明：

- 只有 `description.en` 是必填；`zh` 已有，保持同步。
- `name` 保持 `owner/repo`：这是 #14195 关闭说明里明确的格式要求，**不要**改成 `MATLAB Agentic Toolkit` 这类显示名；想要更直观的链接文字只能走仓库改名流程。
- **`tarball` 的资产名必须不带版本号。** 商店规范要求 GitHub Release 托管的 `https` `.tgz`；`releases/latest/download/<文件名>` 只在请求时解析 `latest`，文件名是照字面取的。带版本号的名字在下一个 Release 就会 404。本仓库的 `scripts/release.mjs` 与 `.github/workflows/release.yml` 都把资产固定命名为 `dsh-plugin-matlab.tgz`，就是为了这一条。
- 这个 URL 形态也是 DSH 市场识别“可随 Release 更新”的唯一形态：它读 `raw.githubusercontent.com/tedcriss/dsh-matlab/<tag>/package.json` 核对版本，再把下一次安装指向 `releases/download/<tag>/dsh-plugin-matlab.tgz`。换成 `download/vX.Y.Z/` 也能装，但会失去自动更新。
- 描述里的每一句都对得上代码：插件不实现 MATLAB 能力（只挂载 MathWorks 的 MCP Server 与技能目录）；`autoProvision` 默认 `true`；`disableTelemetry` 默认 `true`（= 遥测关闭）；`lib/github.js` 的 `rankRoutes()` 在下载前实测加速线路；“通常不需要重启”对应市场的热挂载，且插件激活已不再等待诊断（`lib/activate.js` 的 `collectDiagnostics`）。
- 不加 `icon:`：商店回退到作者头像，`icon.svg` 仍是插件自己的图标。
- 不加 `npm:`：没有 npm 包，这一项也不允许手写；`tarball` 已覆盖“预构建安装”。

## 3. 截图：声明在**本仓库**里

商店的详情页截图不从上面那个 YAML 里写，而是读插件仓库自己的 `screenshots.json`：

- `screenshots.json` → `["assets/settings.png"]`
- `assets/settings.png` → **设置 → MATLAB 整页长截图**（1600 × 6238，含带插件版本号的状态卡、“依赖”三列表与三个按键、全部 24 个技能组、带自动发现值/示例提示的输入框、“使用当前对话的工作区目录”开关与单行单选项，以及固定在底部的保存条）

1.2.0 起截图不再进安装包（`package.json` 的 `files` 去掉 `assets` 与 `docs`），但仍在仓库里给商店读；README 的图片引用已改成绝对 URL，两处都能显示。

想换图只需替换这两个文件再推本仓库，不用到商店仓库开 PR，下一次夜间构建自动生效。

生成方式（可复现）：在 DSH Web 界面打开 设置 → MATLAB，用浏览器开发者工具把设置面板的滚动容器撑到内容高度（`overflow: visible; height: auto`），再把技能组列表的 `max-height` 去掉，然后对设置面板做整页截图（`Page.captureScreenshot`，`captureBeyondViewport`，`scale: 2`）。

## 4. PR 标题与正文

标题：

```text
Update tedcriss/dsh-matlab: prebuilt release install, no restart
```

正文：

```markdown
## What this updates

`tedcriss/dsh-matlab` (first listed in #13361, last updated in #14203) — one file, my own entry.

- **`tarball` moves to the floating, version-free form**:
  `releases/latest/download/dsh-plugin-matlab.tgz` instead of
  `releases/download/v1.1.9/dsh-plugin-matlab-1.1.9.tgz`. The asset name no longer
  carries a version, so `latest/download` cannot rot; and this is the shape
  `contributing.md` documents first. It is also the only shape a market can follow
  for updates: the archive path of a pinned `download/<tag>/` entry is not
  recognized as updatable, so the entry kept installing 1.1.9 forever.
- **The archive is now ~100 KB instead of 793 KB.** The package ships runtime files
  only (`lib/`, `client/`, `locale/`, `icon.svg`, `cordis.patch.yml`,
  `screenshots.json`); the settings screenshot and the design docs stay in the
  repository for the storefront, where `screenshots.json` already points at them.
  The asset the URL resolves to today is 104,739 bytes with SHA-256
  `4091a8bd7994bd8d716a890c3a9b60ac5ac814495cfc42a80405eb1b70b42b0c` (v1.2.3).
- **"DSH must be restarted after installing" is no longer true and is gone.**
  The market mounts this row live, and activation no longer waits for the server's
  `--version` read or its startup probe — those two process starts moved to
  background diagnostics (`lib/activate.js`, `collectDiagnostics`), which is what
  keeps a live mount inside the market's 10-second budget. A restart is now only
  the fallback when the market itself reports that its live mount failed.
- **Route and checksum disclosures are kept**, as added on merge in #14160/#14185:
  the China region / configured prefix path is still described, and the
  SHA-256 verification against the release asset's published digest is still there,
  including the limit that a digest read through a mirror only catches a corrupted
  or truncated download. The plugin also measures the available prefixes with a
  `HEAD` before each download and uses the fastest first (`lib/github.js`,
  `rankRoutes`), which is what the "fastest measured acceleration prefix" sentence
  says now.

## Review feedback carried forward

- #14160 asked for digest verification; it landed in 1.1.9, and the description no
  longer says the binary is run unchecked.
- #14185's mirror-digest caveat is preserved verbatim in meaning.
- #14195 (closed): `name` stays `tedcriss/dsh-matlab`. No display name is proposed;
  a friendlier label would need a repository rename and its rename flow, which is
  out of scope here.
- #14203 introduced `tarball`; this PR keeps the field and only changes it to the
  version-free floating URL described above.
- The package is not on npm, so the store's `version` and `downloads` fields stay
  empty; the release archive is the prebuilt install path, not a claim of a
  published npm package.

## Checklist

- [x] Changed one file: `data/plugins/tedcriss__dsh-matlab.yml` (my own entry)
- [x] `name` is still `owner/repo` (per #14195)
- [x] `package.json` still declares `dsh.bundle` (`cordis.patch.yml` inserts the
      `matlab-agentic` row)
- [x] `tarball` is an https `.tgz` on this repository's own GitHub Release, with a
      version-free asset name; the pinned v1.1.9 URL is gone
- [x] Description checked against the code (`autoProvision`, `disableTelemetry`,
      `rankRoutes`, `collectDiagnostics`)
- [x] Screenshots still declared in the plugin repository, GitHub-hosted, relative path
- [x] No README hand-edits
```

## 提交前自查

1. `package.json` 的 `dsh.bundle` 仍在（CI 第一步会读它）；
2. 仓库满 1 天（早已满足）；
3. `screenshots.json` 指向的文件确实在 `main` 上（`assets/settings.png`）；
4. PR 只改 `data/plugins/tedcriss__dsh-matlab.yml` 一个文件，不动别人的条目与生成的 README；
5. `tarball` 指向的资产在最新 Release 上确实存在，且直连可下载：
   `curl -sIL "https://github.com/tedcriss/dsh-matlab/releases/latest/download/dsh-plugin-matlab.tgz?cb=1" | head -1`；
6. 描述与代码一致：`autoProvision` 默认 `true`、`disableTelemetry` 默认 `true`、加速线路实测择优、安装后通常无需重启；
7. `name` 仍是 `owner/repo`（#14195 的关闭说明）；
8. 条目里没有 `npm:`/`icon:` 这类不允许手写或会引入不可担保外链的字段。

已用商店自己的校验器跑过本次条目（`scripts/lib/entries.mjs` 的 `readEntries` + `validateEntries`，本地用 DSH 自带的 js-yaml）：**0 个问题**，`tarballProblem()` 返回 `null`。

## 5. 审核后的提交方式

三种等价方式，任选其一：

**A. 应用现成的 patch（推荐）**——[docs/store-pr.patch](store-pr.patch) 是针对商店仓库 `main` 的一个提交，标题、正文与条目改动都在里面：

```bash
git clone git@github.com:awesome-dsh-plugin/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b update/tedcriss-dsh-matlab
git am /path/to/dsh-matlab/docs/store-pr.patch
git push <你的 fork> HEAD:update/tedcriss-dsh-matlab
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --base main \
  --head <你的 fork>:update/tedcriss-dsh-matlab --fill
```

`--fill` 会直接用这个提交的标题与正文，不再需要另写。若 `main` 已经前进导致补丁冲突，先 `git pull --rebase`，再用 `git am -3` 应用。

**B. 直接复制文件**——[docs/store-entry.yml](store-entry.yml) 就是 `data/plugins/tedcriss__dsh-matlab.yml` 的完整内容；GitHub 网页编辑器粘贴即可。

**C. 手工改三个字段**——沿用线上条目，只改 `tarball` 与 `description.en` / `description.zh`（内容见 §2）。

