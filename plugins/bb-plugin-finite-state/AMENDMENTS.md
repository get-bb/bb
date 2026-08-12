# Finite State contract amendments

Frozen contracts may change only through an amendment entry approved by the contract owner and one affected-lane reviewer. Pre-freeze architecture corrections retain their accepted `A-*` identifiers; post-freeze contract changes use `AMD-*`. CI, not an implementation lane, updates baseline hashes after approval.

Non-semantic pre-freeze corrections such as a missing dependency declaration, scaffold expectation, or documentation typo use one affected reviewer and do not require a global amendment broadcast. Semantic contract changes and every post-freeze statement change still require the full protocol below.

Each amendment must record:

- identifier and status;
- old and new artifact hashes;
- reason and migration plan;
- affected work packages and gates;
- approver/reviewer identities;
- broadcast and merge commits.

No amendment is implied by an implementation task, code comment, or local workaround.

## Approved amendments

### D-1/D-2 — Consolidated pre-freeze scope, publication, and boundary correction

- Status: approved for implementation under FS-89; frozen-artifact merge still requires independent exact-head review and explicit product-owner approval
- Prior artifact hashes: pre-release candidates only; no registered/frozen store release exists
- Reason: replace global/ambiguous storage keys with explicit project/product-version scope, publish only complete pull generations, bind writes to generation/revision/content fences, normalize paging/remote boundaries, and match pinned bb RPC naming/authorization limits
- Migration: rewrite the positional v1 base statements in place, including original primary keys, unique constraints, foreign keys, and indexes. Do not append D-1 repair migrations. Remove `CREATE TABLE IF NOT EXISTS` so an unexpected preexisting schema fails loudly.
- Pre-release safety proof: on 2026-08-12 a read-only search of `/Users/matt/.bb`, `/Users/matt/Documents/Projects`, and `/Users/matt/Library/Application Support` for finite-state `data.db`/SQLite files returned zero persistent instances. The plugin is unregistered and unreleased, so no developer database can contain a shipped positional statement.
- Cutoff: this in-place rewrite authority ends when the frozen v1 candidate merges/registers. After that point every shipped statement is immutable and changes append through `AMD-*` with a migration plan.
- Affected WPs and gates: Specs 00/01/05; HANDOFF; WP-03–06, WP-16–19, WP-45, WP-56; shared contract, registry, remote boundary, shared store, dependency/frozen guards; G0–G6. WP-02 is held until the consolidated migration candidate merges.
- Contract owner: Matt Wyckhouse (binding D-1/D-2 and migration-order decisions in the coordinating thread)
- Consolidation task/branch: FS-89 / draft PR #6; final hashes and review identities pending

### A-000 — Direct APIs and optional Forge compute

- Status: approved and merged
- Prior artifact hashes: pre-freeze; no contract baseline existed
- New artifact hashes: `BASELINE.json` records the approved spec and vendored-input hashes
- Reason: replace Forge-as-data-gateway with direct typed Platform and Assurance Studio REST while retaining only unique Forge compute
- Migration: update the handoff, ADR, Product Specs, remote contracts, mocks, registry ownership, and all affected WPs before implementation dispatch
- Affected WPs and gates: WP-01, WP-03–06, WP-10–19, WP-22, WP-29, WP-40, WP-43, WP-50, WP-64; G0–G6
- Contract owner: Matt Wyckhouse (product-owner approval in the coordinating thread)
- Affected-lane reviewer: independent agent thread `thr_ib9at8u34a`
- Approved specification commit: `3e37cae40405f6857d6ff1f6f628baff134d8436`
- Merge commit: `b18f9878bc6c0b183603885687178480df56b309`
- Broadcast commit: `4f5431306245d2aef2abaa6aac342d947c780bdf` (initial target-repository corpus import)
- Result: Platform and Assurance Studio are direct typed REST data planes. Forge is nullable and restricted to the checksummed compute manifest. `prepareFirmwareRoot` is deliberately unresolved and must be removed or proven before WP-06 freezes.

## Pending amendments

### A-001 — Declare the repo-pinned Zod runtime dependency

- Status: implementation complete; pending independent review
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `191f9e51eb84fa5e049a1cad9c4c719660a56cc2386dc8a2d00ad3f887ca545d`
  - `pnpm-lock.yaml`: `b99026a911e4d6cfff34c5a1acabd179f0d2923111f32a01c5f9d67928b26b7e`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `41b3577a88829fef3daf24869eb11572ebba358c9076a1de738798ef0762c0e0`
  - `pnpm-lock.yaml`: `dbeb4f897f85ff24d3129ce038814fd53818d1995ba36b948101559c91028d5c`
- Reason: WP-03 requires a runtime Zod import, but the plugin package cannot resolve Zod under an isolated Node 22.19 workspace install unless it declares the dependency directly. The repository override already pins Zod to 4.3.6.
- Migration: declare `zod` `^4.3.6` in the plugin runtime dependencies and add only that dependency to the finite-state lockfile importer, reusing the existing `zod@4.3.6` package resolution. No source contract, composition root, or product behavior changes.
- Affected WPs and gates: WP-03 (FS-17) and WP-09 dependency-freeze checks; Node 22.19 frozen install and the scoped finite-state typecheck/test/lint/build gate
- Contract owner: Matt Wyckhouse (task authority; merge approval pending)
- Affected-lane reviewer: pending independent review on the A-001 draft pull request
- Implementation base commit: `ba28401a45b31dd1e907a043138207505fb01a4f`
- Merge commit: pending
- Broadcast commit: pending; FS-17 resumes only after A-001 merges to `finite-state/integration`
- Result: pending merge. The plugin resolves the repo-pinned Zod 4.3.6 runtime directly, while the lockfile retains every pre-existing importer and package resolution unchanged.
