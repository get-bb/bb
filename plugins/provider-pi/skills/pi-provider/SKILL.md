---
name: pi-provider
description: "Inspect BB Pi provider support for message editing and context compaction."
---

# Pi provider

Pi supports editing and rerunning eligible user messages and compacting idle or
errored threads through the core `bb thread edit-message` and `bb thread compact`
commands. Inspect the thread first and use live command help for arguments.
Provider confirmation determines whether the operation completed.

Use the target host's provider catalog for available models and execution options.

Provider roots use `PI_CODING_AGENT_DIR` from the configured process environment. Project skill listing includes project environment overrides. See the agent-configuration guide for global skill installation.
