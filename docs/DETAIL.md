# MATLAB Agentic Toolkit

Brings MathWorks' own MATLAB capability surface into DSH without reimplementing it.

## What it adds

- **Tools** from the MATLAB MCP Server, registered as `mcp__matlab__<tool>`: `evaluate_matlab_code`, `run_matlab_file`, `run_matlab_test_file`, `check_matlab_code`, `detect_matlab_toolboxes`, plus the two `guidelines://` resources.
- **Skills** from the MATLAB Agentic Toolkit, loaded straight from `skills-catalog/<group>` with `dsh-skill-filesystem`. Every group is loaded by default (24 groups, 158 skills for the MATLAB toolkit); list group names in `skillGroups` to load fewer.
- **Simulink** groups and its `tools/tools.json` MCP extension, when the Simulink Agentic Toolkit is installed alongside.
- **A Settings page** (`Settings → MATLAB`) for the connection state, per-group skill switches (a scrollable two-column list; required groups stay locked on), the MATLAB root and MCP Server path, the download route, and dependency updates — saved through DSH's own settings service, applied without a restart. MathWorks telemetry is off by default.
- **A progress dialog** in the shell overlay while the first binary or toolkit is fetched, so a slow mirror is visible instead of looking like a hang.

## What it does not do

It runs no MATLAB code itself, copies no `SKILL.md`, and rewrites nothing under `~/.matlab`. `matlab-mcp-server` is the tool provider; the toolkit checkout is the skill provider; `dsh-mcp-client` and `dsh-skill-filesystem` are the transports.

## Requirements

MATLAB R2021a or later. The MCP Server binary and the Agentic Toolkit checkout belong to the plugin and live in `$DSH_HOME/matlab`; a MathWorks installer copy under `~/.matlab/agentic-toolkits` is deliberately not read.

A first start downloads the binary and clones the toolkit in the background, because DSH Desktop abandons a host start that has not finished within 60 seconds; `status.phase` is `provisioning` until the fetch lands and mounts, and a progress dialog shows what is happening. The Settings page can check the published versions later and replace an artifact only when a newer one exists.

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
| `githubProxy` | follows DSH | HTTPS GitHub acceleration prefix; empty reuses DSH's own setting (`DSHM_GITHUB_PROXY` or the market's custom prefix) |
| `downloadRegion` | `auto` | `china` uses the built-in accelerated routes, `global` goes direct; `auto` follows DSH's market |

On a network where github.com is slow, the first start reuses the acceleration DSH already configured instead of downloading direct: the binary and the toolkit clone both try `gh-proxy.com`, then `ghfast.top`, then the origin. Every route is bounded, so a dead mirror costs seconds rather than the whole start.

## Diagnosis

`GET /plugin/matlab/status` reports the plugin's own name and version (read from `package.json`), the resolved MATLAB root, the binary and its version, the probe result (tool and resource names), the loaded skill groups with skill counts, the GitHub acceleration in force (`github.region` / `github.routes` / `server.route`), and the warnings raised during activation.

The Settings page uses five same-origin JSON routes: `GET /plugin/matlab/{state,progress}` to read and `POST /plugin/matlab/{config,provision,update}` to write. Mutations must register as a carrier `handler`: a `resource` answers only `GET`/`HEAD`, and the carrier rejects every other method with its own 405.

Full reference: [README](../README.md). Design rationale: [DESIGN](../DESIGN.md).
