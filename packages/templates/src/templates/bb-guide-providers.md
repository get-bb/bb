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
selector is supplied, both commands intentionally inspect the primary machine.
When provider and model are omitted from bb thread spawn, the project's
remembered defaults apply. If the project has no remembered choice, bb uses
the explicitly requested provider or Codex, then resolves the model marked
default by that provider on the target machine (falling back to the first
catalog model when none is marked).

Provider-native memory can be controlled on the separate Settings → Providers
→ Codex and Settings → Providers → Claude Code pages. Codex memory controls
both recall (`memories.use_memories`) and future generation
(`memories.generate_memories`). Claude Code memory controls native auto-memory
reads and writes (`autoMemoryEnabled`). Both preferences default on and apply
when a provider thread is started, resumed, or forked; they do not interrupt
an active turn. These settings are separate from bb's optional Memory plugin,
an official plugin bundled with the app.

Provider-native subagents can also be disabled on those provider pages. For
Codex, bb turns off the native multi-agent feature and caps V2 sessions at the
root thread so remote session policy cannot start a child. For Claude Code, bb
removes the native Task tool. The preferences default off and apply
when a provider thread is started, resumed, or forked; they do not modify the
provider's global configuration.

Subscription limit recovery

The opt-in builtin Provider retry plugin recognizes structured Codex and Claude
Code subscription windows. Enable it under Extensions → Plugins or run
`bb plugin enable provider-retry`. If a provider terminally rejects an accepted
turn whose execution settings remain available, the plugin waits in memory
until the reported reset plus a short buffer, then starts one agent-only
`Please continue.` turn on the existing provider conversation. Prior output or
tool activity does not block recovery. Threads sharing a machine/provider
subscription are released one at a time. Provider-native retries remain
authoritative while the provider reports that it will retry on its own.

Automatic waits default to a maximum of six hours. Longer reset windows are not
scheduled. Set `maximumWait` to `24 hours` or `No limit` under the plugin
settings, or run:

  bb plugin config provider-retry set maximumWait "24 hours"

  bb provider-retry status [thread-id] [--json]    Inspect in-memory waits
  bb provider-retry cancel <thread-id> [--json]    Cancel an automatic retry
  bb provider-retry retry <thread-id> [--json]     Request a manual retry

Timed waits exist only while the current bb server/plugin process remains
running. Disabling/reloading the plugin or restarting the server clears them;
the original failed thread remains available for `bb provider-retry retry`.
Credit and spend-control exhaustion without a reset time is manual-only.

Claude Code's native Workflow tool can be disabled separately on its provider
page. This preference also defaults off and applies to newly started, resumed,
or forked provider sessions.

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, opencode, omp, Grok Build's grok CLI, or Hermes' hermes CLI
on PATH appears as provider acp-opencode, acp-omp, acp-grok, or
acp-hermes-agent.

bb indexes the native user and project skill roots for Codex, Claude Code, Pi,
Cursor, OpenCode, omp, Grok Build, and Hermes Agent. This includes compatibility
roots such as .agents/skills and .claude/skills when the provider supports them.
It also includes project ancestor roots for providers that search to the Git
repository root. Configured Pi, omp, Grok, and Hermes directories are included.
Enabled provider plugins also contribute skills to the selected provider's `/`
command menu. `bb skill list` shows native skills for Claude Code, Codex, and
Cursor.

ACP providers discover models from the agent itself. For acp-opencode, the
list mirrors the OpenCode catalog, so a custom model from the OpenCode config
appears automatically. Discover and select one with:

  bb provider models acp-opencode --environment "$BB_ENVIRONMENT_ID"
  bb thread spawn --provider acp-opencode --model <provider/model>

bb applies the selected model to the ACP session before the first prompt.

An OpenCode model and an OpenCode agent are different selections. An OpenCode
agent (build, plan, or a custom primary agent such as an orchestrator) is a
session mode, not a model. bb does not select OpenCode agents; configure the
default agent in the OpenCode config and the ACP session uses it.

Top-level customModels in the app data-dir config.json adds extra picker
entries. Each entry has a providerId (a built-in provider id or any acp-*
provider id), a model id, and an optional displayName. bb skips an invalid
entry with a warning. The entry then appears in bb provider models output and
in the model picker, but the provider must still accept the id: claude-code
and codex accept unlisted ids, while an ACP agent can reject an id it does
not know at session start. OpenCode rejects unlisted ids, so add an OpenCode
model to the OpenCode config instead. Like customAcpAgents, edit the JSON and
run bb-app config refresh; there is no set/unset CLI surface.

Custom ACP agents are configured in the app data-dir config.json under
customAcpAgents. bb derives provider id acp-<id> from each slug id. Edit the JSON
and run bb-app config refresh; there is no set/unset CLI surface for this list.
Custom config wins if it uses the same provider id as a known ACP agent; for
example, override acp-opencode with id opencode. Use modelCli for CLI model
listing/selection, reasoningCli for launch-time reasoning flags, and
nativeReasoning for ACP session/set_config_option reasoning. Optional logo
accepts an SVG, PNG, or WebP path; relative paths resolve from the bb data dir.
Use nativeSkillRoots to add native skills to the composer. User roots resolve
from the target host home directory. Project roots resolve from the selected
workspace. Each root must use a relative path without dot segments. Set
supportsManualCompaction to true only if the agent accepts an explicit
compaction request; it defaults to false, and bb hides the /compact command
for agents that do not declare it.

Use top-level sharedSkillRoots for one provider-neutral skill collection. The
user and project paths use the same relative-path rules. bb indexes these roots
as read-only sources. It then injects the selected skills into all providers.
The bb user and project roots keep higher precedence than matching shared roots.

OpenCode ACP declares support for the built-in /compact command. Cursor ACP does
not expose compatible manual compaction through ACP.
