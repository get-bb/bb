---
title: bb vs Superset
description: Superset gives each agent its own workspace. bb lets agents hand work to each other. What's the same, what's different, and when to pick each.
---

_Checked against Superset's site, pricing, and docs, and bb 0.44.0, on Sep 26, 2026. bb makes this page._

Superset gives each agent its own polished workspace. bb lets agents hand work to each other: a Claude Code thread can start a Codex review, wait for it, and apply the fixes while you watch both. Both are free to start, and bb stays free, including the phone access and automations Superset puts on Pro.

**Choose bb if you:**

- Use Claude Code and Codex together and are tired of carrying work between them.
- Want phone access and automations without a paid plan.
- Work on Windows (through WSL2) or Linux (alpha).

**Choose Superset if you:**

- Review one agent's patch at a time, with diff, editor, terminal, and browser side by side.
- Want a released iPhone app, team plans, or a vendor with an SLA.
- Want every new task in its own worktree without choosing.

[Download bb for macOS](/download/macos) · [Moving from Superset? Here's how](/guides/move-from-superset-to-bb)

## What's The Same

- Both run Claude Code, Codex, and other agents on your own machine, with the logins and settings you already have.
- Both keep tasks apart with Git worktrees.
- Both have a diff view and a terminal, and both can be scripted from a CLI.
- In both, you pay your agent providers as you do today.

## The Difference, Shown

Take one task: "add rate limiting to the upload endpoint." Tell a bb Claude Code thread: "When you're done, start a bb Codex thread to review this branch, then fix what it finds."

Claude starts the reviewer in the same worktree, waits, reads the review, and makes the fixes. The Codex thread appears under Claude's in your sidebar, so you can open it and see exactly what it was asked and what it found. When either needs you, bb notifies you on your desktop, or on your phone through the iOS beta app.

Superset can hand a branch from one agent to another too, and its CLI and MCP server let agents launch agents. The difference is what you see: in bb, every run is its own linked thread, and the answer comes back to the agent that asked.

## At A Glance

|                  | bb                                                                                   | Superset                                    |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| **Built around** | Threads that can start and wait on other threads                                     | A workspace per task                        |
| **Agents**       | Claude Code, Codex, Pi, plus Cursor, OpenCode, and other ACP agents                  | Any CLI agent                               |
| **Phone**        | Browser app, free. iOS app in TestFlight beta                                        | iPhone app, on Pro                          |
| **Automations**  | Free                                                                                 | On Pro                                      |
| **Platforms**    | macOS, Linux (alpha), Windows through WSL2                                           | macOS, Linux (experimental)                 |
| **Price**        | Free, MIT                                                                            | Free for 1 user. Pro $20 per user per month |
| **Switching**    | Repo, branches, and worktrees carry over ([guide](/guides/move-from-superset-to-bb)) | Keeps working alongside bb                  |

## Where Superset Is Better

- **Reviewing one task at a time.** Diff, file editor, terminals, browser, and port management sit side by side in each workspace.
- **Worktrees by default.** Every new branch workspace gets one. In bb it's one choice, remembered per project.
- **A released phone app.** Superset's iPhone app is in the App Store, on Pro. bb's iOS app is a TestFlight beta.
- **Teams and support.** Per-seat plans, Slack and Linear integrations, and an Enterprise plan with SSO and an SLA. bb has none of these.

## What You're Signing Up For

bb is young: first commit February 2026, it changes weekly, and there's no paid support. Help comes from [GitHub issues](https://github.com/get-bb/bb/issues) and [Discord](https://discord.gg/kvBU6tJhcJ). It's MIT-licensed, so you can fork it or stay on a version you like. If you need an SLA, pick Superset.

## FAQ

**Do my logins and settings carry over?** Yes. bb runs the Claude Code and Codex CLIs you already use, with your `CLAUDE.md`, skills, MCP servers, and `~/.codex` config.

**Is bb really free?** Yes. MIT-licensed, no paid plan. You pay only for your agents.

**Can I use both?** Yes. Both work on the same repo with plain Git. Try bb on one real task and keep what fits.

[Download for macOS](/download/macos) · [Download for Linux (alpha)](/download/linux) · Windows (WSL2) and Intel Macs: `npx bb-app@latest`
