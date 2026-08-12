# Finite State program bootstrap

This document is the scheduling bootstrap for the remaining Finite State work. It does not replace a WP's product acceptance criteria. It binds coupled WPs to one decision owner and adds dispatch-only dependency edges where two packages must not make the same design decision independently.

The machine-readable source of truth is [`wp-coupling-manifest.json`](./wp-coupling-manifest.json). The work-package index remains the source for each WP's technical scope, and [`COORDINATOR-RUNBOOK.md`](./COORDINATOR-RUNBOOK.md) is the operating procedure.

## Audited scope and binding rule

The audit was performed from integration commit `1a7aaea1fd308f6817d40f81a6619b6fc46635d8`. At that point WP-01 and WP-07 were done; WP-03 through WP-06 had started; and **WP-02 plus WP-08 through WP-70 were the 64 remaining unstarted WPs**.

Apply this binding test before dispatch: **if WP-A acceptance criteria cannot be made unambiguous without a design choice owned by WP-B, both WPs have one decision owner.** Keep their historical WP and Task keys, and sequence them under that owner. FS-93 considered a merge only when it would be genuinely smaller and clearer, stay below roughly one day, and touch no more than three frozen-surface files.

FS-93 found no justified merges. The effective plan therefore remains **70 WPs total**, with **64 unstarted WPs represented by 28 remaining decision-owner clusters**. Every cluster uses sequential execution, including single-WP clusters; the validator rejects the unused `merged` mode rather than carrying a dead branch.

## Required candidate verdicts

| Candidate                     | Verdict             | Final owner sequence                                      | Why                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-16 / WP-18 / WP-19 / WP-20 | **Bind and expand** | `C-SYNC-TRANSACTION`: WP-15 → 16 → 17 → 18 → 19 → 20 → 21 | Serializer exclusions, base identity, the one-entity gate, plan fences, per-entity base advancement, conflicts, and their review UI are one transaction design. Independent acceptance would require each package to re-decide the same semantics. |
| WP-22 / WP-23                 | **Bind**            | `C-FINDING-IDENTITY`: WP-22 → 23                          | Stable-key resolution is defined over the cache normalization and lookup behavior.                                                                                                                                                                 |
| WP-27 / WP-28 / WP-29         | **Bind and expand** | `C-TRIAGE-INTENT`: WP-27 → 28 → 29 → 30                   | YAML identity, policy output, partial application, and drift/import reconciliation share one intent and pushability model.                                                                                                                         |
| WP-44 / WP-46                 | **Bind and expand** | `C-DOCUMENT-PROVENANCE`: WP-56 → 44 → 45 → 46             | WP-56 owns the canonical source-reference codec; HBOM cells, review, extraction, merge, and export cannot be accepted without that same provenance decision.                                                                                       |

## Additional coupled clusters found

| Cluster                      | Owner sequence                 | Binding decision                                                                                                                |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `C-FINDING-UX`               | WP-24 → 25 → 26                | List state, detail navigation, and manual triage form one keyboard and navigation workflow.                                     |
| `C-CANVAS`                   | WP-31 → 32 → 33 → 34 → 35      | Foundation, graph representation, overlays, coordinates, links, persistence, and YAML editing are one canvas architecture.      |
| `C-EARS-AUTHORING`           | WP-36 → 38                     | Conversion gates cannot choose a grammar independently of the EARS schema and validator.                                        |
| `C-VERIFICATION-EVIDENCE`    | WP-39 → 40                     | Matrix mapping, run detail, attestations, and concurrency share one evidence model.                                             |
| `C-SBOM-EXPLORATION`         | WP-41 → 42                     | Cache normalization and rollups determine the interactive table shape. Export remains separately owned.                         |
| `C-FIRMWARE-MATERIALIZATION` | WP-47 → 48 → 49 → 50 → 51      | Cache, primary unpack, fallback, digest readiness, optional compute handshake, and UI expose one materialization state machine. |
| `C-BENCH-EVIDENCE`           | WP-52 → 53 → 54 → 55           | Runs, results, artifacts, execution, timeline, and OTA verdict share one digest-bound evidence contract.                        |
| `C-AGENT-ACTION-SAFETY`      | WP-57 → 60 → 64                | Registry conventions, the server-action allowlist, and CLI mutation exposure must freeze one exact safety boundary.             |
| `C-GOLDEN-LOOP`              | WP-65 → 66 → 67 → 68 → 69 → 70 | Harness, seed state, ordered beats, offline behavior, and recovery are one deterministic evidence narrative.                    |

The 15 single-WP clusters are WP-02, WP-08, WP-09, WP-10, WP-11, WP-12, WP-13, WP-14, WP-37, WP-43, WP-58, WP-59, WP-61, WP-62, and WP-63. They passed the binding test after their declared prerequisites land; forcing them into a larger owner unit would reduce useful concurrency without resolving a shared decision.

## Models and lane caps

- `fs-critical` is Codex `gpt-5.6-sol` at `xhigh`. It is mandatory for all L2 sync WPs (WP-15 through WP-21) and all L4 canvas WPs (WP-31 through WP-35).
- `fs-standard` is Codex `gpt-5.6-sol` at `medium`. It is mandatory for the routine and mechanical lanes in this manifest.
- `fs-review` is Claude Code `claude-opus-5[1m]` at `high`. It performs independent review after implementation evidence is attached.

Keep the current four-lane cap until WP-10, WP-11, WP-12, and WP-13 are complete and the readiness validator approves promotion. Then use a **six-lane cap**. Promotion from six to nine is conditional on all of the following: nine independent active-or-ready decision clusters, workflow concurrency of at least nine, at least 45 GiB free after all worktrees are provisioned, and a 35 GiB runtime free-space floor.

Lane count is a ceiling, not a target. Never dispatch two members of one sequential cluster concurrently, even if unused capacity exists.

The manifest intentionally has no per-WP `gate`, `phase`, or `milestone` field. Dispatch readiness is derived directly from effective dependencies, cluster idleness, and sequence. This avoids overloading the Master Plan's real G0–G6 product milestones; no G7 exists. The validator fails if a per-WP `gate` is reintroduced.

## Tasks surface contract

The current Tasks CLI can set status, labels, parent, description, comments, and attachments, and can dispatch through named presets. It does **not** expose arbitrary dependency edges, cluster membership as a first-class relationship, mutual exclusion, or concurrency constraints. Do not misuse parent links to imitate dependencies; every WP must retain its existing program hierarchy.

FS-93 therefore mirrors cluster, owner, sequence, effective dependencies, risk, preset, and gate in Task comments and keeps enforcement in the checked-in manifest and validator. The board is an auditable mirror; the repository is the enforcement authority.
