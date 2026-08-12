# Work Package Index

*70 work packages across nine logical lanes. Start with `HANDOFF — Product & Architecture.md`, then the accepted direct-API ADR and `api-reference/README.md`, then the Master Plan, AGENTS, the scheduling bootstrap/manifest, and your WP. The ADR and frozen interfaces outrank historical Forge-first recon on transport ownership.*

**Status legend:** ✅ detailed implementation spec written

---

## How to use this index

Each WP is a self-contained unit sized for one coding agent working one to four days. A WP file contains: files owned, files forbidden, context, numbered build steps, a real interface contract, checkbox acceptance criteria, a named test plan including an error path, a "do not" list, and open questions.

**Dependencies are hard.** Do not start a WP whose `Depends on` set is incomplete — the frozen interfaces it consumes will not exist and you will invent an incompatible one.

**FS-93 adds a scheduling overlay.** [`scheduling/wp-coupling-manifest.json`](../scheduling/wp-coupling-manifest.json) covers every remaining unstarted WP exactly once and may add a predecessor edge between packages that share one decision owner. The union of a WP's product prerequisites and manifest dependencies is the effective dispatch graph. Read [`scheduling/PROGRAM-BOOTSTRAP.md`](../scheduling/PROGRAM-BOOTSTRAP.md) for the binding verdicts and [`scheduling/COORDINATOR-RUNBOOK.md`](../scheduling/COORDINATOR-RUNBOOK.md) before assigning work.

The 70 historical WP keys remain intact: 64 were unstarted at the FS-93 audit point and map to 28 remaining decision-owner clusters. No WP was merged. Keep the four-lane cap until WP-10 through WP-13 and the machine readiness gate complete; then cap at six, with promotion to nine conditional on the runbook's dependency, workflow, and disk checks.

**Five artifacts are frozen** and may not be edited by any lane: `shared/contract.ts` (WP-03) · `lib/store/schema.ts` (WP-04) · `lib/sync/registry.ts` (WP-05) · `lib/remote/types.ts` (WP-06) · `test/mock-remote/fixtures/**` (WP-08). Plus the two composition roots from WP-01. Need a change? Write to `AMENDMENTS.md` and stop.

---

## Critical path

**WP-01 → WP-03 → WP-05 → WP-06 → WP-08 → WP-13 → WP-17 → WP-22…30 → WP-57…64 → WP-65…70**

Staff this path with your strongest agents. Keep a human reviewer on WP-03/04/05/06 — a mistake in a frozen file is the only thing in this build that can cost a week.

---

## L0 — Foundation *(2 agents, ~1 wk wall-clock)*

| WP | Title | Effort | Depends on | Frozen | Status |
|---|---|---|---|---|---|
| 01 | Repo scaffold, manifest & composition roots | 1.5 d | — | **yes** | ✅ |
| 02 | Register plugin in bb builtin registry | 0.5 d | 01 | no | ✅ |
| 03 | `shared/contract.ts` — every RPC contract | 2 d | 01 | **yes** | ✅ |
| 04 | `lib/store/schema.ts` — every table + migrations | 2 d | 01 | **yes** | ✅ |
| 05 | `lib/sync/registry.ts` — the entity registry | 1.5 d | 03, 04 | **yes** | ✅ |
| 06 | `lib/remote/types.ts` — direct services & optional compute contracts | 1.5 d | 01 | **yes** | ✅ |
| 07 | FSDS theme, tokens & `lib/format.ts` | 1.5 d | 01 | no | ✅ |
| 08 | Mock fixture corpus & seed-data generator | 2 d | 04, 06 | **yes** | ✅ |
| 09 | CI gates, custom lint rules & dependency freeze | 1 d | 01 | no | ✅ |

**WP-02 scope.** The one sanctioned out-of-directory change. Add the entry to `apps/server/src/services/plugins/builtin-registry.ts` and update the two lockstep test files with hardcoded assertion lists (`official-plugins.test.ts` ~L87-102, `builtin-plugins.test.ts` ~L189-219) plus `docs/official-plugin-release-process.md`. Add a `turbo.json` build-ordering block only if the SDK-build-first pattern is needed (mirror the `bb-plugin-tasks#build` block). Record everything in `FORK-DELTA.md`.

**WP-07 scope.** Ship FSDS as a bb theme (`themes/fsds-dark.css`), declared in the manifest — themes are *not* registered via `definePluginApp` (RECON §1.3). Source tokens from `/CEO Strategy/Design System/`. Embed Space Grotesk + Instrument Sans as base64 so the theme is single-file. Then `lib/format.ts`: severity, CVSS, EPSS, dates, hashes, purl shortening, byte sizes. Every formatter is pure and unit-tested. **No hex anywhere in component code** — the theme defines tokens, components consume them.

**WP-08 scope.** The seed corpus every lane's tests assert against. Target: one product version with **~4,000 findings** across ~180 components, a 12-node TARA model, 40 requirements, a 900-entry SBOM, a 6,000-file firmware tree, and 6 documents. Generated deterministically from a seed so it's reproducible and diffable; committed as fixtures. Must include the awkward cases on purpose: duplicate finding rows, a component with no purl, a finding whose component version changed between scans, a soft-deleted-then-re-confirmed finding, and a requirement with no verification.

**WP-09 scope.** The guards that keep nine lanes honest. (a) **Composition-root guard** — CI fails if `server.ts` or `app.tsx` differs from the WP-01 baseline without a matching `AMENDMENTS.md` entry. (b) **Frozen-interface guard** — same for the five frozen files. (c) **Token-only lint rule** — reject hex/oklch/arbitrary Tailwind colors in `lanes/**`. (d) **Icon rule** — reject Lucide imports and emoji in JSX. (e) **Dependency freeze** — CI fails on `package.json` dependency diffs outside a designated batch commit. (f) The four-command gate wired into CI: `turbo run typecheck test lint build --filter=bb-plugin-finite-state`.

---

## L1 — Remote services & mocks *(2 agents, ~1.5 wk)*

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 10 | Remote-service mock skeleton — vendored API generation & route tables | 2 d | 06 | ✅ |
| 11 | Mock: findings, VEX, SBOM & components | 2 d | 10, 08 | ✅ |
| 12 | Mock: AS/TARA + requirements, Platform firmware, optional compute jobs | 2.5 d | 10, 08 | ✅ |
| 13 | **Mock: fault injection & live-drift quirks — GATE** | 2 d | 11, 12 | ✅ |
| 14 | Direct remote clients & optional Forge compute — auth, limits, jobs | 4 d | 06 | ✅ |

**WP-10 scope.** Generate independent Platform and AS mock route inventories from `docs/Implementation/api-reference/`, not a sibling checkout. Read the provenance/authority index first. The AS snapshot is incomplete, so patch only handler-backed gaps recorded in the vendored notes/audit. Unknown routes remain absent. **Rule: handler evidence wins over the incomplete spec; closed WP-06 interfaces win over both at runtime.**

**WP-11 scope.** Implement the raw Platform routes and adapter-visible domain behavior L3/L5 need: projects/versions, paged findings/detail/activity/comments/summary, VEX single/bulk/clear, SBOM download, components/search, firmware-independent error envelopes. Do not emulate Forge file-path-return wrappers; direct clients return pages or byte streams. Keep AS project-SBOM packages in the AS mock. Use the exact six/five/nine VEX vocabulary frozen in WP-06.

**WP-12 scope.** Build three separate mock modules: AS entity/TARA/requirements/verification routes; Platform firmware tree/meta/range/full streams plus the ten security-assessment relays; optional Forge compute (`verifyDynamic`, `penTestRun`, root preparation, job status/list). There is no `as_raw_api` mock and no generic tool dispatch. Attack paths are non-creatable; range caps at 128 KiB; jobs use `RUNNING|COMPLETED|FAILED|TIMEOUT`.

**WP-13 scope — the gate.** Two halves, both mandatory. **Fault injection**, switchable per-request via a header or scenario file: 409 `stale_tara_state` (exact body from RECON §2.8) · 403 on firmware byte modes · 429 with `Retry-After` · partial bulk failure (some `results[]` entries fail) · silent `.strict()` key-drop (accept the write, return 200, persist only known keys) · mid-push connection reset. **Live-drift quirks**, reproduced exactly: `/findings/{pv}/{fid}/cves` returns a CVE-keyed **dict**, not a list · severity counts nest as `{"bySeverity":{...},"total":N}` · CSV export ends with `# rows_written=N rows_skipped=M` · AS envelope is `{success:true, data:{items,total,page,pageSize,hasMore}}` with 1-based `page` and camelCase `pageSize`. Acceptance must be strong enough that a lane starting the next morning is genuinely unblocked.

**WP-14 scope.** Implement direct backend `fetch` clients for Platform (`X-Authorization`) and AS (`X-API-Key`), plus a nullable MCP `ForgeComputeClient`. Each has independent configuration, health, limiter, error normalization, and contract tests. Byte responses stream server-side. Do not proxy Platform/AS through Forge, do not retry ambiguous writes, and do not expose arbitrary routes or MCP tool names. Core integration tests run with Forge absent.

---

## L2 — Sync engine *(2 agents, ~2.5 wk)* · SPEC 01

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 15 | Serializer framework & the exclusion list | 2 d | 01, 05 | ✅ |
| 16 | Base snapshot store & `id_map` | 1.5 d | 04, 15 | ✅ |
| 17 | **`pull` + `status` for one OVERLAY entity — GATE** | 3 d | 06, 13, 15, 16 | ✅ |
| 18 | `plan` — diff, validation, ordering, blast radius | 3 d | 17 | ✅ |
| 19 | `push` — chunking, base advance, resumability, read-back | 4 d | 18 | ✅ |
| 20 | Conflict detection & field-level resolution | 3 d | 18 | ✅ |
| 21 | The review panel UI | 3 d | 18, 20, 07 | ✅ |

**WP-19 scope.** Apply the plan against the backend's real shape. Per-row calls for core entities (**no bulk create/update exists**), chunked and rate-limited; **VEX is the exception** — `batch_set_vex_status`, cap 500. Diff before writing (an identical re-PUT still bumps timestamps and emits an audit row, so `noop` items are skipped, not re-sent). **Advance base per entity** on each success so a failed push leaves a coherent, partially-advanced state. Bracket TARA content writes between a head check and a `POST /versions` checkpoint with `expectedHeadVersionId`. **Read-back verification** on routes where `.strict()` isn't applied — a 200 is not proof. Stamp provenance where the API allows (`[bb:{run-id}]` in `vex_reason`). Resumable from `push_log`.

**WP-20 scope.** Field-level, not file-level — these are records, not prose, and YAML with `<<<<<<<` can be invalid. Present base/ours/theirs with server audit attribution (who, when). Explicit per-item resolution: `take-ours`, `take-theirs`, or edit. Auto-merge only where safe: different fields on the same entity, and set-operations on graph nodes/edges. **Never auto-merge same-field edits.** Per-surface policy defaults — for VEX, *theirs-wins on human server edits*, because the server cannot distinguish our stale write from an intentional override.

**WP-21 scope.** The plan as a first-class UI, because it's a demo moment: *the agent proposed changes to your security model — here's the exact diff — approve to push.* Grouped by operation, collapsible; each row expands to a field-level diff rendering the **domain component inline** (a threat diff shows a `<ThreatCard>`, not raw YAML); conflicts inline with resolution controls; footer with blast-radius summary and a single Push button disabled while conflicts remain; post-push per-item results with retry. Lives at the `sync` nav route, reachable from a pending-count chip in every panel header.

---

## L3 — Findings & VEX triage *(2 agents, ~3 wk)* · SPEC 02 — the flagship

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 22 | Findings cache & pull pipeline | 2.5 d | 04, 05, 13 | ✅ |
| 23 | **Stable-key tier ladder & `resolve()`** | 3 d | 05, 22 | ✅ |
| 24 | Findings table panel — virtualized, filters, saved views | 4 d | 22, 07 | ✅ |
| 25 | Finding detail view & cross-surface links | 2.5 d | 24 | ✅ |
| 26 | Manual triage flow & keyboard shortcuts | 3 d | 25, 27 | ✅ |
| 27 | YAML overlay writer & `overlay_index` | 2.5 d | 23, 15 | ✅ |
| 28 | Policy-as-code engine & dry-run | 3 d | 27 | ✅ |
| 29 | Bulk apply & partial-failure handling | 2.5 d | 19, 27 | ✅ |
| 30 | Re-scan drift, orphans & vendor VEX import | 3 d | 23, 29 | ✅ |

**WP-23 is the highest-risk item in the build.** Findings have no unique business key by design — the unique index was deliberately dropped because legacy data carries legitimate duplicates, and ingest dedupes by anti-join rather than upsert. Two consequences: finding UUIDs are **per-version ephemeral**, and a monitor soft-delete → re-confirm cycle silently loses triage. So key every overlay decision on stable business identity: `(project, component-identity, CVE)` with the tier ladder **purl → case-folded (name, group, version) → (name, group) any-version**. This is the platform's own `carry_forward_vex` ladder — matching it means our decisions re-attach the way the platform's do, and where carry-forward fails (non-fatal, unretried) **our overlay becomes the recovery mechanism**. The `pin` field encodes promotability: `exact_version` vs `any_version`, mirroring the rule that **`CODE_NOT_REACHABLE` never promotes across versions** because it's build-specific. Exhaustive test matrix required.

**WP-24 scope.** 4,000 rows at 60fps via TanStack Virtual. Columns: severity, CVE, component, version, reachability verdict, KEV, EPSS, triage status, local-change indicator. Filters that matter: severity, reachability, KEV, EPSS band, component, triage status, has-local-change. Saved views persisted in `bb.storage.kv`. Bulk selection including select-by-predicate. Three-tier local-change indicator (none / local edit / conflicted).

**WP-26 scope.** Triage must feel fast — that's the whole product claim. Full keyboard model: `j/k` navigate, `Enter` open detail, six status letters mapping to the six VEX statuses, `u` undo, `/` focus filter, `x` select, `Shift-X` select range, `b` bulk-decide selection, `?` shortcut sheet. Every action writes local YAML only; nothing touches the server.

**WP-28 scope.** `.fs/triage/policy.yaml` as reviewable rules-as-code, porting fs-report's band rules and AS's holdback rules. Rule schema with match predicates and a decision. Dry-run that reports what *would* change without writing. **Never clobber a human decision** — policy fills gaps, it does not overwrite. Doubles as the specification for a future server-side policy engine.

**WP-30 scope.** Three distinct behaviors. **Drift**: on a version bump, re-attach decisions via the tier ladder; report what re-applied, what went stale, what could not attach. **Orphans**: decisions whose stable key no longer resolves — surfaced in `status`, never silently dropped. **Vendor VEX import**: ingest a supplier's VEX document, map to stable keys, present as proposals in the review queue rather than facts.

---

## L4 — Product Security *(3 agents, ~3 wk; canvas is its own sub-lane)* · SPEC 03

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 31 | **Canvas spike & React Flow/elkjs port foundation — GATE** | 4 d | 07 | ✅ |
| 32 | Canvas node types, dataflows & inspector | 4 d | 31 | ✅ |
| 33 | Canvas threat overlay (STRIDE micro-bars) & attack paths | 3 d | 32 | ✅ |
| 34 | Canvas cross-surface links & layout persistence | 2.5 d | 32 | ✅ |
| 35 | Canvas editing → YAML → plan | 3 d | 34, 18 | ✅ |
| 36 | Requirements EARS schema, validation & cards UI | 4 d | 05, 07 | ✅ |
| 37 | Requirements traceability view & filters | 2.5 d | 36 | ✅ |
| 38 | EARS conversion flow (agent + three gates) | 3 d | 36 | ✅ |
| 39 | Verifications matrix (requirement × tier) | 3 d | 36 | ✅ |
| 40 | Verification run detail, attestations & TARA concurrency | 3 d | 39, 19 | ✅ |

**WP-31 is a go/no-go gate.** Spike first (Master Plan §11, S1): port one node type plus elkjs layout into a bare bb panel and time it. React Flow v12 (`@xyflow/react`) is portable from AS — recon found only one Next.js import to remove. If the spike runs long, the rest of L4 does not commit until it's resolved.

**WP-33 scope.** The threat overlay is what makes the canvas more than a diagram: STRIDE micro-bars per node, attack paths rendered as highlighted traversals, bidirectional selection with the threat table.

**WP-34 scope.** The four cross-surface links AS cannot do — node → SBOM entry, node → files in the firmware mount, node → requirements that mitigate it, node → verification runs. **This is the payoff of one workspace** and should be treated as a demo asset, not a nicety. Layout lives in `product-security/layout/canvas.json`, separate from the model, and is never pushed — positions change on every drag and would otherwise make each pan a diff.

**WP-36 scope.** EARS objects as **cards, not rows**. Six patterns (ubiquitous, event-driven, state-driven, unwanted-behavior, optional-feature, complex). Verification contract inline on the card. Status ladder verified/partial/failed/not-run/stale, with the hard rule: **status is derived — there is no "mark verified" button, only "run verification"**, because `requirements.verification_status` is agent-service-derived and web-unwritable. Encode that as a plan-time guard, not a UI convention.

**WP-40 scope.** Includes the TARA concurrency bracket: head check → per-row apply → `POST /versions` with `expectedHeadVersionId`, handling 409 `stale_tara_state`. Attestations displayed with their binding to the firmware digest.

---

## L5 — Bill of Materials *(1 agent, ~3.5 wk)* · SPEC 04

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 41 | SBOM cache, pull & vuln rollup | 2.5 d | 13, 04 | ✅ |
| 42 | SBOM table panel, row expansion & cross-links | 3 d | 41, 07 | ✅ |
| 43 | SBOM export (CycloneDX/SPDX) via `bb.http` | 1.5 d | 41 | ✅ |
| 44 | HBOM schema & the provenance cell model | 3 d | 04, 05 | ✅ |
| 45 | HBOM UI, confidence display & review queue | 4 d | 44, 07 | ✅ |
| 46 | HBOM extraction merge engine & XLSX export | 4 d | 44, 56 | ✅ |

**WP-44 is the credibility backbone.** Every HBOM field is a `{value, provenance, source_ref, confidence, by, at}` cell — confidence numeric 0–1, bands display-only. An HBOM full of confidently-wrong part numbers is worse than no HBOM, so the cell model is the feature, not the container. Distinguish bare-null (`—`, never asserted) from human-null (`n/a`, deliberately empty).

**WP-45 scope.** Low-confidence and inferred cells are visually distinct (dashed underline, muted); hover reveals the source — *"MPN from datasheet_p7.pdf, confidence 0.72, extracted by agent 2026-07-29."* Agent extractions are presented as **proposals, not facts**, and acceptance is human-only. Review queue with bulk accept/reject.

**WP-46 scope.** Eight precedence rules for merging extractions from multiple documents; never silently overwrite. Export via `exceljs` through `bb.http` (RPC is JSON-only) with four sheets including a **mandatory provenance ledger**, plus a verified-only mode. CycloneDX-HBOM JSON is optional and **its field schema needs verification before any customer-facing claim** — flag it, don't assume ECMA-424 shape.

---

## L6 — Firmware, Bench & Documents *(2 agents, ~3.5 wk)* · SPEC 05

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 47 | Firmware cache layout, `manifest.sqlite` & content addressing | 2.5 d | 04 | ✅ |
| 48 | `standalone_unpack.py` driver — the primary path | 3 d | 47 | ✅ |
| 49 | API per-file fallback & admin-gate handling | 2 d | 47, 13 | ✅ |
| 50 | Optional Forge compute root preparation & ordering constraint | 1.5 d | 48 | ✅ |
| 51 | Firmware UX — pull job, status chip, binary opener, version diff | 3 d | 07, 48, 49 | ✅ |
| 52 | Bench data model — runs, results, artifacts, attestations | 2 d | 04 | ✅ |
| 53 | Bench tiers 0–1 execution (static + rehosted) | 4 d | 52, 50 | ✅ |
| 54 | Bench timeline panel, run detail & live log tail | 3 d | 07, 52, 53 | ✅ |
| 55 | **The safe-to-OTA verdict card** | 2 d | 54 | ✅ |
| 56 | Documents store, viewer, extraction overlay & upload | 3.5 d | 04, 07 | ✅ |

**WP-48 is the primary path, not the fallback.** Recon settled this: firmware byte modes require org-admin `VIEW_ANY_PROJECT_FILE`, ranged reads cap at 128 KiB, `full` mode requires `save_to`, and there is no tarball export endpoint. Materializing a 6,000-file rootfs per-file is not viable. So local unpack leads. Note `standalone_unpack.py` is **not pip-installable** — it needs the FACT-extractor Docker image (`localhost:5000/services-unpack:latest`). Contract: `snapshot.json` with `input_sha256`, `file_tree[]`, `unpack_metadata{}`, `errors[]` — **surface the errors so unpack gaps are visible, not silent.**

**WP-50 scope.** After direct Platform/local materialization, produce a sealed preparation record with the verified tree digest. The pinned Forge commit has no runtime root-registration method, so same-host stdio may pass the firmware-root environment only while starting/restarting the plugin-owned process; remote/persistent Forge reports unsupported. `ForgeComputeClient.prepareFirmwareRoot` remains non-freezeable until that lifecycle is proven or a later reviewed method is checksummed. **Fully materialize and digest before dispatching.** Core firmware browsing must not depend on this WP.

**WP-55 scope.** The single most demo-important component in the build. Deterministic green/amber/red logic tied to the SPEC 03 matrix, the firmware digest it's bound to, and the evidence behind the verdict. It must be legible in three seconds to someone who has never seen the product.

**WP-56 scope.** Documents live at `product-security/documents/<sha256>-<name>`, git-tracked, with one shared ledger. Browser upload goes through `bb.http` (binary, not RPC). Documents are plugin-local in v1 because direct AS signed-upload/finalize/download methods are not yet frozen; Forge is never the transport. File the typed AS binary-method ask rather than adding a raw request seam.

---

## L7 — Agentic surfaces *(1 agent, ~2 wk, trails the surfaces)* · SPEC 06

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 57 | Agent tool registry, conventions & error shapes | 2 d | 01 | ✅ |
| 58 | Read tools | 2.5 d | 18, 22–30, 36–46, 52–57 | ✅ |
| 59 | Write tools (YAML only) | 3 d | 27, 28, 36, 44, 46, 57 | ✅ |
| 60 | Action tools & the allowlist guard | 2 d | 40, 49, 50, 53, 57 | ✅ |
| 61 | Directives — all twelve | 3 d | 21, 25, 28, 32–40, 42, 45, 54–57 | ✅ |
| 62 | Mention providers | 2 d | 22, 23, 36, 41, 44, 52, 56, 57 | ✅ |
| 63 | Skills tree — root plus per-surface | 2.5 d | 58–60, completed surface contracts | ✅ |
| 64 | CLI — the full `bb finite-state` tree | 2.5 d | 57, completed domain services | ✅ |

**WP-57 scope.** The conventions that make sixteen tools coherent: read tools return **summaries with ids, not dumps** (context economy); pagination with a token budget; write tools return the **file path written plus a diff summary**; error shapes that teach recovery rather than just failing; idempotency; and the pairing rule — `fs_findings_query` returns ids, the agent renders `::fs-finding{id}`.

**WP-60 scope.** Three tools may invoke server-side actions: `fs_verification_run`, `fs_bench_run`, `fs_firmware_materialize` (byte modes). They are ACTION-ONLY — they invoke, they don't mutate the model. **Recon killed the assumption that bb can approval-gate individual tools** (there is no `requiresApproval` field and the generic approval UI isn't per-tool configurable), so the guard is architectural: a compile-time allowlist, and a test that fails if a fourth server-touching tool appears without an `AMENDMENTS.md` entry. **There is no `fs_sync_push` tool and there will never be one.**

**WP-62 scope.** Triggers `@ # $ ! ~` are all available. `fs-model` on `@` (requirements, threats), `fs-intel` on `#` (CVEs, components — the two colliding providers were consolidated), bench on `~`. `search()` is server-side, **2s time-boxed**, failure-isolated. **`resolve()` must never throw — throwing blocks the send.**

**WP-63 scope.** Directory name must exactly equal frontmatter `name`, and plugin skills lose name collisions to project and user skills — so **namespace everything** (`fs-triage`, not `triage`). Root skill plus per-surface. Each teaches: when to use the surface, the stable-key vocabulary, the directive syntax, the review expectation, and the prohibitions (never call a mutating API, never push).

**WP-64 scope.** Verb-first canonical (`pull`, `status`, `plan`, `push`), domain verbs grouped (`triage …`, `firmware …`, `bench …`), surface-first forms as documented aliases. The `commands` metadata array feeds bb's auto-generated `plugin-commands` skill **without executing plugin code**, so v1 human-only verbs (`push`, HBOM `accept|reject`) are non-mutating review-panel handoffs—never executable mutations or prompt/`--yes` bypasses.

---

## L8 — Demo & E2E *(1 agent, ~1 wk)* · SPEC 06 §6

| WP | Title | Effort | Depends on | Status |
|---|---|---|---|---|
| 65 | Golden Loop E2E harness | 2 d | G3 | ✅ |
| 66 | Demo seed data & warm-cache snapshot | 1.5 d | 08, 65 | ✅ |
| 67 | Golden Loop beats 1–5 | 2 d | 61–66, L2/L3 prerequisites | ✅ |
| 68 | Golden Loop beats 6–10 | 2 d | 19–21, 32–40, 50, 52–54, 59–62, 67 | ✅ |
| 69 | Golden Loop beats 11–14 | 2 d | 39, 40, 52–55, 61, 68 | ✅ |
| 70 | Offline mode, demo runbook & failure recovery | 2 d | 64, 69, Golden Loop production deps | ✅ |

**The Golden Loop, for reference.** New firmware version lands → agent materializes the mount → queries findings → applies triage policy → writes YAML → human reviews the diff → plan → push → a finding is real, so the agent traces it to the threat model → drafts an EARS requirement → implements the fix in firmware source → dispatches a bench run → the verdict card goes green → the requirement flips to verified → **one commit spans source, model, and decisions** → attestation.

**The four "oh" moments** — protect these above all else: *one workspace* (beat 1, the firmware tree sitting beside the source) · *the agent proposes, the human approves* (beats 5–7, the git diff of forty decisions) · *evidence, not assertion* (beat 13, the requirement flipping because a run produced a result, not because someone clicked a button) · *one commit spans all three* (beat 14).

**WP-70 scope.** G4's bar is that the whole loop runs **unattended, offline, from a warm cache**. That means every network call has a cached path, every long operation has a deterministic fixture, and there's a documented recovery for each of the six failure points. Plus the runbook a human can rehearse from.

---

## Amendments log

Frozen-interface change requests land in `AMENDMENTS.md`. **Expect 3–6 over the build** — that's the freeze working, not failing. Investigate at ten.

| # | Interface | Requested by | Change | Status |
|---|---|---|---|---|
| — | — | — | — | — |
