---
name: claude-code-provider
description: "Configure or troubleshoot BB-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read settings with `bb plugin config provider-claude-code`; change a declared key
with `bb plugin config provider-claude-code set <key> <value>`.

- `disable1MContext` defaults to `false`. Enable with
  `bb plugin config provider-claude-code set disable1MContext true` to set
  `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (`0` when off). Changes restart the
  thread's Claude process before its next turn, preserving context.
- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- Select the Fast service tier in the model picker or pass `--service-tier fast`
  to `bb thread spawn` for supported Opus models. Use
  `bb thread tell --service-tier fast` to change a thread on its next turn;
  `default` turns it off. Fast mode requires eligible Claude access;
  subscription accounts need usage credits. It is billed at premium rates.
  The provider passes the selection as a session-scoped SDK setting, so it
  does not change the user's Claude defaults.
- `sandboxEnabled` defaults to `true`. In Accept Edits and Approve for me modes
  bb runs Claude Code's Bash commands in its sandbox. Set it to `false` to use
  Claude Code's own command approvals and sandbox settings instead. A change
  restarts the thread's Claude process before its next turn, preserving context.
- bb passes only `BB_CLAUDE_CODE_EXECUTABLE` and `CLAUDE_CODE_OAUTH_TOKEN` to
  the CLI. Mint the token with `claude setup-token` for machines with no
  interactive login.
- Claude Code's own slash commands, including bundled skills such as
  `/simplify` and `/code-review`, appear in the composer's `/` menu,
  `bb project commands`, and `bb thread commands`. The provider reads them from
  Claude Code for the project folder without sending a prompt. With **No project**
  selected, it uses an empty catalog folder on the selected machine so global
  commands appear before a workspace exists. Each thread refreshes them when a
  turn starts. Commands for settings bb manages (such as
  `/model`, `/config`, `/fast`), terminal-only commands (such as `/doctor`),
  and bb's own skills are left out.
- Structured plan, message editing, and compaction are supported through the
  corresponding `bb thread` commands. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.

Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.

## macOS capture permissions

A Bash sandbox and macOS Screen Recording authorization are separate checks.
Confirm the session's sandbox setting before blaming sandbox isolation. When a
capture fails, inspect the shell's process ancestry before naming the app or
executable that needs a grant. A bb host daemon launched by mise's Node binary
can have a different macOS privacy identity from bb.app; granting bb.app access
does not establish authorization for that daemon's children.

Use an authorized read-only capture preflight and process query on the capture
host. Start with `ps -o pid,ppid,comm -p $$`, then inspect each parent until the
launcher is identified. Report the observed launcher and authorization result,
and label an unavailable preflight as unverified. After a user changes a grant,
retry the capture to confirm it works. Do not restart unrelated agent sessions
to test a permission hypothesis.
