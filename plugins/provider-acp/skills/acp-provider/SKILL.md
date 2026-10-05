---
name: acp-provider
description: "Configure or troubleshoot ACP agent discovery, custom models, skills, and compaction in BB."
---

# ACP providers

Known agents can be discovered automatically when their CLI is installed on the
host: `opencode`, `omp`, `grok`, and `hermes` appear as `acp-opencode`, `acp-omp`,
`acp-grok`, and `acp-hermes-agent`. Inspect the target host's catalog with
`bb provider list` and `bb provider models <provider-id>` using its environment
or machine selector.

To hide a detected ACP agent, use `bb provider disable acp-opencode`, or Disable
on Settings → Providers. Restore it with `bb provider enable acp-opencode`.
This leaves other ACP agents and the host CLI intact. Disabled agents skip
background capability probing. `bb provider list --all` includes disabled agents.

Cursor project skills come from `.cursor/skills`, which can link to
`.agents/skills`. BB lists these linked skills as read-only under `cursor-project`.

ACP agents report their own models and may reject unlisted model IDs.
For `acp-opencode` the list mirrors the OpenCode catalog, so add a model to
the OpenCode config rather than bb's `customModels`:

```sh
bb provider models acp-opencode --environment "$BB_ENVIRONMENT_ID"
bb thread spawn --provider acp-opencode --model <provider/model>
```

OpenCode agents are session modes, not models selectable through BB's model
field. Grok Build advertises models and `thought_level` options over ACP, so
the picker follows the connected agent (including `xhigh` on grok-4.6).

BB launches OpenCode sessions with `OPENCODE_CLIENT=acp` and
`OPENCODE_ENABLE_QUESTION_TOOL=false`, overriding inherited and custom launch
values. Native questions have no ACP interaction handler in BB; agents use the
ask-user-question plugin’s `AskUserQuestion` tool instead. This also applies to
custom agents with `dialect: "opencode"` and does not change OpenCode config files.

OpenCode and Grok ACP support the core `bb thread compact` command; Cursor ACP
does not expose compatible compaction. Check the actual agent's capabilities
before attempting provider-specific recovery.

OpenCode Go subscription usage is available in Provider usage when the selected
machine has OpenCode installed and a Go subscription. Sign in to Go in OpenCode
on that machine, then refresh its OpenCode tab. Verify with
`bb settings usage --machine <id-or-name> --json`; the SDK equivalent is
`bb.sdk.system.usageLimits({ hostId, providerId: "acp-opencode" })`.
BB reports Go's five-hour, weekly, and monthly usage and reset times, not local
session token totals or other OpenCode providers' subscriptions.

The collector checks `OPENCODE_API_KEY`, then the active official Console account
and organization in `$XDG_DATA_HOME/opencode/opencode.db`, then active v2
`credential` table API keys or official Console OAuth credentials
(`opencode-go` before `opencode`), then
`OPENCODE_AUTH_CONTENT` or `$XDG_DATA_HOME/opencode/auth.json`.
The default data directory is `~/.local/share/opencode`. Database storage is read
only; expired Console sessions must be refreshed by OpenCode. V2 OAuth requires
the device login method and account/organization metadata for the official
Console server. API-key login
prefers the `opencode-go` credential and accepts the shared `opencode` credential
when Go is subscribed. Custom launch `env` values take precedence over the host
environment. A custom OpenCode wrapper must declare
`dialect: "opencode"` and `providerUsage: true` to expose its usage.
Missing credentials, rejected keys, and collection errors remain unavailable
states rather than zero usage. Never print API keys when diagnosing setup.

## Custom ACP agents

Register another ACP agent in the ACP providers plugin's `customAgents`
setting, a JSON array:
`bb plugin config provider-acp set customAgents '[...]'`. The plugin
re-registers its providers as soon as the setting changes; no restart is
needed.

- Required: `id` (lowercase letters, digits, and dashes; permanent),
  `displayName`, and `command`. The provider id is `acp-<id>`. `cursor` is
  reserved; an entry with id `opencode`, `omp`, `grok`, or `hermes-agent`
  replaces the shipped agent.
- Launch: `args`, `env`, and `cwd`.
- `modelCli` for CLI model listing and selection, `reasoningCli` for
  launch-time reasoning flags, `nativeReasoning` for ACP
  `session/set_config_option` reasoning, and `permissionCli` for
  permission-mode launch flags.
- `dialect` (`cursor`, `opencode`, `omp`, or `grok`) selects the vendor side
  channels bb reads.
- `nativeSkillRoots` adds native skills to the composer: a `user` list resolved
  from the target host's home directory and a `project` list resolved from the
  workspace, each a relative path without dot segments.
- `supportsManualCompaction` (default `false`) shows `/compact` only for agents
  that accept an explicit compaction request.
