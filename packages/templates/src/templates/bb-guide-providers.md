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
turn before it produces output or possible side effects, the plugin waits in
memory until the reported reset plus a short buffer, then starts one agent-only
`Please continue.` turn on the existing provider conversation. Threads sharing
a machine/provider subscription are released one at a time. Provider-native
retries remain authoritative while the provider reports that it will retry on
its own.

  bb settings usage [--machine <id-or-name>]       Read live provider usage
  bb provider-retry status [thread-id] [--json]    Inspect in-memory waits
  bb provider-retry refresh <thread-id> [--json]   Refresh live usage
  bb provider-retry now <thread-id> [--json]       Continue now if still safe
  bb provider-retry cancel <thread-id> [--json]    Cancel automatic continuation
  bb thread retry [id] [--request-id <id>]         Guarded core continuation

Timed waits exist only while the current bb server/plugin process remains
running. Disabling/reloading the plugin or restarting the server clears them;
the original failed thread remains available for `bb thread retry`. Credit and
spend-control exhaustion without a reset time is shown but never blindly
retried. Use Refresh after adding credits or changing limits, or Retry now when
the user explicitly wants another safe attempt.

Claude Code's native Workflow tool can be disabled separately on its provider
page. This preference also defaults off and applies to newly started, resumed,
or forked provider sessions.

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, opencode, omp, Grok Build's grok CLI, or Hermes' hermes CLI
on PATH appears as provider acp-opencode, acp-omp, acp-grok, or
acp-hermes-agent.

Custom ACP agents are configured in the app data-dir config.json under
customAcpAgents. bb derives provider id acp-<id> from each slug id. Edit the JSON
and run bb-app config refresh; there is no set/unset CLI surface for this list.
Custom config wins if it uses the same provider id as a known ACP agent; for
example, override acp-opencode with id opencode. Use modelCli for CLI model
listing/selection, reasoningCli for launch-time reasoning flags, and
nativeReasoning for ACP session/set_config_option reasoning. Optional logo
accepts an SVG, PNG, or WebP path; relative paths resolve from the bb data dir.
