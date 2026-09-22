---
name: claude-code-provider
description: "Configure or troubleshoot BB-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read settings with `bb plugin config provider-claude-code`; change a declared key
with `bb plugin config provider-claude-code set <key> <value>`.

Select one of these provider IDs in the app or with `bb thread spawn --provider`:

- `claude-code` uses the full built-in tool set and is the backward-compatible
  default.
- `claude-code-builder` allows `Agent`, `AskUserQuestion`, `Bash`, `Edit`,
  `EnterPlanMode`, `EnterWorktree`, `ExitPlanMode`, `ExitWorktree`,
  `ListAgents`, `Monitor`, `NotebookEdit`, `Read`, `SendMessage`, `Skill`,
  `TaskOutput`, `TaskStop`, `WebFetch`, `WebSearch`, and `Write`.
- `claude-code-review` allows `AskUserQuestion`, `Bash`, `EnterPlanMode`,
  `ExitPlanMode`, `ListMcpResourcesTool`, `Read`, `ReadMcpResourceDirTool`,
  `ReadMcpResourceTool`, `ReportFindings`, `Skill`, `WebFetch`, and
  `WebSearch`. It is not read-only and does not change the thread's permission
  mode.
- `claude-code-simple` is an experimental full-tools variant that enables the
  simple Claude Code system prompt. Standard variants preserve any incoming
  flag value, so record the control environment when comparing results.

The profiles do not scope BB dynamic tools or MCP tools. Existing tool denials
remain effective alongside a profile allowlist.

- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- Structured plan, message editing, and compaction are supported through the
  corresponding `bb thread` commands. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.

Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.
