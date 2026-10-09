---
name: pi-provider
description: "Inspect BB Pi provider support for message editing, context compaction, and extension background task events."
---

# Pi provider

Pi supports editing and rerunning eligible user messages and compacting idle or
errored threads through the core `bb thread edit-message` and `bb thread compact`
commands. Inspect the thread first and use live command help for arguments.
Provider confirmation determines whether the operation completed.

Use the target host's provider catalog for available models and execution options.

Third-party Pi extensions can publish native BB background task cards and counters
using the experimental provider-owned v1 `bb:background-task` event bus channel.
Reply to `bb:background-task:request` with a complete snapshot and increasing
sequence number. The provider README documents exact envelope fields, bounds,
identity, reconciliation, and a minimal extension example. This works with Pi
threads from BB's UI, SDK, and CLI; it requires no new BB command.

Cards appear in the displayed transcript and native active count, but telemetry
stays out of MODEL context and prompts. These events are observation only, not task execution, cancellation,
output transport, or automatic continuation. Cards can update after the parent
turn ends. Clear, snapshot omission, or observer shutdown mark active cards stopped
without claiming to kill third-party work. Before the first real turn, snapshots
are held rather than fabricating a turn. Use a stable extension namespace, a fresh
publisher lifetime ID after reload, and never reuse a terminal run ID within that
lifetime. Reload closes old observations, then requests snapshots on readiness.
Returning sources receive new observer-generation identities against the existing
real turn; removed sources remain stopped. This never claims to kill their work.
