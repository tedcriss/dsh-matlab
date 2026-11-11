# MATLAB Agentic Toolkit

Brings MathWorks' own MATLAB capability surface into DSH without reimplementing it.

## What it adds

- **Tools** from the MATLAB MCP Server, registered as `mcp__matlab__<tool>`: `evaluate_matlab_code`, `run_matlab_file`, `run_matlab_test_file`, `check_matlab_code`, `detect_matlab_toolboxes`, plus the two `guidelines://` resources.
- **Skills** from the MATLAB Agentic Toolkit, loaded straight from `skills-catalog/<group>` with `dsh-skill-filesystem`. Every group is loaded by default (24 groups, 158 skills for the MATLAB toolkit); list group names in `skillGroups` to load fewer.
- **Simulink** groups and its `tools/tools.json` MCP extension, when the Simulink Agentic Toolkit is installed alongside.
- **A Settings page** (`Settings → MATLAB`) for the connection state (with the plugin version), a dependencies card (local and newest tags, with check / download-the-newest / delete-local actions, the destructive one behind a confirmation), per-group skill switches (a scrollable two-column list; required groups stay locked on), the MATLAB root and MCP Server path, the download route, and a switch that runs each MATLAB call in the calling conversation's workspace folder — saved through DSH's own settings service, applied without a restart. MathWorks telemetry is off by default.
- **A progress dialog** in the shell overlay while the first binary or toolkit release is fetched, so a slow mirror is visible instead of looking like a hang.

## What it does not do

It runs no MATLAB code itself, copies no `SKILL.md`, and rewrites nothing under `~/.matlab`. `matlab-mcp-server` is the tool provider; the toolkit is the skill provider; `dsh-mcp-client` and `dsh-skill-filesystem` are the transports.

## Requirements

MATLAB R2021a or later. The MCP Server binary and the Agentic Toolkit (the newest release's source archive, for example `MATK-2026.11.a`) belong to the plugin and live in `$DSH_HOME/matlab`; a MathWorks installer copy under `~/.matlab/agentic-toolkits` is deliberately not read, and nothing is cloned, so `git` is not required.

The store installs this plugin from the prebuilt `dsh-plugin-matlab.tgz` attached to every release of this repository (about 100 KB, declares `dsh.bundle`, runs no install script) instead of the whole repository source. After installing, the market mounts the `matlab-agentic` row live, so a **DSH restart is normally not needed** — refresh the page; restart only when the market reports that the live mount failed.

A first start downloads the binary and installs the toolkit release in the background, because DSH Desktop abandons a host start that has not finished within 60 seconds; `status.phase` is `provisioning` until the fetch lands and mounts, and a progress dialog shows what is happening. The Settings page can check the published releases later — it shows the local tag and the newest published tag side by side — and replaces an artifact only when the two differ; a catalog left by another release and a binary under an older asset name are replaced or removed on the way.

## Settings worth knowing

| Setting | Default | Effect |
| --- | --- | --- |
| `skillGroups` | every group | Which `skills-catalog` groups to load; empty loads all |
| `sessionMode` | `auto` | `existing` reuses a MATLAB that ran `shareMATLABSession()` |
| `matlabRoot` | discovered | Which MATLAB the server starts |
| `displayMode` | `desktop` | `nodesktop` runs without the MATLAB desktop |
| `toolCallTimeoutMs` | 600000 | Simulations and test suites exceed the DSH default |
| `agentName` | `DeepSeek` | The name MATLAB prints when the agent connects |
| `disableTelemetry` | `true` | Passes `--disable-telemetry=true`; no data is sent to MathWorks by default |
| `githubProxy` | follows DSH | HTTPS GitHub acceleration prefixes, comma-separated and measured before a download; empty reuses DSH's own setting (`DSHM_GITHUB_PROXY` or the market's custom prefix) |
| `downloadRegion` | `auto` | `china` uses the built-in accelerated routes, `global` goes direct; `auto` follows DSH's market |

On a network where github.com is slow, the first start reuses the acceleration DSH already configured instead of downloading direct: the binary and the toolkit release archive both try `gh-proxy.com`, then `ghfast.top`, then the origin. Every route is bounded, so a dead mirror costs seconds rather than the whole start. Before a download the plugin measures the accelerated routes with a `HEAD` and moves the fastest first, so the order is a measurement rather than a guess; `githubProxy` accepts several prefixes and they join the same measurement.

Because the downloaded binary is executed, the install no longer trusts a mirror with it: the published release asset's `sha256` digest is read from `api.github.com` (direct first, so the mirror cannot also be the only source of the hash), the body is hashed while it streams to a temporary file, and a mismatch deletes the file and refuses the install. The release's byte count and the response's `content-length` are checked too. The toolkit archive has no upstream digest to compare, so it is checked for a complete transfer and a valid gzip/tar structure before it replaces the catalog.

## Diagnosis

`GET /plugin/matlab/status` reports the plugin's own name and version (read from `package.json`), the resolved MATLAB root, the binary and its version, which release the local toolkit came from (`toolkitRelease.tag`), the probe result (tool and resource names), the loaded skill groups with skill counts, the GitHub acceleration in force (`github.region` / `github.routes` / `server.route`), and the warnings raised during activation.

The Settings page uses six same-origin JSON routes: `GET /plugin/matlab/{state,progress}` to read and `POST /plugin/matlab/{config,provision,update,dependencies}` to write. Mutations must register as a carrier `handler`: a `resource` answers only `GET`/`HEAD`, and the carrier rejects every other method with its own 405. A mutation answers only after DSH has committed it, and `state` is projected from that committed config rather than the last-applied snapshot, so a page that reloads immediately after saving already sees the stored values.

Full reference: [README](../README.md). Design rationale: [DESIGN](../DESIGN.md).
