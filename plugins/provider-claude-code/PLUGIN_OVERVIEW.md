Start a thread, pick Claude Code, and let it work in your repository from bb. The plugin drives the Claude Code CLI on the host machine. It streams the agent's work into the bb timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus a plan action in the composer.
- Reasoning levels from Low to Max, plus Ultracode, which turns on multi-agent workflow orchestration.
- Checkpoint forks, manual compaction, and native questions from the agent.
- Claude Code skills and provider-native CLAUDE.md or supported AGENTS.md files
  from your home directory and project.
- Health, usage, and install status for Claude Code on each host, with an install or update action.

## Provider profiles

- `claude-code` keeps the complete Claude Code built-in tool set and remains
  the default choice.
- `claude-code-builder` allows `Agent`, `AskUserQuestion`, `Bash`, `Edit`,
  `EnterPlanMode`, `EnterWorktree`, `ExitPlanMode`, `ExitWorktree`,
  `ListAgents`, `Monitor`, `NotebookEdit`, `Read`, `SendMessage`, `Skill`,
  `TaskOutput`, `TaskStop`, `WebFetch`, `WebSearch`, and `Write`.
- `claude-code-review` allows `AskUserQuestion`, `Bash`, `EnterPlanMode`,
  `ExitPlanMode`, `ListMcpResourcesTool`, `Read`, `ReadMcpResourceDirTool`,
  `ReadMcpResourceTool`, `ReportFindings`, `Skill`, `WebFetch`, and
  `WebSearch`. This is a context-reduction profile, not a read-only security
  boundary; the selected bb permission mode still controls access.
- `claude-code-simple` is an experimental full-tools comparison that enables
  Claude Code's simple system prompt. It does not combine with the builder or
  review profile. Standard variants preserve the incoming environment; record
  the control flag value when comparing results.

Choose a profile in the provider picker or pass its ID to
`bb thread spawn --provider`. Profile allowlists apply only to Claude Code's
built-in tools. BB dynamic tools and MCP tools are unchanged, and configured
tool denials remain in force.

## Settings

- `Claude Code memory`: let Claude Code read and write its auto-memory.
- `Disable provider subagents`: hide the native Task tool so the agent delegates through bb.
- `Disable Workflow tool`: hide the native Workflow tool.
- `Claude in Chrome`: start Claude Code with the browser tools.

## Requirements

- Install the Claude Code CLI (`claude`) on the host machine. The plugin can run the installer for you.
- Sign in with `claude` on that machine. bb reads the sign-in state to show account and plan.
- `Claude in Chrome` needs the Chrome extension and a claude.ai login on the host.
