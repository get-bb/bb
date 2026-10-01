---
title: How to Move From Superset to bb
description: Move from Superset to bb in seven steps: convert your setup scripts, bring over unfinished worktrees, run a Claude Code task with a Codex review, and go back if it doesn't fit.
---

_Checked against Superset's docs and bb 0.44.0 on Sep 26, 2026. bb makes this page. Still deciding? See [bb vs Superset](/compare/bb-vs-superset)._

**The short answer:** your repo, branches, and local worktrees are plain Git, so they come with you, and bb can work inside an existing Superset worktree. Setup, teardown, and file copying map onto bb's own files; the Run button, terminal scripts, overrides, chats, tasks, and automations need handling by hand, listed below. Superset keeps working throughout, so move one project, use both for a week, and decide.

## Why People Move

Superset's agents can launch other agents too, so the difference isn't whether delegation exists. It's what you get around it:

- **Agents your agents start are threads you can open.** Ask a Claude Code thread to have Codex review its work, and the Codex run appears as its own thread, linked under the Claude thread in your sidebar. You can read the exact prompt Claude gave it, watch its tool calls, message it mid-run, and see its answer go back to Claude. Any thread can do this with any provider, in either direction, with no setup.
- **Free where Superset charges.** Phone access and automations are part of bb's free, MIT-licensed app. In Superset they're on Pro.
- **An app you change.** bb is built from plugins, and an agent in bb can write a new one for you.

What you give up: Superset's workspace layout, Run button, cloud workspaces, released iPhone app, and paid team seats. If those matter more, stay.

## Before You Start

- **Your bb machine stays on.** bb runs agents on your computer. For phone access, that computer must be on, awake, and running bb.
- **Install requirements.** The macOS app needs Apple Silicon. The `npx bb-app@latest` route needs Node.js 22.19 or later, 24, or 26. With npm 12 or later, run `npx --allow-scripts=better-sqlite3,node-pty,@parcel/watcher bb-app@latest` instead, because npm now blocks the install scripts bb needs.
- **The `bb` command.** Steps below use the `bb` CLI. If `bb` isn't on your PATH, for example after an npx install, run `npx --package bb-app bb` in its place.
- **Chats don't move.** bb doesn't import Superset's chats. Before you switch a task over, ask the Superset agent to summarise where it is, and paste that into your first bb prompt.- **Agent CLIs.** bb drives the `claude` and `codex` CLIs on your machine. If Superset launched them, they're installed. Other agents need their CLI too: `cursor-agent` for Cursor, `opencode` for OpenCode.
- **GitHub CLI.** The PR steps below use `gh`. Install it and run `gh auth login`.

## Take Stock: What Moves, What You Recreate, What Stays

| In Superset                                                                          | Outcome               | In bb                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo, branches, commits**                                                          | Moves                 | Add the same folder as a project                                                                                                                                    |
| **Local workspaces** (Git worktrees, by default under `~/.superset/worktrees/`)      | Moves                 | Reuse the worktree in place, or branch from it (step 4)                                                                                                             |
| **Uncommitted changes**                                                              | Moves only in place   | Reuse the worktree, or commit first                                                                                                                                 |
| **Cloud workspaces**                                                                 | Stay                  | No direct equivalent. bb's experimental Modal sandbox plugin runs single-user machines in your own Modal account                                                    |
| **Sessions with no project**                                                         | Recreate              | Start a bb thread with no project and choose **Personal workspace**                                                                                                 |
| **`setup`, `teardown`** (repo, workspace, or user override, or `.superset/setup.sh`) | Recreate              | `.bb-env-setup.sh`, `.bb-env-teardown.sh` (step 3)                                                                                                                  |
| **Files copied from `$SUPERSET_ROOT_PATH`**                                          | Recreate              | `.worktreeinclude` (step 3)                                                                                                                                         |
| **`run`, the Run button, `cwd`**                                                     | No equivalent         | Start servers in the thread's terminal, or ask the agent to                                                                                                         |
| **Terminal scripts**                                                                 | No equivalent         | Keep them as shell scripts or aliases                                                                                                                               |
| **Environment variables**                                                            | Recreate              | Settings → Environment variables, for all projects or one                                                                                                           |
| **Claude Code: `CLAUDE.md`, `~/.claude`, `~/.claude.json`, `.mcp.json`**             | Moves                 | bb's Claude Code threads read the same files                                                                                                                        |
| **Codex: `AGENTS.md`, `~/.codex/config.toml`, `.codex/config.toml`**                 | Moves                 | bb's Codex threads read the same files                                                                                                                              |
| **Instructions for every agent**                                                     | Optional              | `.bb/AGENTS.md` at the repo root is added to every bb thread, whatever the agent                                                                                    |
| **Default agent, model, and permission choices**                                     | Recreate              | Pick them when starting a thread; bb remembers them per project                                                                                                     |
| **Extra account profiles** (more than one Claude or Codex login)                     | Recreate              | bb uses each CLI's default login (step 1). The experimental Account Pooler plugin spreads work across several accounts with fallback; you don't pick one per thread |
| **Superset's agent hooks**                                                           | Stay                  | They do nothing outside Superset terminals                                                                                                                          |
| **Tasks** (native, or synced from Linear)                                            | Recreate native tasks | Tasks plugin (step 6). Linear stays in Linear                                                                                                                       |
| **Automations**                                                                      | Recreate              | bb Automations (step 6)                                                                                                                                             |
| **Scripts using Superset's CLI, SDK, or MCP server**                                 | Rewrite               | `bb` CLI and HTTP API                                                                                                                                               |
| **Chats**                                                                            | Stay                  | bb doesn't import them; carry a summary over (see Before You Start)                                                                                                 |

## Move In Seven Steps

### 1. Install bb

[Download for macOS](/download/macos) · [Download for Linux (alpha)](/download/linux) · or run `npx bb-app@latest` on Intel Macs and Windows (WSL2).

Check each agent is signed in: `claude`, `codex login`, and, if you use them, `cursor-agent login` or `opencode auth login`. If an agent's CLI is missing, bb's composer shows an **Install** button. bb uses each CLI's default login, in `~/.claude` and `~/.codex`. If your Superset profile pointed a CLI at another folder (`CLAUDE_CONFIG_DIR` or `CODEX_HOME`), sign in again with the commands above and check the account before your first thread.

### 2. Add your repo as a project

In bb, choose **New project** and pick the main checkout you use in Superset, or run `bb project create --root ~/code/<repo>`. Superset's worktrees stay where they are.

### 3. Convert your project scripts

Find the effective config first: `.superset/config.json` in the repo, `.superset/config.local.json` if you have one, any `.superset/config.json` or `.superset/config.local.json` inside a workspace (a workspace's local file wins), any override under `~/.superset/projects/`, and any `.superset/setup.sh`, `teardown.sh`, or `run.sh`. Take a typical config, where `cwd` makes every command run in `apps/web`:

```json
{
  "cwd": "apps/web",
  "setup": ["bun install", "cp \"$SUPERSET_ROOT_PATH/apps/web/.env\" .env"],
  "teardown": ["docker-compose down"],
  "run": ["bun dev"]
}
```

It becomes three files at the repo root. Commit them on `main`, or whichever branch you start bb worktrees from: bb reads the setup and teardown scripts from the branch each new worktree starts from, and `.worktreeinclude` from your main checkout.

`.worktreeinclude` lists files bb copies from your main checkout into each new worktree, at the same path (gitignore syntax, paths from the repo root). bb copies every untracked file that matches, not only ignored ones, so keep the patterns narrow. It replaces setup lines that only copy files:

```gitignore
apps/web/.env
```

`.bb-env-setup.sh` runs once in each new worktree from the repo root, after the copy, before the agent starts. bb has no `cwd`, so the script changes folder itself. Anything that generates files or creates symlinks stays here:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd apps/web
bun install
```

`.bb-env-teardown.sh` runs before bb removes a worktree it created:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd apps/web
docker-compose down
```

If you already keep logic in `.superset/setup.sh`, the bb script can call it, but bb doesn't set `SUPERSET_ROOT_PATH` or `cwd`. Set the variable to your main checkout first, then change into the script's old `cwd`:

```bash
export SUPERSET_ROOT_PATH="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
(cd apps/web && bash "$OLDPWD/.superset/setup.sh")
```

Superset still reads its own config, so keep it while you use both. The `run` command has no bb equivalent: start the server in the thread's terminal, or put "start the dev server" in your prompt.

### 4. Bring over unfinished work

Start a new thread in bb: choose the project and **Worktree**, then open the worktree menu, which shows **Branch from:** and a branch.

- **Continue in place.** Choose **Existing worktree**, then the Superset folder. bb lists the repo's worktrees except the main checkout and ones bb made. The agent works in that folder, on its branch, with its uncommitted changes. bb doesn't own the folder: it never runs your scripts there and never deletes it. Superset still owns it, so deleting that workspace in Superset deletes the folder. Don't let agents in both apps edit the folder at the same time.
- **Start fresh from the branch.** Commit in Superset first, and merge `main` into the branch so it has step 3's scripts; otherwise setup and teardown silently don't run. Then pick that branch under **Branch from:**. bb creates a new worktree and branch from it and runs your setup. The Superset workspace isn't touched.

From the CLI, with the project ID from `bb project list`:

```bash
# Continue in the Superset folder
bb thread spawn --project <project-id> --environment ~/.superset/worktrees/<project>/<branch> --provider claude-code --prompt "Pick up where this branch left off: ..."

# Or start a new worktree from the branch
bb thread spawn --project <project-id> --new-environment worktree --base-branch <branch> --provider claude-code --prompt "..."
```

bb's [worktree docs](https://github.com/get-bb/bb/blob/main/docs/worktrees.md) cover both.

### 5. Run one task, including a Codex review

Start a Claude Code thread in a new worktree with a real task, and end the prompt with:

> When you're done, start a Codex thread in this same worktree to review your uncommitted changes without editing files. Fix anything it rates serious, ask for one more review, then stop and list what's left for me.

Claude runs `bb thread spawn --provider codex --parent-self` with a prompt it writes, passing its own environment (the one `bb status` shows) as `--environment`. Codex opens the same folder and sees exactly the changes Claude made, committed or not. `--parent-self` links the Codex thread under Claude's in your sidebar. Claude waits with `bb thread wait`, reads the review with `bb thread output`, and applies fixes. "Without editing files" and the round limit are instructions to the agents; bb has no read-only mode and doesn't count rounds, so check the diff before you merge. More in [How to use Claude Code and Codex together](/guides/claude-code-and-codex-together).

Then take it to merge:

1. **Review.** Open the thread's diff in the side panel. Select lines and choose **Add to chat** to send comments back with your note.
2. **Open the PR.** Ask the agent to commit, push, and run `gh pr create`.
3. **Checks.** Once the PR exists, the thread shows it above the composer with whether checks pass, fail, or are pending. For per-check logs, ask the agent to run `gh pr checks`, or open GitHub.
4. **Merge** with the **Merge** button on the thread's PR, or `bb environment pull-request merge <environment-id>`.

The GitHub plugin, from the plugin store inside bb, lists your issues and PRs with each check, and adds **Review with agent**.

### 6. Recreate tasks and automations

- **Tasks.** Install the Tasks plugin from the plugin store inside bb, link a task project to your bb project, and create a delegate preset (agent, model, worktree, permission mode). Copy your open native Superset tasks into a thread and ask: "Create a bb task for each of these with the same title and description, then set each one's status to the closest bb status." It runs `bb tasks create`, then `bb tasks update <key> --status <status>`, because new tasks start in the backlog.
- **Automations.** For each Superset automation, write down its prompt, agent, project, device, and schedule (in the timezone you created it in). In bb, open Automations and create one in agent mode with the same prompt, provider and model, project, and a cron expression with a timezone: "every weekday at 9am" becomes `0 9 * * 1-5`. An automation with no project goes in bb's Personal project. Choose whether each run starts a new thread, re-prompts an existing one, or gets its own worktree. If more than one machine is connected to bb, check that the first run landed on the one you meant. Then pause the Superset one.
- **Scripts.** Anything that called Superset's CLI, SDK, or MCP server can call `bb thread spawn`, `bb thread wait`, and `bb thread output`, or the HTTP API.

### 7. Set up your phone (optional)

Sign in at getbb.app with GitHub, claim a handle, get a pairing code from the dashboard, and enter it in bb's Settings → Remote access. Open your `<handle>.getbb.app` address in your phone's browser. Your computer must stay on and running bb. Phone browsers don't show bb's notifications, so check the sidebar, which marks threads waiting on you. For push notifications, install bb's iOS app from its [TestFlight beta](https://testflight.apple.com/join/T9MayTMb), turn on Settings → Experiments → **Mobile app**, and scan the code from Settings → Remote access → **Add mobile device**. Traffic passes through bb's relay, which decrypts it in flight but doesn't store it; the [privacy page](/privacy) has the details. More in [how to steer coding agents from your phone](/guides/steer-coding-agents-from-your-phone).

## Going Back

Nothing in this guide changes Superset. To take work from bb back:

1. **Commit and push** in the bb thread.
2. **Free the branch.** Git won't check out one branch in two worktrees. Delete or archive every bb thread in that worktree, including a Codex reviewer (check **Archived** too), then wait about five minutes; bb removes the worktree folder it created once none is left. The branch stays. Uncommitted changes are lost, which is why step 1 comes first.
3. **Open the branch in Superset** with **New Workspace → Existing branch**.

Worktrees you reused in step 4 were never bb's, so bb leaves them in place.

## FAQ

**Can both apps work on the same repo at once?** Yes, in separate worktrees. Avoid running agents from both apps in one reused worktree at the same time.

**Do I lose my agent history?** Sessions from Superset's terminals stay in `~/.claude` and `~/.codex` (or a profile's own folder), and Superset's built-in chat stays in Superset. bb doesn't import either as threads. Ask the agent to summarise the old session into your first bb prompt.

**What does bb cost?** Nothing. It's MIT-licensed with no paid plan. You pay for your agents as you do now.
