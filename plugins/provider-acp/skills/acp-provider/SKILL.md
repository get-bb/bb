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

Cursor project skills come from `.cursor/skills`, which can link to
`.agents/skills`. BB lists these linked skills as read-only under `cursor-project`.

ACP agents may reject unlisted model IDs. OpenCode requires models in its own
configuration; BB discovers them there. OpenCode agents are session modes, not
models selectable through BB's model field. Grok Build advertises models and
`thought_level` options over ACP, so the picker follows the connected agent
(including `xhigh` on grok-4.6).

OpenCode ACP supports the core `bb thread compact` command; Cursor ACP does not
expose compatible compaction. Check the actual agent's capabilities before
attempting provider-specific recovery.

OpenCode Go subscription usage is available in Provider usage when the selected
machine has OpenCode installed and a Go subscription. Sign in to Go in OpenCode
on that machine, then refresh its OpenCode tab. Verify with
`bb settings usage --machine <id-or-name> --json`; the SDK equivalent is
`bb.sdk.system.usageLimits({ hostId, providerId: "acp-opencode" })`.
BB reports Go's five-hour, weekly, and monthly usage and reset times, not local
session token totals or other OpenCode providers' subscriptions.

The collector checks `OPENCODE_API_KEY`, then the active official Console account
and organization in `$XDG_DATA_HOME/opencode/opencode.db`, then
`OPENCODE_AUTH_CONTENT` or `$XDG_DATA_HOME/opencode/auth.json`.
The default data directory is `~/.local/share/opencode`. Account storage is read
only; expired Console sessions must be refreshed by OpenCode. API-key login
prefers the `opencode-go` credential and accepts the shared `opencode` credential
when Go is subscribed. Custom launch `env` values take precedence over the host
environment. A custom OpenCode wrapper must declare
`dialect: "opencode"` and `providerUsage: true` to expose its usage.
Missing credentials, rejected keys, and collection errors remain unavailable
states rather than zero usage. Never print API keys when diagnosing setup.
