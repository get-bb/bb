# WP-85 — Citation store, quarantine & review queue — gutter annotations

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.3, §6, decision 9.4 · SPEC 07 §6 · SPEC 01 (OVERLAY discipline) · AMENDMENTS AMD-0012, AMD-0013 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-71, WP-82 · **Blocks:** WP-95, WP-96
**Produces a FROZEN artifact:** no — implements the AMD-0012 `citationFile` OVERLAY entity and consumes the frozen registry; acceptance stays human-only by construction

## Files you own

    plugins/bb-plugin-finite-state/lanes/authoring/citations/schema.ts
    plugins/bb-plugin-finite-state/lanes/authoring/citations/store.ts
    plugins/bb-plugin-finite-state/lanes/authoring/citations/quarantine.ts
    plugins/bb-plugin-finite-state/lanes/authoring/citations/resolve.ts
    plugins/bb-plugin-finite-state/lanes/authoring/cite-write.ts
    plugins/bb-plugin-finite-state/lanes/authoring/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/authoring/app/authoring-tab.tsx
    plugins/bb-plugin-finite-state/lanes/authoring/app/gutter-annotations.tsx
    plugins/bb-plugin-finite-state/lanes/authoring/app/review-queue.tsx
    plugins/bb-plugin-finite-state/lanes/authoring/app/citation-diff.tsx
    plugins/bb-plugin-finite-state/lanes/authoring/citations/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/authoring/app/**/*.test.tsx

WP-86 owns `lanes/authoring/register.ts` and pre-wires the `authoring.*` citation RPC seams to these exact paths; replace its NOT_IMPLEMENTED placeholders in place, or create the modules at these paths if WP-86 has not landed. `register.app.tsx` replaces WP-71's authoring app stub (route `/firmware/authoring`).

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/authoring/register.ts, lanes/authoring/build/**, lanes/grounding/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

Citation gating is SPEC 08's core mechanic and it is not optional: **every generated hardware-touching constant** — register address, bit field, timing value, clock divider, pin assignment — **carries a citation** to a document (plane B, via WP-82 anchors), a schematic net (SPEC 07, cite the kicad source), or the RE corpus (WP-97 later). **An uncited value is not written; it is quarantined** into a review queue that blocks the write and opens a review item.

The store is the citation overlay: `.fs/authoring/citations/<file>.yaml`, the AMD-0012 `citationFile` OVERLAY entity — git-tracked, reviewable as a diff, keyed by source file path, local-only with no push path. The YAML files are the truth; any SQLite index this WP builds for queue/count queries is CACHED and rebuildable from the files.

**Acceptance is human-only.** `fs_cite_write` (registered by WP-96, implemented here) writes citation entries and quarantines uncited ones; no agent-reachable path may flip a quarantined value to accepted. This is the same architectural gate as the no-push rule: the capability does not exist in the agent's toolset. The quarantine check is also the `no_quarantined_values` gate rule the WP-95 pipeline consumes.

## What to build

1. Citation YAML schema (zod), version 1, matching SPEC 08 §4.3 exactly: `file`, `values[]` with `symbol`, `value`, `citation` (document | kicad | re_corpus | null), `confidence`, optional `status`/`note`. Path mapping `src/x.c → .fs/authoring/citations/src/x.c.yaml`; parse failures are diagnosable errors naming the file and line, never silent skips.
2. Store: read/write overlay files atomically (temp + rename), stable key order and formatting so diffs are minimal; maintain a CACHED SQLite index (file, symbol, status, source id) rebuilt on demand from the YAML — the files stay authoritative.
3. `fs_cite_write` service: validates each proposed value. An entry with a resolvable citation writes as `cited`; `citation: null` writes as `status: quarantined` with a required `note`, opens a review item, and reports the quarantine in the tool result. Returns worktree-relative path plus a bounded field-level diff summary per WP-57 write conventions — never bare `{ok:true}`.
4. The quarantine gate: `checkCitations(files)` returns pass/fail with the exact quarantined symbols. This is the blocking primitive — WP-95 workflows call it before any generated constant lands in source, and the §9.4 `citations` gate rule delegates to it. This WP ships the check; WP-95 owns wiring it into workflow sequencing.
5. Citation resolution (`resolve.ts`): document citations resolve `{doc, page, table}` against the WP-56 ledger and WP-82 anchors into a clickable viewer locator; kicad citations `{source: "kicad", ref, net, sheet}` validate shape and link into the SPEC 07 hardware panel when that lane is present (absence degrades to display-only, not an error); a citation whose target no longer resolves is flagged `stale`, never dropped.
6. Review queue: paged list of quarantined values across files — symbol, value, note, file, age. Lifecycle `quarantined → accepted | rejected`, recording actor and timestamp in the YAML entry. Acceptance and rejection are reachable only through the review RPC driven by the panel UI; the agentic seam exposes no such method.
7. Diff view: accepting a value shows exactly what will be written — the source-file constant and the overlay status flip — then writes both and records the acceptance. Rejecting records the rejection and leaves the source untouched.
8. Gutter annotations: per-value coverage as `cited / inferred / quarantined` markers aligned to file lines (best-effort symbol→line resolution by lexical search; unresolved symbols list in a side rail rather than guessing a line). `inferred` renders for cited entries with confidence below 1.0.
9. Authoring tab shell: generated-files list with per-file coverage ratio, gutter view, review queue, diff view; four designed states; theme tokens and Hugeicons; `authoring:changed` realtime hint after committed changes. Implement the `CitationCountProvider` WP-84 consumes, replacing its stub in place.

## Interface contract

    # .fs/authoring/citations/<file>.yaml — OVERLAY (AMD-0012 citationFile), git-tracked
    version: 1
    file: src/drivers/bme280.c
    values:
      - symbol: BME280_I2C_ADDR
        value: "0x76"
        citation: { doc: "BME280-DS002.pdf", page: 32, table: "6.2" }
        confidence: 1.0
      - symbol: I2C1_SCL_PIN
        value: "PB6"
        citation: { source: "kicad", ref: "U2", net: "I2C1_SCL", sheet: "sensors.kicad_sch" }
        confidence: 1.0
      - symbol: BME280_STARTUP_DELAY_MS
        value: "2"
        citation: null
        status: quarantined            # blocks the write, opens a review item
        note: "Inferred from typical startup times; not found in datasheet"

    export type Citation =
      | { doc: string; page: number; table?: string }
      | { source: "kicad"; ref: string; net: string; sheet: string }
      | { source: "re_corpus"; corpusId: string; ref: string };

    export type ValueStatus = "cited" | "inferred" | "quarantined" | "accepted" | "rejected";

    export function writeCitations(ctx: AuthoringContext, file: string, values: CitationValueInput[]): WriteResult;
    export function checkCitations(ctx: AuthoringContext, files: string[]): { ok: boolean; quarantined: QuarantinedRef[] };
    export function listQuarantine(ctx: AuthoringContext, q: PageQuery): Page<ReviewItem>;
    export function resolveCitation(ctx: AuthoringContext, c: Citation): ResolvedCitation | { stale: true; reason: string };

RPC names/shapes come from the frozen AMD-0011 `authoring.*` group; the review-transition methods exist only on the RPC surface, never in the agentic registry.

## Acceptance criteria

- [ ] YAML round-trips byte-stable through the store; the §4.3 example parses exactly; a hand-corrupted file fails with file/line diagnostics.
- [ ] A value with `citation: null` is never written as cited: it quarantines, blocks `checkCitations`, and appears in the review queue.
- [ ] No agent-reachable path (tool service, CLI mutation, RPC exposed to the agentic seam) can accept or reject a quarantined value; a test proves the absence structurally, WP-57-style.
- [ ] Acceptance via the panel writes the value, flips status with actor and timestamp, and both changes appear in one reviewable git diff.
- [ ] Document citations click through to the exact page/anchor; kicad citations render ref/net/sheet and deep-link when the hardware lane is present.
- [ ] A citation whose document SHA or net no longer resolves flags `stale` and is never silently dropped.
- [ ] The SQLite index is CACHED only: deleting it and rebuilding from YAML yields identical queue and count results.
- [ ] Queue and list RPCs are paged `{items, total, cursor}`; gutter/queue/diff UI has all four designed states with tokens and Hugeicons.

## Test plan

- schema.test.ts — §4.3 example fidelity, all three citation shapes, unknown citation shape rejected with hint, version gate, malformed YAML → file/line diagnostic (**error path**).
- store.test.ts — atomic write, stable formatting/minimal diffs, index rebuild equivalence after index deletion, concurrent write of two files.
- quarantine.test.ts — null citation quarantines with required note, `checkCitations` fails naming exact symbols, accepted values pass, re-quarantine on value change.
- cite-write.test.ts — write result carries relative path and bounded diff summary; an attempted status transition through the write service is rejected (**safety error path**).
- resolve.test.ts — document locator resolution, missing document SHA → `stale`, kicad shape validation with hardware lane absent.
- review-queue.test.tsx / gutter-annotations.test.tsx — paged queue, human accept/reject flow recording actor, cited/inferred/quarantined markers, unresolved-symbol side rail, four states.

## Do not

- Do not write an uncited hardware constant anywhere, ever — quarantine is the only path for `citation: null`.
- Do not expose accept/reject through any agent tool, CLI mutation, or agentic-seam RPC; acceptance is human-only.
- Do not make the SQLite index authoritative or let it diverge from the YAML truth.
- Do not accept filename-only document citations — page (and table where present) is the minimum, per WP-56's evidence rule.
- Do not add a push path for `citationFile`; it is local-only per AMD-0012.
- Do not register agent tools, mentions, directives, or CLI here; WP-96/WP-64 consume the exported services.

## Open questions

1. Symbol→line mapping for gutters is lexical in v1; whether a compile_commands/clangd-assisted resolver is worth a later host prerequisite should be judged after real driver files exist.
2. The `inferred` threshold: is any confidence < 1.0 "inferred", or only specific citation shapes (e.g. document-plane at ~0.72)? Needs one rule shared with WP-84's display before WP-96 writes skill prose.
3. Whether acceptance of a quarantined value should require a replacement citation ("cite or justify") or allow a recorded human waiver — SPEC 08 implies waiver-with-note; confirm with the gate-pipeline owner (WP-95) since it changes the `no_quarantined_values` semantics.
