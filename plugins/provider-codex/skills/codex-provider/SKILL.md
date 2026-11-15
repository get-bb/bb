---
name: codex-provider
description: "Diagnose BB-specific Codex session controls, MCP elicitation and Computer Use app access, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `bb thread` commands.
Stopping a running Codex thread pauses its active Goal, as Codex's own client
does, so later messages and clearing do not restart it. Send `/goal resume`
to make a paused, blocked, or usage-limited Goal active again; Codex starts
working on it in that message's turn. `/goal pause` and `/goal clear` pause or
remove the Goal without starting a turn, and any other `/goal` text goes to
Codex as a normal prompt. `bb thread clear-goal <id>` also removes the
thread's Goal, whatever its status, and waits for provider confirmation.
Inspect the thread before recovery actions.

Codex questions from `request_user_input` pause the turn until answered.
Questions from `request_user_input_async` do not pause it: the plugin opens a
question card for each one that stays open for up to an hour after the turn
ends. Submitting sends the answer to the thread as a message
(steering an active turn or starting a new one); dismissing sends nothing.
From the CLI, find it with `bb thread interactions list <thread>` and answer
with `bb thread interactions respond <interactionId> <thread> --value
'{"answers":{"question-1":{"selected":["option-2"]}}}'`. Questions and options
are numbered from 1 in order; use `"freeText"` for a typed answer.

Codex relays MCP elicitations (`mcpServer/elicitation/request`) as a
`provider-codex/mcp-elicitation` interaction that pauses the turn. Every card
names the requesting MCP server. Computer Use app access (only from Codex's
`cua_repl` server; Computer Use metadata from any other server shows as a plain
tool approval) shows the app name and native icon, keeps high-risk warnings
visible, and offers Allow for this session or Always allow only when Codex
offers that scope; Codex stores the grant. MCP tool-call approvals
(`codex_approval_kind: "mcp_tool_call"`) show the tool and its arguments and
offer Allow, plus Allow for this session or Always allow when Codex offers
them. These are separate from macOS
Accessibility and Screen Recording permissions. Standard forms accept text,
numbers, integers, booleans, and single or multiple choices with defaults,
required fields, and supported constraints; answers are validated in the UI
and again before reaching Codex. URL requests show the destination and open
only on user action; acceptance means the URL opened, not that the external
flow finished. Unsupported schemas offer only Decline. Answer from the CLI with
`bb thread interactions respond <interactionId> <thread> --value '<json>'`
(SDK: `threads.interactions.respond`), passing
`{"action":"accept","persist":"session"}` (or `"always"` when `scopes`
includes it) for app access, `{"action":"accept"}` or an offered `persist` for
tool approvals, `{"action":"accept","content":{...}}` for forms,
`{"action":"accept"}` for URLs after the user opens them, or
`{"action":"decline"}` / `{"action":"cancel"}`. Invalid responses never grant
access. Stopping the turn answers the request with `cancel`.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Inspect models on the actual execution host with
`bb provider models codex` using the machine or environment selector.

Service tiers are `default`, `fast`, and `ultrafast`. Codex reports the tiers
each model accepts for the signed-in account, so the model picker and
`bb provider models codex` (Service tiers column, `supportedServiceTiers` in
`--json`) list Ultrafast only for eligible models and accounts. Pass the id to
`--service-tier` on `bb thread spawn` or `bb thread tell`; bb sends an explicit
tier to Codex as given. When the model does not list it, Codex runs the turn
at its default tier and the thread shows its warning that the tier "is not
advertised as supported" and was omitted.

Daybreak is a session option with the id `daybreak`, offered only when the
signed-in account's model list advertises a Daybreak program. Turn it on in the
model picker, with `bb thread spawn --option daybreak=true`, or on an existing
thread with `bb thread options --set daybreak=true`; it applies from the next
turn and Codex stores the choice on its own thread. With it on, each turn asks
for the selected model's Daybreak program (blue when the model lists it,
otherwise red); once it has been turned off, each turn asks for the standard
program. A thread where Daybreak was never set sends no program and leaves the
choice to Codex.
`bb provider models codex` lists the option, and `--json` shows per model
whether it runs with Daybreak, without it, or both (`sessionOptions`, where
`fixed: true` means only the listed value). A model that cannot run in the
current state is disabled in the picker. The `gpt-daybreak-*-latest` alias
models leave the main list when the switch is available and stay selectable
only on threads that already use them.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.

Native two-way voice chat is available through Start voice chat next to the dictation microphone in the
thread composer. It connects the browser's microphone and speaker to the same
Codex thread over WebRTC, including native coding handoffs. Mute keeps the call
open; End voice or leaving the thread releases capture and playback without
stopping coding work. It requires HTTPS, microphone permission, WebRTC, and
Codex realtime access. There is one call per thread. For clients that manage
their own WebRTC peer, `bb thread voice start <id> --sdp-file offer.sdp --json`
returns the answer and session id; `bb thread voice stop <id> --session <uuid>`
ends it. External clients must call `bb thread voice keep-alive <id> --session <uuid>`
every 15 seconds (SDK action `keepAlive`); an orphaned call expires after 60 seconds.
Each call opens with only a short voice instruction: respond casually and briefly
to the user, without an unsolicited recap or resuming earlier work. Native startup
history is disabled for the opening. After the first assistant reply completes,
a bounded BB thread brief, recent user/assistant messages, and tool results are
queued as background reference. While voice is idle, the browser sends that
reference over the existing data channel with an explicit developer channel,
waiting for each chunk acknowledgment and pausing during speech. It does not
request a response or change the voice prompt.
External WebRTC clients must observe the `provider-codex/voice` extension state and
deliver its `backgroundContext` once for the matching session, using
`session.context.append` frames with `channel: "developer"` and input-text chunks
of at most 500 UTF-8 bytes, waiting for `session.context.appended` between
chunks and pausing delivery during user and assistant speech. Completed tool
commands, statuses, and results are included within a 28,000-byte context budget. Full source reads take priority over listings and setup/help text;
failures retain error excerpts. Omitted or shortened results are labeled with
event sequences so voice can ask the backing coding agent for the full output. This context is
refreshed when a new call starts, rather than loading the entire transcript.

The app renews automatically. SDK callers use `threads.voice({ threadId, command })`.
