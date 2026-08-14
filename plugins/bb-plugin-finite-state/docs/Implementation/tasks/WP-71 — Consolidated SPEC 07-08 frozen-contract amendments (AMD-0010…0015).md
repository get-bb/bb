# WP-71 — Consolidated SPEC 07/08 frozen-contract amendments (AMD-0010…0015)

**Lane:** Amendment intake (gates L9/L10) · **Spec refs:** SPEC 07 §5, §7.2, §8 · SPEC 08 §5, §5.1, §6, §9.3, §9.5 · SPEC 06 §5.3 · AMENDMENTS.md AMD-0010…0015 · Master Plan §5.2 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** AMD-0010…0015 — approved 2026-08-13 by the product owner (supervisor thread `thr_rxxqm3px8s`); batch renumbered from AMD-0001…0006 at approval · **Blocks:** WP-72…WP-98; WP-39 must not start before the AMD-0010 matrix change lands
**Produces a FROZEN artifact:** yes — this is the only WP permitted to edit the frozen files and composition roots, and only under the approved AMD-0010…0015 text. After merge the artifacts re-freeze and CI updates the baseline hashes.

## Files you own

    plugins/bb-plugin-finite-state/lib/store/schema.ts            (AMD-0010)
    plugins/bb-plugin-finite-state/shared/contract.ts             (AMD-0011)
    plugins/bb-plugin-finite-state/lib/sync/registry.ts           (AMD-0012)
    plugins/bb-plugin-finite-state/lib/agentic/registry.ts        (AMD-0013)
    plugins/bb-plugin-finite-state/AGENTS.md                      (AMD-0013 — the "exact three" language)
    plugins/bb-plugin-finite-state/docs/Implementation/AGENTS.md  (AMD-0013 — same rule)
    plugins/bb-plugin-finite-state/package.json + pnpm-lock.yaml  (AMD-0014)
    plugins/bb-plugin-finite-state/server.ts, app.tsx             (AMD-0015)
    plugins/bb-plugin-finite-state/lanes/{hardware,grounding,authoring,debug-bench}/register.ts + register.app.tsx  (compiling stubs)
    tests beside each artifact (schema migration, contract, registry, destructive-flag)

## Files you must not touch

`lib/remote/types.ts` (no AMD covers it), `test/mock-remote/fixtures/**`, `frozen-artifacts.json`, `BASELINE.json` (CI, not this lane, updates baselines after merge), any existing lane's implementation, any `cat_*` DDL (catalog.db is a read-only sidecar outside `bb.storage.migrate` — SPEC 08 §5.1).

## Context

SPECs 07/08 arrived after the freeze, so their entire contract surface lands as one reviewed change rather than six drive-by edits. Every entry must match the approved AMENDMENTS.md text exactly; if implementation reveals the text is wrong, stop and get the amendment corrected — do not improvise at a frozen boundary. Nothing in L9/L10 dispatches before this merges.

The one structurally hard part: `bb.storage.migrate` keys statements positionally, so the `matrix_col`/`tier` CHECK vocabularies (`schema.ts` ~L621–656) inside already-applied statements are immutable. Extending `('static','emulation','hil','manual')` with `'hardware'` therefore appends a create-copy-swap rebuild of `verification_results` and the matrix definition table — new table with the widened CHECK, `INSERT INTO … SELECT`, drop, rename, recreate indexes — as ordinary appended statements.

## What to build

1. **AMD-0010 — schema.** Append `hw_project`, `hw_artifact`, `hw_symbol`, `hw_net`, `hw_violation` (SPEC 07 §5) and `ground_source` (including `license`/`redistributable`, SPEC 08 §4.2.1), `ground_chunk`, `bench_device` (including the claim-scope field, decision 9.5), `probe_run`, `build_run` (SPEC 08 §5), with the spec's indexes. Then append the create-copy-swap rebuild adding `'hardware'` to the `matrix_col` and `tier` CHECK vocabularies. Migration test proves a database migrated pre-amendment carries all rows through the rebuild.
2. **AMD-0011 — contract.** Add `hardware.*`, `grounding.*`, `authoring.*`, `benchDev.*` logical methods to `RPC_WIRE_METHODS` with wire names, Zod schemas, and `RPC_METHOD_CLASSIFICATIONS` entries. Every list method is paged `{items, total, cursor}`. Extend the tier/matrix enums with `hardware` in lockstep with step 1. Bump `CONTRACT_VERSION` to 2. Byte streams (SVG/GLB, gerber downloads, serial tail) stay on `bb.http`/realtime — no binary in RPC.
3. **AMD-0012 — sync registry.** Register `hardwareLink` (OVERLAY, server `none`, localOnly, dir `product-security/links`, keyed by reference designator), `citationFile` (OVERLAY, server `none`, localOnly, dir `.fs/authoring/citations`, keyed by source path), `authoringGate` (VERSIONED, server `none`, localOnly, file `.fs/workflows/authoring-gate.yaml`), and CACHED registrations for the AMD-0010 tables. All localOnly — no entity gains a push path; the plan/push engine and no-agent-push boundary are unchanged.
4. **AMD-0013 — agentic registry.** Extend the closed `ActionToolName` union per the approved text (`fs_hw_extract`, `fs_build`, `fs_flash`, `fs_serial`, `fs_probe`; see open question 1 on the nine-vs-eight count). Add `destructive?: true` to `AgentToolSpec` and implement the enforcement primitive: a destructive tool executes only on an explicit human instruction in the current turn — plan-inherited intent does not count — as one mechanism with one test (SPEC 08 §9.3). Mark `fs_flash` destructive. Update both AGENTS.md files' "exact three" language to the amended count.
5. **AMD-0014 — dependencies.** Declare `kicadts` and `@google/model-viewer` as the reviewed batch. `@xyflow/react` is already declared. `kicad-cli`, Python tooling, and instrument SDKs are host prerequisites, not npm dependencies. Per FS-158, missing host tools produce actionable advisories only on dependent lanes while the plugin remains running; `needsConfiguration` is reserved for missing required credentials.
6. **AMD-0015 — composition roots.** Add `registerHardware`, `registerGrounding`, `registerAuthoring`, `registerDebugBench` calls to `server.ts` and their `app.tsx` counterparts, each pointing at a compiling NOT_IMPLEMENTED stub at its lane's exact future-owned path, exactly as WP-01 did. After this lands the roots are frozen again; no L9/L10 package touches them.
7. Run the tripwires and the four-command gate; record prior/new artifact hashes in the AMENDMENTS.md entries as the accept tooling requires.

## Interface contract

    export const CONTRACT_VERSION = 2 as const;

    // RPC_WIRE_METHODS additions (logical → wire), all reads paged:
    "hardware.projects.list"    "hardware.symbols.list"   "hardware.nets.list"
    "hardware.violations.list"  "hardware.sheets.list"    "hardware.part.get"
    "hardware.artifacts.status" "hardware.extract.start"  "hardware.extract.status"
    "grounding.sources.list"    "grounding.query"         "grounding.coverage.get"
    "authoring.citations.list"  "authoring.quarantine.list" "authoring.gate.status"
    "benchDev.devices.list"     "benchDev.device.claim"   "benchDev.device.release"
    "benchDev.runs.list"        "benchDev.serial.session.get"

    export const ACTION_TOOL_NAMES = [
      "fs_verification_run", "fs_bench_run", "fs_firmware_materialize",
      "fs_hw_extract", "fs_build", "fs_flash", "fs_serial", "fs_probe",
      // final membership = the approved AMD-0013 text; see open question 1
    ] as const;

    export interface AgentToolSpec {
      // …existing fields unchanged…
      readonly destructive?: true; // executes only on explicit in-turn human instruction
    }

    -- appended migration sketch for the matrix rebuild (create-copy-swap):
    CREATE TABLE verification_results_v2 ( /* identical columns; tier CHECK gains 'hardware' */ );
    INSERT INTO verification_results_v2 SELECT * FROM verification_results;
    DROP TABLE verification_results;
    ALTER TABLE verification_results_v2 RENAME TO verification_results;
    -- + recreate its indexes; same pattern for the matrix definition table and matrix_col

## Acceptance criteria

- [ ] Every edit is covered by an `approved` AMD entry whose text it matches; no frozen file contains a change without one.
- [ ] **Owner condition (binding, from the 2026-08-13 approval):** the `verification_results` create-copy-swap rebuild is tested against a **populated** database — a database created and migrated at the pre-amendment head, seeded with rows in every pre-existing `matrix_col`/`tier` value and intact foreign-key references — with zero row loss, cell-content equality across the swap, and the widened CHECK accepting `'hardware'`. An empty-schema migration test alone does not satisfy AMD-0010.
- [ ] `CONTRACT_VERSION` is 2; every new list method returns `{items, total, cursor}` and every new method has a classification entry.
- [ ] All three new YAML entities are localOnly; the registry's push-eligible set is byte-identical to the pre-amendment set.
- [ ] The `ActionToolName` union is closed at the approved membership, the guard test enumerates all names, and no server-mutating tool was added.
- [ ] The destructive primitive is one mechanism with one test: `fs_flash` refuses plan-inherited intent and executes on an explicit in-turn instruction.
- [ ] `server.ts`/`app.tsx` gain exactly the four registration pairs; each stub compiles and registers nothing but a placeholder.
- [ ] No `cat_*` table appears in `schema.ts`; no dependency beyond the AMD-0014 batch; the four-command gate is green.

## Test plan

- `schema.migration.test.ts` — fresh migrate; pre-amendment DB upgrade with row-count/content equality across the rebuild; `'hardware'` accepted and `'hil2'` rejected by the new CHECK (**error path**); idempotent re-run.
- `contract.amendment.test.ts` — wire-name bijectivity, paged-shape conformance for every new list method, `CONTRACT_VERSION === 2`.
- `sync-registry.amendment.test.ts` — the three entities resolve localOnly; a hypothetical push plan over them is empty (**error path**: attempting to plan a push for `hardwareLink` fails closed).
- `agentic-registry.amendment.test.ts` — closed union membership; a tenth action name fails compile/test; destructive gate refuses inherited intent (**safety error path**) and passes with an in-turn instruction.
- Tripwires — `check-frozen-artifacts.mjs` and `check-dependency-freeze.mjs` pass against the amendment commit.

## Do not

- Do not edit or reorder any already-applied migration statement; append only (the pre-release base-rewrite exception requires its own amendment — see open question 2).
- Do not implement any lane behavior here; stubs compile and do nothing.
- Do not add `cat_*` tables, a push path, a server-mutating tool, or any dependency outside the AMD-0014 batch.
- Do not update `frozen-artifacts.json`/`BASELINE.json` yourself — CI owns baseline updates after merge.
- Do not encode the destructive gate as SDK approval metadata; recon confirmed no per-tool approval field exists. It is a plugin-side mechanism.

## Open questions

1. **The action-tool count does not reconcile.** The index and AMD-0013 say three→nine, and Master Plan §5.2 says "six new ACTION tools" — but the named tools total eight (three existing + `fs_hw_extract` + four from SPEC 08 §6). The contract owner must name the ninth tool or correct the count at approval; the union freezes on the approved enumeration, not the arithmetic.
2. If no `data.db` exists anywhere (pre-release), the base migration may legally be rewritten in place instead of appending the create-copy-swap rebuild — but only via an approved amendment. Confirm with the owner which form AMD-0010 approval sanctions; the rebuild is the plan of record.
3. AMD-0011 leaves per-method schemas to implementation. Where SPEC 07/08 UIs need fields the specs don't enumerate (e.g. sheet breadcrumbs), design them now — post-freeze additions cost another amendment.
