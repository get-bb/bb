---
name: codex-provider
description: "Diagnose BB-specific Codex session controls, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `bb thread` commands.
`bb thread clear-goal <id>` clears its durable active Goal and waits for provider
confirmation. Inspect the thread before recovery actions.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Inspect models on the actual execution host with
`bb provider models codex` using the machine or environment selector.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.

## Discoverable usage

This plugin exposes cheap `provider-usage.v1.listResources` inventory and `provider-usage.v1.getResource` measurements for independent usage displays. Fetch takes `{ resourceId, refresh }` and returns actual usage for that resource even when refresh is false; listing never collects quota. Inspect its descriptions and input/output JSON Schemas with `bb plugin rpc inspect provider-codex --method provider-usage.v1.listResources --json`. The settings Usage limits page discovers these sources; the existing `bb settings usage` command continues to show host-provider maintenance data.
