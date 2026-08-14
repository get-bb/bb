# bb-plugin-finite-state

One integrated bb plugin for findings, Product Security, BOMs, firmware, documents, bench evidence, sync review, and thread-native agent workflows.

## Findings drift commands

The plugin's single agent-discoverable command tree includes local findings drift operations:

```text
bb finite-state triage drift report  --project <platform-id> --version <pv-id> [--cursor <key>] [--limit 100] [--json]
bb finite-state triage drift refresh --project <platform-id> --version <pv-id> [--limit 100] [--json]
bb finite-state triage import-vex preview <worktree-relative.json> --vendor <name> --project <platform-id> --version <pv-id> [--json]
bb finite-state triage import-vex apply --import-id <id> --expected-document-sha256 <sha256> --project <platform-id> --version <pv-id> [--json]
bb finite-state triage orphans list --project <platform-id> --version <pv-id> [--json]
bb finite-state triage orphans prune --stable-key <key> --expected-base <sha256> --project <platform-id> --version <pv-id> [--json]
```

`drift report` is a zero-write persisted-index read. Vendor import is a durable two-phase preview/apply operation fenced by the returned import id and document digest. CLI apply always preserves existing local decisions; only the panel exposes overwrite mode. Orphan deletion requires explicit stable keys and the digest from a fresh `orphans list`. Each CLI invocation accepts at most 500 keys; the panel presents selections above 500 as separately confirmed chunks with a newly visible digest and retained progress. Neither mutation is registered as an agent tool.

Implementation is governed by the approved corpus in `docs/`. Start with `docs/Implementation/HANDOFF — Product & Architecture.md`, then the Master Plan, this directory's `AGENTS.md`, RECON, the work-package index, and Product Specs 00–06.

The Tasks project is `FS`; immutable WP titles map WP-01…WP-70 to FS-15…FS-84. Each WP runs in an isolated bb worktree from `finite-state/integration`, creates a PR, and requires independent review before merge.
