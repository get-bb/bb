Start a thread, pick Claude Code, and let it work in your repository from bb. The plugin drives the Claude Code CLI on the host machine. It streams the agent's work into the bb timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus a plan action in the composer.
- Reasoning levels from Low to Max, plus Ultracode, which turns on multi-agent workflow orchestration.
- Checkpoint forks, manual compaction, and native questions from the agent.
- Claude Code skills and provider-native CLAUDE.md or supported AGENTS.md files
  from your home directory and project.
- A prompt cache TTL choice for each thread (Automatic, 5 minutes, or 1 hour) in the model picker.
- Token usage for each API request, with cache writes split by 5-minute and 1-hour lifetime, in thread events for plugins to read.
- Health, usage, and install status for Claude Code on each host, with an install or update action.

## Settings

- `Claude Code memory`: let Claude Code read and write its auto-memory.
- `Disable provider subagents`: hide native Agent, Task, and ListAgents tools so the agent delegates through bb. Changes restart Claude before the next turn, preserving the conversation.
- `Disable Workflow tool`: hide the native Workflow tool.
- `Claude in Chrome`: start Claude Code with the browser tools.

## Requirements

- Install the Claude Code CLI (`claude`) on the host machine. The plugin can run the installer for you.
- Sign in with `claude` on that machine. bb reads the sign-in state to show account and plan.
- `Claude in Chrome` needs the Chrome extension and a claude.ai login on the host.
