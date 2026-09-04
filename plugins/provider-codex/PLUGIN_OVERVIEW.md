Start a thread, pick Codex, and let it write and review code in your repository from bb. The plugin drives the Codex CLI on the host machine. It streams the agent's work into the bb timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus plan and goal actions in the composer.
- Reasoning levels from Low to Ultra. Ultra adds automatic task delegation.
- GPT-6 Astra and other models reported by the host's Codex CLI.
- A service tier picker with two tiers.
- Checkpoint forks, manual compaction, thread rename, and thread archive.
- Codex skills from your home directory and project, listed next to bb skills.
- Health, usage, and install status on each host, with an install or update action.
- A Codex AI service for inference and voice that other bb features can use.

## Settings

- `Codex memory`: let Codex recall and create memories from bb threads.
- `Disable provider subagents`: stop native subagents so the agent delegates through bb.

## Requirements

- Install the Codex CLI (`codex`) on the host machine, version 0.153.4 or newer. This version exposes GPT-6 Astra in the model catalog. The plugin can run the npm install for you; run `codex update` if the installed version is older.
- Sign in with `codex login` on that machine. A ChatGPT account or an OpenAI API key both work.
- Usage limits show only for ChatGPT accounts.
