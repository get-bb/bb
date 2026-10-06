---
kind: instruction
title: bb Guide — Providers
summary: Command reference for discovering providers and models.
intent: Provide complete provider command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Provider commands

Providers are agent backends (e.g., codex, claude-code). Each supports different models.

  bb provider list [--machine <id-or-name> | --environment <id>]
                                          List available providers
  bb provider models [providerId] [--machine <id-or-name> | --environment <id>]
                                          List models for a provider

Use these before spawning threads if you are unsure which provider or model to use.
`--host` is an alias for `--machine`. Machine and environment selectors are
mutually exclusive because an environment already selects its machine. When no
selector is supplied, both commands intentionally inspect the server machine.
`bb guide threads` describes how `bb thread spawn` picks a default provider and
model.

Service tiers are provider-defined ids. `bb provider list --json` reports each
provider's `serviceTiers` ({id, label, description?}); `default` always means
the provider's standard tier. A model may narrow that list: `bb provider
models` shows a Service tiers column, and `--json` reports
`supportedServiceTiers` per model (absent when the provider does not report
tiers per model, in which case the model accepts every tier the provider
lists). Pass a tier id to `--service-tier`; a tier the provider does not list
is rejected.

Model lists answer from the machine's last stored list while a background
refresh runs, so a list can be hours old. A provider whose refresh keeps
failing or timing out keeps answering from its last stored list.

When no list can be served, bb provider models prints the failing provider,
the failure code, and the underlying host message on stderr, then reports the
empty catalog on stdout. The model pickers show the same underlying message
beneath their summary line.

Enabling and disabling providers

Manage agents in Settings → Providers. Install provider plugins in Settings →
Plugins.

  bb provider disable <id>
  bb provider enable <id>
  bb provider list --all

Disable hides one provider from pickers and the ordinary list and rejects new
sessions and turns. It preserves its CLI, plugin, siblings and thread history;
in-flight turns can finish. Enable also enables its supplying plugin if needed,
while preserving other providers' individual opt-outs. list --all shows the global
catalog including disabled plugins, without machine/environment selectors.
SDK: providers.catalog() and providers.setEnabled({ providerId, enabled }).
Enable restores automatic discovery, so installed-only agents again appear only
where their CLI is installed. Disabling the default clears its selection; new
threads use the next enabled provider in saved order, including in projects whose
last-used provider is disabled. Explicit or existing-thread choices never
silently switch.

Provider-native memory can be controlled on the separate Settings → Providers
→ Codex and Settings → Providers → Claude Code pages. Codex memory controls
both recall (`memories.use_memories`) and future generation
(`memories.generate_memories`). Claude Code memory controls native auto-memory
reads and writes (`autoMemoryEnabled`). Both preferences default on and apply
when a provider thread is started, resumed, or forked; they do not interrupt
an active turn. These settings are separate from bb's optional Memory plugin,
an official plugin bundled with the app.

Provider-native subagents can also be disabled on those provider pages: Codex
loses its native multi-agent feature and Claude Code its native Task tool. The preferences default off and apply
when a provider thread is started, resumed, or forked; they do not modify the
provider's global configuration.

Claude Code's native Workflow tool can be disabled separately on its provider
page. This preference also defaults off and applies to newly started, resumed,
or forked provider sessions. Claude Code plugin settings (`disable1MContext`,
`chromeEnabled`, `sandboxEnabled`) are set with
`bb plugin config provider-claude-code set <key> <value>` and documented in the
claude-code-provider skill.

Automatic retries after provider overloads and subscription-window limits
come from the bundled Provider retry plugin (`bb provider-retry status`); see
`bb guide plugins`. For a manual retry of a failed turn, use `bb thread retry`.

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, opencode, omp, Grok Build's grok CLI, or Hermes' hermes CLI
on PATH appears as provider acp-opencode, acp-omp, acp-grok, or
acp-hermes-agent. The acp-provider skill covers OpenCode launch settings,
OpenCode Go usage, and per-agent compaction support.

bb indexes the native user and project skill roots for Codex, Claude Code, Pi,
Cursor, OpenCode, omp, Grok Build, and Hermes Agent. This includes compatibility
roots such as .agents/skills and .claude/skills when the provider supports them.
It also includes project ancestor roots for providers that search to the Git
repository root. Configured Pi, omp, Grok, and Hermes directories are included.
Enabled provider plugins also contribute skills to the selected provider's `/`
command menu. `bb skill list` shows native skills for Claude Code, Codex, and
Cursor.

ACP agents (acp-*), including custom agents set in the ACP providers plugin's
customAgents setting, are documented in the acp-provider skill.

Top-level customModels in the app data-dir config.json adds extra picker
entries. Each entry has a providerId (a built-in provider id or any acp-*
provider id), a model id, and an optional displayName. bb skips an invalid
entry with a warning. The entry then appears in bb provider models output and
in the model picker, but the provider must still accept the id: claude-code
and codex accept unlisted ids, while an ACP agent can reject an id it does
not know at session start. OpenCode rejects unlisted ids, so add an OpenCode
model to the OpenCode config instead. Edit the JSON and run bb-app config
refresh; there is no set/unset CLI surface. The streamerMode
General setting hides every entry from these lists; see the customization
chapter.

Use top-level sharedSkillRoots for one provider-neutral skill collection. The
user and project paths use the same relative-path rules. bb indexes these roots
as read-only sources. It then injects the selected skills into all providers.
The bb user and project roots keep higher precedence than matching shared roots.
