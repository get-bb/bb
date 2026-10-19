---
name: codex-provider
description: "Diagnose BB-specific Codex session controls, MCP elicitation and Computer Use app access, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `bb thread` commands.
`bb thread clear-goal <id>` clears its durable active Goal and waits for provider
confirmation. Inspect the thread before recovery actions.

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
