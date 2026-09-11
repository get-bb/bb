---
name: claude-code-provider
description: "Configure or troubleshoot BB-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read settings with `bb plugin config provider-claude-code`; change a declared key
with `bb plugin config provider-claude-code set <key> <value>`.

- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- Structured plan, message editing, and compaction are supported through the
  corresponding `bb thread` commands. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.

Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.

## Discoverable usage

The bundled Provider usage sources plugin adapts this provider’s maintenance data into cheap `provider-usage.v1.listResources` inventory and `provider-usage.v1.getResource` measurements for independent usage displays. Fetch takes `{ resourceId, refresh }` and returns actual usage for that resource even when refresh is false; listing never collects quota. Inspect its descriptions and input/output JSON Schemas with `bb plugin rpc inspect provider-usage-sources --method provider-usage.v1.listResources --json`. The settings Usage limits page discovers these sources; the existing `bb settings usage` command continues to show host-provider maintenance data.
