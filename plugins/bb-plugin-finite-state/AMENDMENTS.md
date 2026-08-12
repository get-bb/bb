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

## Structured entry format

The accept command recognizes only an unfenced level-three `A-*` or `AMD-*`
heading with all three exact fields below: `Status: approved`, an `Artifacts`
list, and `Contract version` (a number or `n/a`). Fenced examples are
documentation only and are never approval evidence.

```md
### AMD-0001 — Example only; this fenced text cannot authorize a change

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 2
```

## Approved amendments

### D-1/D-2 — Consolidated pre-freeze scope, publication, and boundary correction

- Status: approved and merged
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
  - `plugins/bb-plugin-finite-state/lib/store/schema.ts`
  - `plugins/bb-plugin-finite-state/lib/sync/registry.ts`
  - `plugins/bb-plugin-finite-state/lib/remote/types.ts`
- Contract version: 1
- Prior artifact hashes: pre-release candidates only; no registered/frozen store release exists
- New artifact hashes:
  - `shared/contract.ts`: `84bee6cab373316b2c4e47707c1c80b7a54a007d9ae2bf46862faad9cba8e905`
  - `lib/store/schema.ts`: `0494b18f8258ffbf6e66dd8c44bbfef99d6fe7f1c8d7853221d8ad0346e7cbef`
  - `lib/sync/registry.ts`: `e8b7390fa22546db0c727cbfbd7aac4155e00657459bec690f7106d9a3142a53`
  - `lib/remote/types.ts`: `933bf1672ff816879cd246d1e3e9a562c9e1da7bedf16e326d5f75fd12f8ba08`
- Reason: replace global/ambiguous storage keys with explicit project/product-version scope, publish only complete pull generations, bind writes to generation/revision/content fences, normalize paging/remote boundaries, and match pinned bb RPC naming/authorization limits
- Migration: rewrite the positional v1 base statements in place, including original primary keys, unique constraints, foreign keys, and indexes. Do not append D-1 repair migrations. Remove `CREATE TABLE IF NOT EXISTS` so an unexpected preexisting schema fails loudly.
- Pre-release safety proof: on 2026-08-12 a read-only search of `/Users/matt/.bb`, `/Users/matt/Documents/Projects`, and `/Users/matt/Library/Application Support` for finite-state `data.db`/SQLite files returned zero persistent instances. The plugin is unregistered and unreleased, so no developer database can contain a shipped positional statement.
- Cutoff: this in-place rewrite authority ends when the frozen v1 candidate merges/registers. After that point every shipped statement is immutable and changes append through `AMD-*` with a migration plan.
- Affected WPs and gates: Specs 00/01/05; HANDOFF; WP-03–06, WP-16–19, WP-45, WP-56; shared contract, registry, remote boundary, shared store, dependency/frozen guards; G0–G6. WP-02 is held until the consolidated migration candidate merges.
- Contract owner: Matt Wyckhouse; explicit approval recorded at https://github.com/mattwyckhouse/bb/pull/6#issuecomment-5270159899
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_runs4sfrby`
- Consolidation task/branch: FS-89 / PR #6, approved head `ab074586bed60af4ff58a794f0aa4a4b7fe231c2`
- Merge and broadcast commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Result: the four artifacts above are the authoritative frozen product contract activated by FS-23.

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

### A-001 — Declare the repo-pinned Zod runtime dependency

- Status: approved and merged
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `191f9e51eb84fa5e049a1cad9c4c719660a56cc2386dc8a2d00ad3f887ca545d`
  - `pnpm-lock.yaml`: `b99026a911e4d6cfff34c5a1acabd179f0d2923111f32a01c5f9d67928b26b7e`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `729a4ef78484d219bb510dfa3a4c1726d02e7328203c916de8ffdd3a75c5784c`
  - `pnpm-lock.yaml`: `dbeb4f897f85ff24d3129ce038814fd53818d1995ba36b948101559c91028d5c`
- Reason: WP-03 requires a runtime Zod import, but the plugin package cannot resolve Zod under an isolated Node 22.19 workspace install unless it declares the dependency directly. The repository override already pins Zod to 4.3.6.
- Migration: declare `zod` `^4.3.6` in the plugin runtime dependencies and add only that dependency to the finite-state lockfile importer, reusing the existing `zod@4.3.6` package resolution. No source contract, composition root, or product behavior changes.
- Affected WPs and gates: WP-03 (FS-17) and WP-09 dependency-freeze checks; Node 22.19 frozen install and the scoped finite-state typecheck/test/lint/build gate
- Contract owner: Matt Wyckhouse (absorbed into the explicit FS-89 approval)
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_runs4sfrby`
- Implementation base commit: `ba28401a45b31dd1e907a043138207505fb01a4f`
- Merge commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Broadcast commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Result: the plugin resolves the repo-pinned Zod 4.3.6 runtime directly, while the lockfile retains every pre-existing importer and package resolution unchanged.
