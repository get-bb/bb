---
kind: instruction
title: bb Guide — Providers
summary: Command reference for discovering providers and models.
intent: Provide complete provider command documentation for agents.
editingNotes: Keep flags accurate against the CLI implementation.
---
Provider commands

Providers are agent backends (e.g., codex, claude-code). Each supports different models.

  bb provider list                        List available providers
  bb provider models [providerId]         List models for a provider

Use these before spawning threads if you are unsure which provider or model to use.
When provider and model are omitted from bb thread spawn, the project's remembered
defaults apply.

Known ACP agents can appear automatically when their CLI is installed on the
host. For example, opencode or omp on PATH appears as provider acp-opencode or
acp-omp.

Custom ACP agents are configured in the app data-dir config.json under
customAcpAgents. bb derives provider id acp-<id> from each slug id. Edit the JSON
and run bb-app config refresh; there is no set/unset CLI surface for this list.
Custom config wins if it uses the same provider id as a known ACP agent; for
example, override acp-opencode with id opencode.
