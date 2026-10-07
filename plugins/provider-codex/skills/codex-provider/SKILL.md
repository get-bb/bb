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

Service tiers are `default`, `fast`, and `ultrafast`. Codex reports the tiers
each model accepts for the signed-in account, so the model picker and
`bb provider models codex` (Service tiers column, `supportedServiceTiers` in
`--json`) list Ultrafast only for eligible models and accounts. Pass the id to
`--service-tier` on `bb thread spawn` or `bb thread tell`; bb sends an explicit
tier to Codex as given. When the model does not list it, Codex runs the turn
at its default tier and the thread shows its warning that the tier "is not
advertised as supported" and was omitted.

Daybreak is the `daybreak` model option (`off` or `on`). `bb provider models
codex` lists, per model, the values Codex's catalog allows for the signed-in
account (`experimental_supportedModelOptions` in `--json`); models without
Daybreak accept only `off`, and the Daybreak alias models accept only `on`
and are listed only as selected-only once another model offers Daybreak. Pass
`--model-option daybreak=on` to `bb thread spawn` or `bb thread tell`; later
turns keep the thread's value until it changes. With Daybreak on, bb requests
the model's Daybreak program (Daybreak Blue before Red) on each turn and
refuses the turn with "Daybreak isn't available for <model>" when the model
has none. OpenAI still checks access on every request.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.
