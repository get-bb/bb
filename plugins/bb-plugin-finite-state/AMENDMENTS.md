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
heading with all three exact fields below: a `Status` field exactly equal to
`approved` or `approved and merged`, an `Artifacts` list, and `Contract
version` (a number or `n/a`). Fenced examples are
documentation only and are never approval evidence.

```md
### AMD-0010 — Example only; this fenced text cannot authorize a change

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

### A-005 — Declare the established shared UI and Hugeicons dependencies

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `729a4ef78484d219bb510dfa3a4c1726d02e7328203c916de8ffdd3a75c5784c`
  - `pnpm-lock.yaml`: `dbeb4f897f85ff24d3129ce038814fd53818d1995ba36b948101559c91028d5c`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `422191d82ff75b7e1b0dca78a5b4a5598433b79d327c2e04d2f3028ad5d7b108`
  - `pnpm-lock.yaml`: `43d1a3c77970f882ba086044a7be1b0e2af2424d609ed396735019c85374e301`
- Reason: FS-46 requires `@bb/shared-ui` and Hugeicons UI. All three are established repository dependencies: `@bb/shared-ui` `workspace:*` is declared by all 13 other bundled plugins, while `@hugeicons/react` `^1.1.6` and `@hugeicons/core-free-icons` `^4.1.3` are already resolved via `plugins/secrets`.
- Migration: dependency declaration only, with existing package resolutions reused. No source contract, composition root, or product behavior changes.
- Affected WPs and gates: WP-32 (FS-46) and the dependency-freeze tripwire
- Contract owner: FS-46's own requirement text — “Use Hugeicons/shared-ui/theme tokens and all four states” — is the owner-intent anchor; the product owner was notified with veto opportunity before merge via the supervisor oversight thread
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_hnfg34qshf` at reviewed head `227281569277b8bcd58efaf084e783db41a7f139`

## Approved amendments — SPEC 07 / SPEC 08 intake

*Drafted 2026-08-12 as AMD-0001…0006. Approved 2026-08-13 by the product
owner (Matt), relayed via supervisor thread `thr_rxxqm3px8s`, under two
binding conditions: (1) the batch was renumbered to AMD-0010…0015 because
the identifiers AMD-0002 and AMD-0003 were already claimed by in-flight
amendments (duplicate-finding-ID dedup on PR #42; FS-65 firmware issuer-RPC
proposal); supervisor guidance of 2026-08-13 subsequently confirmed AMD-0004
and AMD-0005 are also claimed (WP-53's proposal PR #57 — AS
verification-result write; Forge process lifecycle seam), so the whole
AMD-0001…0005 range is off limits and AMD-0010…0015 is the confirmed range;
(2) the schema amendment AMD-0010 carries an explicit acceptance
criterion that the `verification_results` create-copy-swap rebuild migration
is tested against a populated database. WP-71 is the single implementation
task for AMD-0010 through AMD-0013 and AMD-0015; AMD-0014 is a
dependency-batch change. Artifact hashes are recorded by the accept tooling
(`check-frozen-artifacts.mjs --accept`) when WP-71 lands each change. Source
specs: `docs/Product Specs/SPEC 07` and `SPEC 08`.*

### AMD-0010 — Hardware and grounding tables; `hardware` verification matrix column

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0001
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/store/schema.ts`
- Contract version: n/a
- Note: schema.ts is not the wire contract; the contract-version gate applies only to `shared/contract.ts` (see AMD-0011)
- Change: append tables `hw_project`, `hw_artifact`, `hw_symbol`, `hw_net`,
  `hw_violation` (SPEC 07 §5) and `ground_source`, `ground_chunk`,
  `bench_device`, `probe_run`, `build_run` (SPEC 08 §5, including the
  `license`/`redistributable` columns from §4.2.1 and the claim-scope field
  from decision 9.5). Extend the verification matrix column vocabulary from
  `('static','emulation','hil','manual')` to include `'hardware'`
  (SPEC 07 §7.2; schema.ts lines ~621–656).
- Migration note: the new tables are ordinary append-only statements. The
  `matrix_col`/`tier` CHECK constraints are inside already-applied positional
  statements and are immutable post-freeze, so the vocabulary change appends a
  table-rebuild migration (create-copy-swap) for `verification_results` and
  the matrix definition table. SPEC 08's `catalog.db` (`cat_*` tables) is
  deliberately **out of scope**: it is a read-only sidecar artifact outside
  `bb.storage.migrate` (SPEC 08 §5.1) and never enters this schema.
- Acceptance criterion (owner condition, binding): the `verification_results`
  create-copy-swap rebuild migration must be tested against a **populated**
  database — rows in every pre-existing `matrix_col`/`tier` value, foreign-key
  references intact, and row counts and cell contents proven identical across
  the swap — not just against an empty schema. WP-71 does not merge without
  this test.
- Reason: SPEC 07 makes DRC/ERC results verification evidence and both specs
  cache derived hardware/grounding state; none of it is expressible in the
  frozen v1 schema.
- Affected WPs and gates: WP-71 (implementation); consumers WP-72…WP-98;
  WP-39 (matrix rendering) must not start before this lands.

### AMD-0011 — RPC contract surfaces for hardware, grounding, authoring, and bench devices

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0002 (that identifier is claimed by the duplicate-finding-ID dedup amendment on PR #42)
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 2
- Note: 2 assumes this is the next contract.ts change to land; if an in-flight contract amendment (e.g. the FS-65 issuer-RPC proposal) lands first, WP-71 renumbers this upward before accepting
- Change: add namespaced method groups — `hardware.*` (projects, sheets,
  symbols, nets, violations, artifact status, extract job control),
  `grounding.*` (sources, federated query with plane labels, catalog
  coverage), `authoring.*` (citation files, quarantine queue, gate pipeline
  status), `benchDev.*` (device registry, claim/release, serial session
  metadata, probe/build run history). Extend tier/matrix enums with
  `hardware` in lockstep with AMD-0010. Streams (SVG/GLB bytes, serial
  live tail, gerber downloads) stay on `bb.http`/realtime per SPEC 00 §5,
  not RPC.
- Reason: both new nav surfaces are frontend panels; the frontend's only
  data path is the frozen typed RPC contract.
- Affected WPs and gates: WP-71 (implementation); consumers WP-74…WP-96.

### AMD-0012 — Sync-registry entities for hardware links, citations, and the authoring gate

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0003 (that identifier is claimed by the FS-65 firmware issuer-RPC proposal)
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/sync/registry.ts`
- Contract version: n/a
- Change: register `hardwareLink` (OVERLAY, server `none`, localOnly, dir
  `product-security/links`, keyed by reference designator; SPEC 07 §6),
  `citationFile` (OVERLAY, server `none`, localOnly, dir
  `.fs/authoring/citations`, keyed by source file path; SPEC 08 §4.3),
  `authoringGate` (VERSIONED-local, dir `.fs/workflows`; SPEC 08 §9.4), and
  CACHED registrations for the AMD-0010 tables. All three YAML entities are
  local-only in v1 — nothing here gains a push path, so the plan/push engine
  and the no-agent-push boundary are unchanged.
- Reason: SPEC 01's registry is the single authority for entity classes;
  unregistered YAML dirs are invisible to `status`/drift handling.
- Affected WPs and gates: WP-71 (implementation); consumers WP-78, WP-79,
  WP-85, WP-95.

### AMD-0013 — ACTION-tool allowlist grows from three to nine; `destructive` primitive

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0004
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/agentic/registry.ts`
  - `plugins/bb-plugin-finite-state/AGENTS.md` (the "exact three" language)
  - `docs/Implementation/AGENTS.md` (same rule, §5 of non-negotiables)
- Contract version: n/a
- Note: the agentic registry is the compile-time authority, not a wire
  contract
- Change: extend the closed `ActionToolName` union with `fs_hw_extract`
  (SPEC 07 §8), `fs_build`, `fs_flash`, `fs_serial`, `fs_probe` (SPEC 08 §6).
  Add a `destructive: true` capability flag per SPEC 08 decision 9.3:
  destructive tools require an explicit human instruction **in the current
  turn** — intent inherited from an approved plan does not count — enforced
  by one mechanism and one test, not convention. `fs_flash` is the first
  `destructive` tool; `fs_serial` send (not read) sits behind confirmation.
- Safety argument: all six new tools invoke local subprocesses or local
  hardware. None mutates Platform or Assurance Studio. The model-mutation
  boundary (no push tool, human-only VEX/HBOM/lifecycle actions) is intact
  and unchanged. The allowlist guard's value — nobody adds a server-touching
  tool by accident — is preserved because the union stays closed and the
  guard test enumerates all nine by name.
- Reason: SPEC 06 §5.3 requires a recorded human decision to extend the
  ACTION class; SPEC 07 adds one tool and SPEC 08 adds five, which materially
  changes the safety posture and must not happen tool-by-tool.
- Affected WPs and gates: WP-71 (implementation); WP-60 (allowlist guard)
  must consume the amended union; consumers WP-81, WP-86…WP-96.

### AMD-0014 — Dependency batch for the hardware and authoring lanes

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0005
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
  - `pnpm-lock.yaml`
- Contract version: n/a
- Change: declare `kicadts` (KiCad S-expression parser, pure TS — used with
  no KiCad install) and `@google/model-viewer` (GLB rendering, SPEC 07 §3
  Tab 2). `@xyflow/react` is already declared via the canvas lane. Python-side
  tooling (probe runtime, PyVISA, vendor instrument SDKs) and `kicad-cli` are
  runtime host prerequisites detected via `needsConfiguration`, not npm
  dependencies, and are out of scope here.
- Reason: dependency freeze (WP-09) requires new packages to land as a
  reviewed batch.
- Affected WPs and gates: WP-72, WP-73, WP-74, WP-76; dependency-freeze
  tripwire.

### AMD-0015 — Composition-root registration for the L9/L10 lanes

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0006
- Artifacts:
  - `plugins/bb-plugin-finite-state/server.ts`
  - `plugins/bb-plugin-finite-state/app.tsx`
- Contract version: n/a
- Note: accepting this amendment is a baseline hash update for the
  composition-root guard
- Change: add the one-time registration calls for the new lanes —
  `registerHardware(bb, ctx)`, `registerGrounding(bb, ctx)`,
  `registerAuthoring(bb, ctx)`, `registerDebugBench(bb, ctx)` and their
  `app.tsx` counterparts — each pointing at a compiling stub in its lane
  directory, exactly as WP-01 did for the original nine lanes. After this
  lands, the roots are frozen again and no L9/L10 package touches them.
- Reason: the anti-collision design requires every lane's wiring to pre-exist
  in the roots; SPEC 07/08 add lanes that WP-01 could not anticipate. One
  root edit now, under amendment, preserves the "no lane ever edits a
  composition root" rule for the whole L9/L10 build.
- Affected WPs and gates: WP-71 (implementation); the WP-09 composition-root
  guard baseline; every L9/L10 package consumes the stubs.
