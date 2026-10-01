---
title: bb vs Superset (2026)
description: bb and Superset both run Claude Code, Codex, and other agents in parallel worktrees. Here's how they differ, and when to pick each.
---

_Checked against Superset's site, pricing, and docs, and bb 0.44.0, on Sep 26, 2026._

Superset and bb both run Claude Code, Codex, and other coding agents in parallel on your own machine, using Git worktrees to keep tasks apart. Superset puts each agent in a polished task workspace. bb is built for agents working on the same task together: a Claude Code thread can start a Codex reviewer, wait for its result, and apply the fixes, with both runs visible as linked threads and nothing copied between terminals. bb is also free in full, including phone access and automations, which are Pro features in Superset.

**Pick bb if you want:**

- Claude Code and Codex (plus Cursor, Pi, OpenCode, Grok, and others) to work on the same task and hand off to each other.
- Everything free: phone access and automations are not behind a paid plan.
- An app you can extend with plugins, including ones your agents write.
- Windows through WSL2, or Linux (alpha).

**Pick Superset if you want:**

- A worktree for every new local branch workspace without choosing it.
- Diff, terminals, and a browser laid out side by side for each task.
- A released iPhone app, team plans, and paid support.

**Our suggestion for this week:** if your day is one agent per task and reviewing patches, Superset's free plan does that well. If you already bounce work between Claude Code and Codex, or want to check on agents from your phone without paying, try bb on one real task using the walkthrough below. Both use the agent logins you already have, so a trial costs you one task's worth of agent usage.

[Download for macOS](/download/macos) · [Download for Linux (alpha)](/download/linux) · `npx bb-app@latest` for Intel Macs and Windows (WSL2), with Node.js 22.19 or later

**Already on Superset?** [How to move from Superset to bb](/guides/move-from-superset-to-bb) covers it step by step: converting `.superset/config.json` and the `.env` files your setup copies, picking up unfinished workspaces, tasks and automations, and going back.

## One Task In bb, Start To Finish

Here's an ordinary task, "add rate limiting to the upload endpoint", written by Claude Code and reviewed by Codex.

1. **Start a Claude Code thread in a worktree.** Pick the project, choose Worktree and Claude Code, and type the task. bb uses your existing `claude` login and your `CLAUDE.md`, skills, and MCP settings. You see its plan, tool calls, and permission requests as UI, and you can steer it mid-run.
2. **Have Codex review it, without copy-paste.** Tell the thread: "When you're done, start a bb Codex thread to review this branch, then fix what it finds." Name bb in the request; otherwise Claude may call the `codex` CLI directly. The Claude thread uses `bb thread spawn` to start a linked Codex thread in the same worktree, waits for the review, reads it, and makes the fixes. No setup is needed: bb gives every agent the `bb` CLI and a short guide to it. Both threads show up in your sidebar, linked, so you can read the review yourself.
3. **Review the diff.** Open the thread's diff in the side panel. Select any lines and choose **Add to chat** to send them back to the agent with your comment. A terminal and, in the desktop app, a browser open in the same panel.
4. **Step away.** The desktop app, or any open bb tab on your computer, notifies you when the agent finishes or needs an answer. On your phone, bb's iOS app (a TestFlight beta) sends a push notification and opens the thread so you can reply. Or open your bb in the phone's browser through bb Connect: phone browsers don't show bb's notifications, but the sidebar marks threads waiting on you.
5. **Ship it.** Ask the agent to push the branch and open the PR. The thread then shows the PR above the composer, with its checks and a **Merge** button.

What you skip compared with two terminals: pasting diffs and review notes between agents, keeping track of which terminal is doing what, and being at your desk when an agent stops to ask a question.

## At A Glance

|                      | bb                                                                                                                                                                                       | Superset                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Built around**     | Threads: agent runs you can follow, steer, or hand off. Threads can start and wait on other threads                                                                                      | Workspaces: a worktree plus terminals, chat, review, and a browser                                                              |
| **Agents**           | Claude Code, Codex, and Pi through their native interfaces. Cursor, OpenCode, Grok Build, omp, Hermes Agent, and other agents through the Agent Client Protocol (ACP). Choose per thread | Any CLI agent, including Claude Code, Codex, OpenCode, Cursor, Copilot, Gemini, and Mistral Vibe                                |
| **Worktrees**        | One click per thread in the app, remembered per project. The default for threads started from the CLI or by another agent                                                                | The default for new local branch-based workspaces                                                                               |
| **Review**           | Diff in the side panel; select lines to send them to the agent. PR checks and merge above the composer. Terminal built in; browser in the desktop app                                    | Built-in diff and file editor, terminals, in-app browser, and port management per workspace                                     |
| **Ways to drive it** | Desktop app, web app, `bb` CLI, and HTTP API                                                                                                                                             | Desktop app, CLI, and MCP server                                                                                                |
| **From your phone**  | The full web app in your phone's browser through bb Connect, without notifications. An iOS app with push is in public TestFlight beta. Free                                              | iPhone app on iOS 26+, with the Pro plan                                                                                        |
| **Automation**       | Scheduled and repeating agent runs or scripts. Free                                                                                                                                      | Automations and scheduled sessions, with the Pro plan                                                                           |
| **Other machines**   | Enroll more machines and run threads on any of them from one bb. Free                                                                                                                    | Connect to remote hosts on any plan (since July 2026). Making your own machine reachable needs Pro                              |
| **Extending it**     | Plugins from the [plugin gallery](https://getbb.app/marketplace), or ones your agents write inside bb                                                                                    | Themes and service integrations from its marketplace. Scripting through its CLI, MCP server, and an early-alpha SDK             |
| **Platforms**        | macOS (Apple Silicon). Linux is alpha. Intel Macs and Windows (WSL2) through `npx`                                                                                                       | macOS. Linux is experimental. No Windows                                                                                        |
| **Price**            | Free, MIT license. No paid tier                                                                                                                                                          | Free plan for 1 user: local workspaces, desktop app, CLI, GitHub integration. Pro is $20 per user per month ($15 billed yearly) |

In both, you pay for your agents separately with the subscriptions or API keys you already have.

## Where bb Is Different

### Agents that hand work to each other

Most people now use more than one agent: Claude for some tasks, Codex for others. The usual workflow is two terminals and you in the middle, copying diffs and review notes back and forth. In bb, a thread can start another thread with a different agent, wait for it, and read its result through the `bb` CLI. That's how the walkthrough's review step works, and it's how we build bb: one thread plans, a few implement in parallel, and another reviews. Superset can also coordinate agents, including handing a branch from one agent to another. The difference is the shape: in bb, each agent run is a thread with its own chat UI, linked to the thread that started it, and waiting for a result is one built-in CLI call rather than watching a terminal.

### Agent output as UI, not terminal text

bb talks to Claude Code, Codex, and Pi through their own interfaces, and to other agents through ACP. So plans, tool calls, permission requests, and questions show up as UI you can act on, including from a phone, where a terminal is hard to use.

### Your machines, reachable from anywhere, for free

bb runs on your hardware. bb Connect gives it a private `https://<handle>.getbb.app` address that only you can open, signed in to your getbb.app account. Your machine makes an outbound connection, so there are no ports to open. From your phone you get the full app, and the sidebar shows which threads are waiting on you. Switch on Keep Awake and your Mac won't idle-sleep mid-run. If you have more than one machine, one bb runs threads on all of them.

### An app your agents can change

bb is extended with plugins: themes, panels, agent providers, environments, and automations. You can ask an agent in bb to build one, and it shows up in the app you're using. The [plugin gallery](https://getbb.app/marketplace) has the published ones. Superset's [own comparison](https://superset.sh/compare/bb-alternative) calls bb "genuinely novel".

## Where Superset Is Stronger

Here's when we'd point you to Superset.

- **Worktrees without choosing.** Every new local Superset branch workspace gets its own worktree. In bb's app it's one click, remembered per project, but you do make that choice once.
- **Review-first layout.** Superset puts the diff, a file editor, terminals, a browser, and port management side by side for each task. If your day is mostly reviewing agent patches one task at a time, that layout is built for it.
- **A released iPhone app.** Superset's is in the App Store for Pro users. bb's iOS app, with push notifications, is a free TestFlight beta, and there's no Android app in 0.44.0.
- **Teams and support.** Superset sells per-seat plans with Slack and Linear integrations, and an Enterprise plan with SSO and an SLA. bb has none of those.

## What You're Signing Up For

bb is young: the first commit was in February 2026, and it changes weekly. Three core maintainers lead it, with [outside contributors](https://github.com/get-bb/bb/graphs/contributors) every week, and many of its features were built by agents working inside bb. There's no paid tier or support contract. Help comes from [GitHub issues](https://github.com/get-bb/bb/issues) and [Discord](https://discord.gg/kvBU6tJhcJ), and the code is MIT-licensed, so you can always fork it or run an older version. If you need a vendor with an SLA, Superset is the safer pick.

## FAQ

**Do my Claude Code and Codex logins and settings carry over?** Yes. bb runs the agent CLIs you already have signed in. Claude Code threads use your `CLAUDE.md`, skills, and MCP servers; Codex threads use your `~/.codex` config.

**What's included without installing anything?** Threads for every agent, worktrees, the diff panel, PR checks and merge, terminals, the in-app browser (desktop app), and the `bb` CLI. Notifications (desktop, desktop browser tabs, and push to the iOS beta app), automations, and bb Connect ship as built-in plugins that are already on; Keep Awake is built in and needs one switch in its settings. The GitHub, tasks, and browser-automation plugins are one-click installs from the gallery.

**What does bb Connect need, and what does it expose?** A free getbb.app account. It exposes your bb app at a private URL that opens only for you when signed in, and, if you choose, specific local dev servers you share. Each machine you pair, and each phone running the iOS app, uses one of your account's machine slots. Turn off the Connect plugin to cut bb Connect access at once.

**What does bb send off my machine?** Without Connect, anonymous usage events tied to a random install ID: app starts, threads and messages with the agent used, and plugins installed, plus OS, architecture, and app version. No code, prompts, or project names. bb also checks for updates and loads the plugin gallery. Turn usage events off in Settings or with `BB_TELEMETRY=false`. Your agents talk to their own providers as they normally do.

**Is bb really free?** Yes. It's MIT-licensed with no paid plan. Your only cost is the agents you use.

**Does bb run on Windows?** Through WSL2. Install Node.js 22.19 or later in the Linux shell, then run `npx bb-app@latest` (with npm 12, `npx --allow-scripts=better-sqlite3,node-pty,@parcel/watcher bb-app@latest`). Native PowerShell isn't supported. Superset doesn't support Windows.

**Do I still need my editor?** Yes. bb is where your agents work, not a replacement for VS Code, Cursor, or Zed. The desktop app opens files in the editor you already have.

**Can I use both?** Yes. Both drive the same agent CLIs on the same repos, so try each on one real task and keep the one that fits.

[Download for macOS](/download/macos) · [Download for Linux (alpha)](/download/linux) · `npx bb-app@latest`
