# Review kill list

A rolling list of the blocker classes that actually appear in round-1 REQUEST_CHANGES verdicts on the task board. Maintained by the coordinator: one line per class, added when a new class produces a round-1 blocker, pruned when a class stops appearing. Implementers attest against this list when flagging review (see [AGENTS.md](./AGENTS.md), "The review kill list").

Last updated: 2026-08-13. Source sample: FS-49, FS-54, FS-74, FS-107, FS-108, FS-121, FS-122, FS-123, FS-124, FS-127 — zero first-pass approvals; FS-108/122/124 reached round 3.

| # | Class | What it looks like | Round-1 examples |
|---|---|---|---|
| 1 | Registered-surface bypass | The property is enforced/tested on an exported helper while the registered RPC/tool/panel path bypasses it or never calls the new code at all | FS-122 (send-confirm gate bypassed by the actual RPC), FS-74 (guard defeated by runtime registration), FS-108 (parser never invoked by any production path) |
| 2 | Real-data drift | Passes on mock/synthetic fixtures, wrong on real artifacts | FS-108 (wrong connectivity on the repo's own real KiCad fixture), FS-164 (real API nests the component object; mocks were flat) |
| 3 | Amendment/spec conformance drift | Implementation contradicts signed amendment text | FS-121 (AMD-0013 "one mechanism and one test" became two mechanisms), FS-74 (intake note said "nine" tools vs the ratified eight) |
| 4 | Concurrency/liveness edges | Claim leaks, orphaned in-flight rows, missing liveness checks on persisted state | FS-124 (claim leak, liveness), FS-154 (`publishChanged` outside the `try` orphans a `running` probe_run row) |
