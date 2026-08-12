# SPEC 06 — Agentic Surfaces & The Golden Loop

*Product spec. Depends on every other spec in the set — this is the capstone. It is not another panel: it is the layer that makes the other five surfaces work as one agentic workspace, and the end-to-end demo that proves it. It also carries the **reconciliation log** (§2.6): the naming collisions and inconsistencies found across SPECs 00–05, with the fixes, so the registry below is canonical. Owner: Matt Wyckhouse. Status: ready for implementation. Phase 6 of the SPEC 00 build sequence.*

**Spec set:** 00 Foundation · 01 Sync Engine · 02 Findings & VEX Triage · 03 Product Security · 04 Bill of Materials · 05 Firmware Mount, Bench & Documents · **06 Agentic Surfaces (this)**

---

## 1. The thesis

Panels are for humans. The agentic surface is how the same capability reaches the agent. These are not two features — they are two renderings of one capability, and the whole spec set is built so that neither can drift from the other.

**The design law:**

> **Every panel is redundant if the agent can't do the same job, and every agent action is untrustworthy if the human can't see it as a diff.**

Both halves bind. The first half says: if a human can triage a finding with `n` → justification → `⌘Enter` (SPEC 02 Flow A), the agent must be able to do the identical act through `fs_triage_set` — same YAML block, same validation, same stable key, same plan gate. A capability that exists only behind a mouse is a capability the product doesn't really have, because the agent does the bulk work (SPEC 00 §2 makes the agent a first-class user). The second half says: every write the agent performs must land as reviewable file state — a git diff a human reads before it reaches the system of record. An agent that mutates a server directly is an agent whose work cannot be audited, staged, partially accepted, or reverted; it is also an agent you cannot demo to a regulator.

**Consequences, stated once so the other specs don't have to argue them:**

1. **One write path.** Human panel edits, agent tool calls, and vendor imports all converge on the same YAML files through the same CAS write API (SPEC 02 §4.2, SPEC 04 §4.4). There is no "agent channel." If a feature needs one, the feature is wrong (SPEC 00 §1).
2. **The iron rule** (SPEC 00 §8): *agents write intent to files; humans approve; the sync engine pushes.* No agent tool calls a model-mutating Platform/AS endpoint. Transport never weakens the rule. The narrow, deliberate exceptions are ACTION-ONLY invocations — enumerated and justified in §5.3, nowhere else.
3. **Domain components self-fetch by id** (SPEC 00 §7). That single convention is what makes this layer nearly free: `<FindingCard id/>` renders in the Findings panel, in the review panel's expanded rows, and inside an agent message via `::fs-finding{id}` — one implementation, three surfaces, zero drift.
4. **Tools return ids; directives render them.** The agent reasons over summaries and shows the user live cards. Prose describes; the directive *is* the artifact (§4.6).
5. **Symmetric visibility.** The human sees the agent's work live (file watcher → `overlay_index` → gutter dots, SPEC 02 §6.7) and the agent sees the human's work fresh (mentions resolve at send time, cache reads at call time). Neither party ever works from a stale picture of the other.
6. **The demo is the spec.** The Golden Loop (§6) is not marketing garnish — it is the acceptance test for the law. If any beat requires narration to explain why it's trustworthy, the layer has failed.

---

## 2. The complete registry

Consolidated from SPECs 01–05, deduplicated and reconciled. ⚑n marks reference the reconciliation log (§2.6). **This registry is canonical**; where it differs from an earlier spec, the fix in §2.6 governs and the earlier spec should be redlined.

### 2.1 Agent tools

Sixteen tools. Registered via `bb.agents.registerTool`, bridged into agent sessions by bb's in-process MCP bridge (Build Guide §2). Classes: **R** = read (cache/YAML only) · **W** = write (local YAML only, via CAS) · **A** = action (invokes the platform; the flagged exceptions).

| Tool | Spec | Class | Server? | Args (summary) | Returns (summary) |
|---|---|---|---|---|---|
| `fs_sync_status` | 01 §8 | R | no | `{surface?}` | local / upstream / conflict / orphan lists (keys + counts) |
| `fs_sync_plan` | 01 §8 | R | **read-only refresh** ⚑9 | `{surface?}` | ordered changeset: creates/updates/deletes/conflicts/orphans + validation errors + blast-radius note; `plan_id` for `::fs-plan` |
| `fs_findings_query` | 02 §6.2 | R | no | filter predicate (version, component, cve, severity, reachability, kev, epss_gte, triage, type) + `limit/cursor` | paged `{items, total, cursor}` — rows carry stable keys + scores + factors |
| `fs_triage_set` | 02 §6.2 | W | no | `{stableKey, status, justification?, response?, reason, pin?, evidence}` | `{path, op: create\|update\|noop, diff_summary}`; validates vocab, CDX rules, pin forcing |
| `fs_triage_apply_policy` | 02 §6.2 | W | no | `{version, filter?, dryRun?}` | `{written, held[{key, rule, why}], skipped_existing, errors}` + `run_id` for `::fs-triage-summary` |
| `fs_tara_query` | 03 §6.2 | R | no | `{kind: threat\|component\|zone\|dataflow\|asset\|requirement\|verification\|attack_path\|clause\|trace, filter?, limit}` | paged slugs + summary fields, directive-ready |
| `fs_requirement_write` | 03 §6.2 | W | no | `{req_id, yaml}` (full desired file) | `{path, diff_summary}` or structured validation errors (schema, EARS, slug resolution) — never a partial write |
| `fs_ears_convert` | 03 §6.2 | R | no ⚑10 | `{action: "bundle", req_ids?}` \| `{action: "validate", paths}` | bundle: source material (AS req + checks + results, cache-served); validate: gates 1+2 results |
| `fs_verification_run` | 03 §6.2 | **A** | **yes — flagged** | `{requirement, tier?, check?}` | job summary; progress via realtime; results land server-side as evidence |
| `fs_sbom_query` | 04 §5.2 | R | no | filter (name, purl, license, license_group, min_severity, kev, reachability, linked) + paging | paged components with vuln rollups + file locations |
| `fs_hbom_extract` | 04 §5.2 | W | no | `{docId, cells[≤500]: {part, field, value, source_ref, confidence}, createMissingParts?}` | `{merged, queued, conflicts, candidates_added, rejected[{cell, why}]}` |
| `fs_hbom_review` | 04 §5.2 | R | no ⚑7 | `{state: review\|conflict\|all, limit}` | queue entries with values, candidates, provenance, source refs (acceptance is human-only) |
| `fs_firmware_materialize` | 05 X14.1 | **A** | **yes — byte fetch, flagged** | `{pv_id, scan_id?, mode: manifest\|hydrate\|hydrate_all, paths?}` | manifest/hydration summary; `manifest` mode is always safe; byte modes are admin-gated |
| `fs_bench_run` | 05 X14.1 | **A** | **yes — flagged** | `{pv_id, tier, requirement?, target?}` | `{run_id, thread_id, status}`; asserts full materialization first (A3 ordering constraint) |
| `fs_bench_status` | 05 X14.1 | R | no | `{pv_id?, run_id?, want: runs\|results\|artifacts\|verdict, limit}` | run/result/verdict summaries with ids for `::fs-bench` / `::fs-verdict` |
| `fs_doc_search` | 05 X14.1 | R | no ⚑8 | `{project_id, query, doc_type?, limit}` | matches with page + region `source_ref`s |

**What's deliberately absent:** `fs_sync_push` (§5.4), any attestation-write tool, any HBOM-accept tool, any review-transition tool, and a general `fs_hbom_query` — authored YAML surfaces don't need read tools, because the agent's native `Read`/`Grep` reach the worktree directly (§4.2). Query tools exist only where the answer requires the SQLite cache or a YAML⋈cache join.

### 2.2 Directives

Twelve. All registered via `app.slots.messageDirective`; all fetch by id via RPC (attributes are attacker-controlled — never render attribute content, never accept payloads); all ErrorBoundary'd with literal-text fallback; all must render sensibly from a cold cache ("pull to load"). Primary attribute is always `id` ⚑5.

| Directive | Spec | Renders (domain component) | Notes |
|---|---|---|---|
| `::fs-plan{id}` | 01 §8 | compact plan/review card | shows what the agent is about to propose; click-through → sync panel ⚑5 (was `run=`) |
| `::fs-finding{id}` | 02 §6.4 | `<FindingCard>` — decision block | id = stable key (base64url in routes); also accepts `cve=`+`purl=` |
| `::fs-triage-summary{id}` | 02 §6.4 | bulk-run card: written/held/conflicts + holdback list | stays live via `triage_runs` row ⚑5 (was `run=`) |
| `::fs-threat{id}` | 03 §6.3 | `<ThreatCard>` — name, category, severity, targets, links | ⚑4 — renamed from `::fs-tara`; click-through → `tara/threats/<slug>` |
| `::fs-canvas{focus, highlight, height?}` | 03 §6.6 | **the live TARA canvas in-message** | read-only in-message (SPEC 03 OQ1); "Open in panel ↗"; lazy chunk shared with the tab |
| `::fs-req{id}` | 03 §6.3 | requirement card (EARS + tier strip + trace line) | identical component to the Requirements tab card |
| `::fs-matrix{filter}` | 03 §6.3 | compact requirement × tier matrix slice (≤15 rows) | filter grammar = the tab's params, validated |
| `::fs-component{purl \| part}` | 04 §5.4 | `<ComponentCard>` — SBOM mode or HBOM-part mode | one directive, two id forms; provenance-styled cells in part mode |
| `::fs-hbom-summary` | 04 §5.4 | trust dashboard: parts, % human-verified, queue depth | leads with trust metrics, not completeness |
| `::fs-bench{id}` | 05 X14.3 | bench-run card: status, tier, duration, artifacts, thread link | click-through → `bench/<run_id>` |
| `::fs-verdict{id}` | 05 X14.3 | **the safe-to-OTA verdict card** (B8.3) | keyed by firmware digest or run id; works offline from warm cache — the demo centerpiece |
| `::fs-doc{id}` | 05 X14.3 | document card + extraction overlay preview | click-through → Documents with the doc open |

### 2.3 Mention providers

Three triggers, partitioned by meaning. `search` runs server-side against cache/YAML indexes (<2s box, cache-only — never a remote service); `resolve(itemId)` runs **at send time** and returns fresh context, so the user's sentence and the system's current data are the same object.

| Trigger | Provider | Resolves | Fresh context at send time |
|---|---|---|---|
| `@` | `fs-model` (03 §6.5) | authored model entities: `@REQ-104`, `@THREAT-22`, `@COMP-httpd`, `@FLOW-wan-mgmt`, `@CHK-sig-verify` | current YAML content + cached live status (tier strip, latest results, trace refs) |
| `@` | `fs-docs` (05 X14.4) | documents: `@datasheet:bcm6755` | doc metadata + extracted-field summary + page refs |
| `#` | `fs-intel` (02 §6.5 + 04 §5.4, **consolidated** ⚑3) | intelligence identifiers: `#CVE-2023-42364`, `#busybox@1.36.1`, `#BCM6755` | finding rows + scores + reachability + server VEX + local overlay state; or component row + vuln rollup; or HBOM part cells + provenance summary |
| `~` | `fs-runs` (05 X14.4) | temporal evidence: `~bench-run-88`, `~verdict-7a10be44` | run status + verdict summary + requirement coverage |

The partition is the mnemonic: **`@` = things we authored** (the model, the documents we ingested) · **`#` = things the world asserts** (CVEs, components, parts) · **`~` = things that happened** (runs, verdicts).

### 2.4 CLI — the full `bb finite-state` tree

One top-level command (SPEC 00 §9), discoverable by agents through bb's auto-generated plugin-commands skill; every list `--json`-capable and paged (1 MiB cap). **The four sync verbs are canonical at the top level, verb-first** ⚑6; surface groups own their domain verbs.

```
bb finite-state
  connections status                       # verify Platform, AS, optional Forge compute
  connections configure                    # show/open secret-setting requirements
  project   list | use <id>

  # ── the four sync verbs (canonical form; verb-first, per SPEC 00 §9) ──
  pull    [triage|product-security|bom|all]
  status  [surface]                         # local · upstream · conflicts · orphans
  plan    [surface]                         # what would be pushed (validated)
  push    [surface]                         # validate + hand off to review panel; never applies

  # ── surface groups ──
  triage                                    # SPEC 02 §6.6
    list [--filter …] | set <stableKey> --status … | apply-policy [--dry-run]
    import-vex <file> --vendor <name> [--overwrite] | orphans [--prune]
    pull | status | plan | push             # aliases of the top-level verbs, scoped ⚑6

  tara    show <slug>                       # SPEC 03 §6.5
  req     list [--status … --clause …] | show <REQ-id>
  ears    convert [--reqs …] [--drifted]
  verify  matrix [--unproven] | run <REQ-id> [--tier …] | results <REQ-id>

  bom                                       # SPEC 04 §5.5
    pull [--version <v>]
    sbom  list [--filter …] | export --format cyclonedx|spdx [--include-vex] [-o file]
    hbom  seed | ingest <file> [--kind …] [--extract] | status
          review | accept <part> <field> [--candidate n] | reject <part> <field> # accept/reject only hand off to the human review panel
          export --xlsx|--cdx [--verified-only] [-o file]

  firmware                                  # SPEC 05 X14.5
    pull <pv_id> [--scan <id>] [--full] | status <pv_id>
    hydrate <pv_id> <path>… | diff <pv_a> <pv_b>

  bench                                     # SPEC 05 X14.5  ⚑11 (arg normalized to pv_id)
    run <pv_id> [--tier tier1] [--requirement REQ-…] [--target <path>]
    list [--pv <id>] [--tier …] [--failing] | show <run_id> | verdict <pv_id>

  doc     list [--type …] | show <doc_id> | search <query>
```

Because this tree is agent-discoverable, `hbom accept|reject` are deliberately non-mutating: they validate the selection, print/open the review-panel route, and never invoke HBOM resolution. They are navigation handoffs, not an agent path to `accepted` or `provenance: human`.

### 2.5 Naming conventions (for every future addition)

**Tools — `fs_<surface>_<verb>`, verb last, present-tense imperative.**
- Surface noun is the singular registry/surface name (`triage`, `tara`, `sbom`, `hbom`, `firmware`, `bench`, `sync`, `doc`); `findings` is the one grandfathered plural (it names the surface, not the entity).
- Verb vocabulary is closed until amended: **`_query`** = structured filtered read over cache/model, always paged; **`_search`** = free-text ranked retrieval; **`_status`** = state summary (sync state, run state); **`_set` / `_write` / `_extract`** = local-YAML writes through validation/merge; **`_run` / `_materialize` / `_convert` / `_apply_policy`** = invocations. **No `_get` and no `_list`** — a single-entity read is `_query` with an id filter; a list is `_query`.
- Read tools are unrestricted; write tools touch YAML only; action tools are the enumerated §5.3 exceptions. A new server-touching tool requires amending §5.3, not just registering it.

**Directives — `::fs-<entity>` kebab-case**, named for the *entity rendered*, not the tab it lives in (hence ⚑4). Primary attribute is always `id`; auxiliary scoping attributes (`focus`, `highlight`, `filter`, `height`) are allowed and validated. A directive is never a second data path — it mounts the same self-fetching domain component the panel uses.

**Mentions** — new id kinds join an existing trigger by the §2.3 partition (`@` authored / `#` external identifiers / `~` runs). Never invent a fourth trigger without amending this table.

**CLI** — sync verbs stay verb-first at top level; everything else is `<surface> <verb>`. Surface groups may alias the four sync verbs scoped to themselves, documented as aliases. Flags mirror tool args (`--dry-run` ↔ `dryRun`).

**Skills** — `skills/<surface>/SKILL.md`, no `fs-` prefix (the plugin id already namespaces them) ⚑2, plus the root skill `skills/finite-state/SKILL.md`.

**Stable keys and slugs** — slugs are `PREFIX-suffix` (`REQ-`, `THREAT-`, `COMP-`, `ZONE-`, `FLOW-`, `CHK-`, `MIT-`, `HBOM-`); triage stable keys are `project|purl|CVE` (base64url-encoded in routes/directive ids, human-readable in YAML/CLI — SPEC 02 OQ3, one shared encoder).

### 2.6 The reconciliation log — inconsistencies found across SPECs 00–05, with fixes

This audit is part of the spec's value. Each item: what conflicts, and the ruling.

1. **The iron rule vs. the action tools.** The rule is transport-neutral: no agent tool calls a model-mutating remote endpoint. SPEC 03 §6.2 ships `fs_verification_run`; SPEC 05 X14 ships `fs_bench_run` and `fs_firmware_materialize` as ACTION-ONLY operations. They may invoke only their frozen direct-service or optional-compute methods and remain the exhaustive exceptions in §5.3. Changing Platform-via-Forge to direct Platform does not add an agent capability.
2. **Skill directory naming.** SPECs 01–04 use `skills/sync/`, `skills/triage/`, `skills/product-security/`, `skills/bom/`; SPEC 05 uses `skills/fs-firmware/`, `skills/fs-bench/`, `skills/fs-docs/`. **Fix:** drop SPEC 05's `fs-` prefix — `skills/firmware/`, `skills/bench/`, `skills/docs/`. The plugin id already namespaces. **Applied** to SPEC 05 X14.2.
3. **`#` trigger collision.** SPEC 02 §6.5 registers `fs-cve` on `#` matching *CVE ids and component names*; SPEC 04 §5.4 registers `fs-bom` on `#` matching *component names, purls, MPNs*. Component names match in both — `#busybox` is ambiguous, and bb's behavior with two providers on one trigger returning overlapping corpora is unverified (OQ2). **Fix:** consolidate into one `fs-intel` provider on `#` that routes internally by pattern (`CVE-`/`GHSA-` → finding context; purl/name → component; MPN/ref-des → part) with one ranked search. One registration, one dedup point. **Applied** to SPEC 02 §6.5 (the single `fs-intel` registration) and SPEC 04 §5.4; SPEC 03 §6.5's cross-reference updated.
4. **`::fs-tara{id="THREAT-22"}` names the tab, renders a threat.** Every other directive is named for its entity (`::fs-req`, `::fs-finding`, `::fs-component`). **Fix:** rename to `::fs-threat` (zero migration cost pre-build); `::fs-canvas` keeps its name because the canvas *is* the entity it renders. Redline SPEC 03 §6.3/§6.4 and the SPEC 02 skill outline reference. **Applied** to SPEC 03 §6.3 and §6.4 (no `::fs-tara` reference existed in SPEC 02's skill outline).
5. **Directive attribute drift.** SPEC 01 uses `::fs-plan{run=…}`, SPEC 02 `::fs-triage-summary{version= run=}`, everything else `id=`. **Fix:** primary attribute is always `id` (§2.5); `version` demotes to optional scoping. **Applied** to SPEC 01 §8 and SPEC 02 Flow B.4 / §6.3 / §6.4.
6. **Two CLI verb orderings coexist.** SPEC 00 §9 and SPEC 03 §6.5 are verb-first (`plan product-security`); SPEC 02 §6.6 is surface-first (`triage plan`). **Fix:** verb-first is canonical (git/Terraform-shaped, per SPEC 00's own rationale); surface-scoped forms are retained as documented aliases (§2.4). No behavior difference. **Applied** to SPEC 02 §6.6.
7. **`fs_hbom_review` is a read tool named like an action.** Under §2.5 it should be a `_query`. **Ruling:** keep the name — the review queue is a domain noun and the description disambiguates — but record it as the one grandfathered deviation so nobody cites it as precedent. **Applied** — ruling recorded here; no spec redline required.
8. **`fs_doc_search` vs `_query`.** Not a violation once §2.5 defines `_search` = free-text ranked retrieval (which this genuinely is, unlike the structured `_query` tools). Codified rather than renamed. **Applied** — codified in §2.5; no spec redline required.
9. **`fs_sync_plan` touches the server.** SPEC 01 §8 calls it "read-only, safe," but conflict detection at plan time requires fresh-pulled server tuples (SPEC 02 Flow C.1) — so plan performs a server *read* refresh. **Fix:** keep the tool, sharpen the description: read-only with a network refresh; degrade to last-pulled base with a staleness warning when offline (required for the offline demo path). **Applied** to SPEC 01 §8 (tool description sharpened).
10. **`fs_ears_convert {action:"bundle"}` data source unstated.** **Ruling:** cache-served from the last direct AS pull; a stale bundle is caught by gate 2's id resolution anyway. **Applied** to SPEC 03 §6.2.
11. **`bench run <target>` vs `bench run <pv_id>`.** SPEC 00 §9 sketches `bench run <target>`; SPEC 05 X14.5 takes `<pv_id>` with `--target` as an option. **Fix:** SPEC 05 wins (`pv_id` positional, `--target` optional); redline SPEC 00 §9. **Applied** to SPEC 00 §9.
12. **Two document stores, two ledgers, one stale path.** SPEC 04 §3.4 stores HBOM evidence docs git-tracked at `product-security/hbom/docs/<sha>-<name>` with the `hbom_docs` ledger; SPEC 05 C12 stores uploads at `.fs-docs/<project>/<sha>-<name>` with the `document` table — and SPEC 05 C13 still references `.fs-hbom/<project>/hbom.yaml`, a path SPEC 04 §4.3 explicitly superseded. Worse, the dot-root git semantics are inconsistent across the set: `.fs/` is tracked, `.fs-sync/` and `.fs-firmware/` are ignored, `.fs-docs/` is unspecified. **Fix:** (a) one document store at `product-security/documents/<sha256>-<name>` (git-tracked — anything a `source_ref` cites must survive a clone), one `document` ledger with a `doc_kind` column; `hbom_docs` becomes a filtered view over it; (b) redline SPEC 05 C13's `.fs-hbom/` reference to `product-security/hbom/hbom.yaml`; (c) codify the dot-root rule in SPEC 00: *`.fs/` = tracked overlays/links; `.fs-sync/`, `.fs-firmware/` = ignored machinery; evidence never lives under an ignored root.* **Applied**: (a) SPEC 05 C12/C12.1 and SPEC 04 §3.4/§4.1/§4.3/§4.4/§5.7 (single store at `product-security/documents/`, single `document` ledger with `doc_kind`, `hbom_docs` as a filtered view); (b) SPEC 05 C13 redlined to `product-security/hbom/hbom.yaml`; (c) dot-root rule added to SPEC 00 §5.
13. **Confidence type mismatch.** SPEC 04 §4.3 makes confidence numeric 0–1 (with derived display bands); SPEC 05 C12.1's `document_extraction.confidence` is `TEXT — high|medium|low`. Same concept, adjacent tables, incompatible types. **Fix:** numeric 0–1 everywhere (SPEC 04 wins — thresholds need arithmetic); bands are display-only. **Applied** to SPEC 05 C12.1 (`document_extraction.confidence` → `REAL` 0–1).
14. **Bench tiers vs matrix tiers have an unmapped middle.** `bench_run.tier` is `tier0…tier4` (five), `bench_result.tier` and the SPEC 03 matrix are `static|emulation|hil|manual` (four). Tier 0→static, 1→emulation, 3→hil are obvious; **tier 2 (Renode deterministic) and tier 4 (external lab) have no declared column.** **Fix:** declare the mapping at sync time — tier2 → `emulation` (it is emulation, deterministic sub-kind recorded in `bench_result.evidence_summary`), tier4 → `manual` (a countersigned lab report is attestation-class evidence). Add the mapping table to SPEC 05 B10. **Applied** to SPEC 05 B7/B10 (mapping table added) and SPEC 03 §4.1 (mapping note added).
15. **Nav-panel count drift (informational).** The Build Guide §2 recommends four nav panels; the spec set actually defines five plus the sync review route (Findings · Product Security · Bill of Materials · Documents · Bench · `/sync`). The specs supersede the guide; no action beyond noting the guide is a snapshot.

---

## 3. Skills architecture

### 3.1 The tree

```
skills/
├── finite-state/SKILL.md      # ROOT — the invariants; always relevant
├── sync/SKILL.md              # plan/push mental model, conflict etiquette      (SPEC 01)
├── triage/SKILL.md            # the flagship — full text in §3.4               (SPEC 02)
├── product-security/SKILL.md  # TARA, EARS authoring, verification honesty     (SPEC 03)
├── bom/SKILL.md               # SBOM posture, HBOM extraction craft            (SPEC 04)
├── firmware/SKILL.md          # mount, hydration, grepping firmware            (SPEC 05)
├── bench/SKILL.md             # runs, tiers, verdict etiquette                 (SPEC 05)
└── docs/SKILL.md              # extraction with page-level source_refs         (SPEC 05)
```

### 3.2 Root skill vs. per-surface skills

**The root skill holds what must never be repeated eight times** — the invariants that apply to every surface. Its whole content:

- What this workspace is: source + firmware + product-security model in one worktree; AS is the system of record, reached only via plan/push.
- **The iron rule**, verbatim, with the three ACTION exceptions named and the requirement that every invocation is logged. Any host/provider approval interaction is policy-dependent and is not the plugin's safety boundary.
- The stable-key overview: slugs by prefix, the triage key, "reference by slug, never UUID, never reuse a slug."
- The universal etiquette: check your work with `fs_sync_plan`; show entities with directives, cite them with mentions; never claim anything is "applied," "pushed," or "verified" — it's proposed until a human pushes, and verified only when results say so.
- A one-line map of the surface skills so the model knows what else it can load.

**Per-surface skills hold domain vocabulary and craft**: the VEX enums, EARS patterns, extraction rules, tier taxonomy. They reference the root rather than restating it. Rule of thumb: if a sentence would appear identically in three surface skills, it belongs in the root.

### 3.3 Skill-writing rules (enforced in review)

1. **The description line is a trigger, not a summary.** It must name the user phrases that should activate the skill ("findings, CVEs, VEX, false positive, reachability, triage") — bb injects plugin skills as a tier and the model selects by description.
2. **Teach when to invoke, then how, then what to emit.** Every skill ends with the directive/mention cheat-line for its surface.
3. **Stable-key vocabulary up front.** The first thing an agent gets wrong is identity. Keys before verbs.
4. **The review expectation is explicit.** Every skill that leads to writes ends with the same closing move: summarize, point at the diff and the plan, stop.
5. **The NEVER list is concrete, not pious.** Never call mutating APIs; never push; never write server-owned/derived fields (SPEC 03 §5.5); never invent ids or fabricate `source_ref`s; never resolve a human review queue; never assert a verdict in prose.
6. **Skills are versioned with the code they describe.** A tool signature change and its skill change land in one commit.

### 3.4 The flagship, in full — `skills/triage/SKILL.md`

```markdown
---
name: triage
description: >
  Vulnerability triage on Finite State findings. Use for anything touching
  findings, CVEs, GHSAs, VEX, triage, "false positive," suppression,
  justification, reachability, or vulnerability review on a firmware version.
---

# Triage — Findings & VEX

You triage vulnerabilities by writing VEX decisions to local YAML. You never
touch the server. A human reviews your diff and pushes. (Root skill: the iron
rule applies to everything below.)

## The workflow

1. **Query first.** `fs_findings_query` against the local cache — filter by
   component, severity, reachability, kev, epss_gte, triage state. Findings
   are paged; refine filters rather than raising limits.
2. **Policy for the routine.** `fs_triage_apply_policy` evaluates
   `.fs/triage/policy.yaml` and writes decisions for rule matches. Run with
   `dryRun: true` first when the scope is large or unfamiliar.
3. **Judgment for the held.** The policy returns `held` items (KEV findings
   always; incomplete data). Reason about each individually and use
   `fs_triage_set` with real evidence — or escalate to the human. Never relax
   a holdback by re-running policy with a looser filter.
4. **Check your work.** `fs_sync_plan` shows exactly what would reach
   Assurance Studio. If it shows conflicts, report them; do not resolve them.
5. **Report and stop.** Summarize counts, holds, and notable calls; emit
   `::fs-triage-summary{id="<run_id>"}`; tell the human where the diff is.
   Do not push. You cannot push. There is no push tool.

## Identity — the stable key

Decisions key on **(project, component-identity, CVE)** — never on finding
uuids (they change every version). Build the key from an `fs_findings_query`
row: prefer `purl`; fall back to (name, group, version). One key covers all
duplicate rows for that (component, CVE).

## Pin semantics

- `pin: exact_version` — evidence is build-specific. **Forced** for
  `CODE_NOT_REACHABLE` (reachability is per-build); goes stale on version
  bumps rather than silently carrying forward.
- `pin: any_version` — follows the component across versions. Use for
  `CODE_NOT_PRESENT`, protocol-level FALSE_POSITIVEs, vendor assertions.
- When unsure, take the default (`exact_version`). Stale is recoverable;
  a wrongly-carried decision is not.

## Vocabulary (validated at the tool boundary — invalid input returns errors)

- **Status (6):** NOT_AFFECTED · EXPLOITABLE · IN_TRIAGE · FALSE_POSITIVE ·
  RESOLVED · RESOLVED_WITH_PEDIGREE
- **NOT_AFFECTED requires a justification (9 CDX values).** Pick the one the
  evidence supports; do not default to CODE_NOT_REACHABLE without
  reachability evidence in the row's `factors`.
- **Reasons cite evidence.** Quote the factor ("no caller of getvar_s"),
  the config fact ("CONFIG_AWK unset"), or the file path. A reason without
  evidence will fail human review; write it as if the reviewer disagrees.

## What appears where

- Discussing one finding → `::fs-finding{id="<stableKey>"}`
- After a bulk run → `::fs-triage-summary{id="<run_id>"}`
- Mentioning a CVE in prose → `#CVE-2023-42364` (resolves to live context)

## NEVER

- Never call a mutating API or claim decisions are "applied" — they are
  proposed until a human pushes.
- Never set `overwrite_existing` in policy; existing decisions (local or
  server) are skipped by design.
- Never edit another author's decision block to win an argument — flag the
  disagreement to the human with both positions.
- Never invent a stable key. If `fs_triage_set` returns `orphaned_key`,
  re-query; the component may have left the image.
```

### 3.5 The other skills, outlined

Each already has a content contract in its home spec; this list is the index and the deltas:

- **`sync`** (SPEC 01 §8): edit YAML with native tools; plan is how you check work; conflicts are reported, never resolved by you; what `status` buckets mean (incl. orphans/stale); `::fs-plan{id}` to show a proposal.
- **`product-security`** (SPEC 03 §6.4): file map + edit rules; the §5.5 excluded-fields list stated as concrete field names; EARS decision table; verification honesty ("to change status, run `fs_verification_run` and wait"); `.fs/links/*` population craft; directives incl. the renamed `::fs-threat` ⚑4 and `::fs-canvas` usage.
- **`bom`** (SPEC 04 §5.3): two postures (SBOM read / HBOM propose); every cell cites a `source_ref` into a registered doc; honest confidence; disagreements are recorded, never adjudicated; image-only PDFs → stop and say OCR is needed.
- **`firmware`** (SPEC 05 X14.2): manifest is always browsable; hydrate before Read; prefer Grep over dumping binaries; exact paths, never guessed.
- **`bench`** (SPEC 05 X14.2): runs are invoked, never YAML; full materialization precedes Tier-1; **never assert "safe to OTA" in prose — emit `::fs-verdict` and let the signed card speak**; gaps are gaps, not passes.
- **`docs`** (SPEC 05 X14.2): extract only what you can cite to a page/region; extractions target HBOM cells or requirement rationale; `fs_doc_search` to ground a requirement in a clause.

### 3.6 bb's injection behavior, and the free skill

Two host behaviors this architecture leans on (Build Guide §1–2):

- **Auto-injection.** Everything under `skills/` (declared in the manifest's `bb.skills`) is injected into agent threads as the plugin-skills tier. We don't wire anything; we write good descriptions (§3.3 rule 1) and the model loads bodies when triggered. The root skill's description is deliberately broad ("Finite State product security workspace — findings, threat model, requirements, SBOM/HBOM, firmware, verification") so the invariants are in reach whenever any surface is.
- **The auto-generated plugin-commands skill.** bb generates a skill documenting `bb finite-state …` from our `bb.cli.register` metadata. This is how the agent discovers CLI verbs we never mention in our own skills — which is why §2.4's summaries and flag names are written to be read by a model, and why CLI flags mirror tool args (§2.5). We do not duplicate the CLI reference inside our skills; we let bb's generated one carry it.

---

## 4. Tool-design principles

These are the rules that keep sixteen tools coherent. They are enforceable in review because they are concrete.

**4.1 Read tools return summaries with ids, never dumps.** Context is the scarcest resource in an agent session. `fs_findings_query` returns rows of ~15 fields with a stable key — not the full detail blob; `fs_bench_status` returns run summaries — not logs. The id is the contract: anything the agent needs deeper, it fetches by id (another filtered query, a native Read of the YAML, or — for the human's benefit — a directive). A tool that returns 50 KB of JSON has failed even if it's correct.

**4.2 Authored YAML needs no read tool.** VERSIONED and OVERLAY files are in the worktree, including `server:"none", localOnly:true` entries; the agent's native `Read`/`Grep`/`Glob` reach them with zero wiring (SPEC 00 fact 5). There are exactly four registry classes: VERSIONED, CACHED, OVERLAY, and ACTION-ONLY; local-only is a capability, not a fifth class. Query tools exist only where the answer lives in SQLite (CACHED data) or requires a YAML⋈cache join (`fs_tara_query`'s verification/trace kinds). This is why there is no `fs_hbom_query`: `hbom.yaml` is a file; reading it is what Read is for. (Writing it is *not* what Edit is for — writes go through the merge engine, `fs_hbom_extract`, because merge rules are semantics, not syntax.)

**4.3 Pagination and the token budget.** Every list: `limit` default 50, hard max 200, cursor-paged `{items, total, cursor}`. Soft response budget ~4 KB per call — enforced by summary shape, verified by telemetry in rehearsal (OQ6). The skill teaches refinement over enumeration: "filter tighter rather than paging longer." Totals are always returned so the agent can report scale without fetching it.

**4.4 Write tools return the path and a diff summary.** `fs_triage_set` → `{path, op, diff_summary}`; `fs_requirement_write` → `{path, diff_summary}`; `fs_hbom_extract` → merge outcome counts plus the file touched. Two reasons: the agent can tell the human *exactly where to look* ("39 decisions in `.fs/triage/acme-router/busybox.yaml` — review the diff"), and the agent can verify its own action landed without re-reading the file. A write tool that returns only `ok: true` teaches the agent nothing and the human less.

**4.5 Error shapes teach recovery.** Every tool error is `{code, message, hint, retryable}` — and the `hint` is written for a model, naming the next tool call:

```ts
// fs_triage_set, stable key no longer resolves
{ ok: false, error: {
    code: "orphaned_key",
    message: "busybox@1.36.1 not present in v2.2 at any resolution tier.",
    hint: "Re-run fs_findings_query {component:'busybox', version:'v2.2'} — the component may have been removed or renamed. Do not guess a new key.",
    retryable: false } }

// fs_requirement_write, gate 1 failure
{ ok: false, error: {
    code: "ears_mismatch",
    message: "pattern=event_driven but parts.trigger is null; text does not round-trip from parts.",
    hint: "Populate parts.trigger, or change pattern. See the six-pattern table in the product-security skill.",
    retryable: true } }
```

Validation failures never partially write (§2.1 `fs_requirement_write`); partial-success operations (`fs_hbom_extract`, bulk apply) return item-wise `rejected[{cell, why}]` in the same shape.

**4.6 Tools and directives pair.** The canonical loop: **query returns ids → the agent reasons over summaries → the agent renders the entity by id.** `fs_findings_query` → `::fs-finding{id}`; `fs_triage_apply_policy` → `::fs-triage-summary{id}`; `fs_tara_query` → `::fs-threat{id}` / `::fs-canvas{focus}`; `fs_bench_status {want:"verdict"}` → `::fs-verdict{id}`. Every read tool's description names its paired directive(s) so the model learns the pairing from the schema, not just the skill. The directive fetches by id through the same RPC the panel uses — it is a *view*, never a second data path (SPEC 03 §6.6).

**4.7 Idempotency, per class.** Reads: trivially. Writes: convergent — `fs_triage_set` with an identical tuple returns `op: "noop"`; policy application skips existing decisions by design; `fs_hbom_extract` re-runs from the same doc replace their own prior claims (SPEC 04 §6.4.7); all file writes are CAS (SPEC 02 §4.2), so concurrent writers error cleanly instead of clobbering. Actions: **not idempotent and marked so** — `fs_bench_run` returns a `run_id` immediately, and the skill instructs: on timeout or ambiguity, check `fs_bench_status`, never re-dispatch. `fs_firmware_materialize` is convergent (re-running hydration completes it).

**4.8 One registry, asserted in CI.** The §2 tables are code, not prose:

```ts
// lib/agentic/registry.ts — the single source the tests assert against
export const AGENT_SURFACE = {
  tools: {
    fs_sync_status:          { spec: "01", class: "read",   server: "none" },
    fs_sync_plan:            { spec: "01", class: "read",   server: "read-refresh" },
    fs_findings_query:       { spec: "02", class: "read",   server: "none", directive: "fs-finding" },
    fs_triage_set:           { spec: "02", class: "write",  server: "none" },
    fs_triage_apply_policy:  { spec: "02", class: "write",  server: "none", directive: "fs-triage-summary" },
    fs_tara_query:           { spec: "03", class: "read",   server: "none", directive: "fs-threat" },
    fs_requirement_write:    { spec: "03", class: "write",  server: "none", directive: "fs-req" },
    fs_ears_convert:         { spec: "03", class: "read",   server: "none" },
    fs_verification_run:     { spec: "03", class: "action", server: "invoke", gated: true },
    fs_sbom_query:           { spec: "04", class: "read",   server: "none", directive: "fs-component" },
    fs_hbom_extract:         { spec: "04", class: "write",  server: "none", directive: "fs-hbom-summary" },
    fs_hbom_review:          { spec: "04", class: "read",   server: "none" },
    fs_firmware_materialize: { spec: "05", class: "action", server: "read-fetch", gated: true },
    fs_bench_run:            { spec: "05", class: "action", server: "invoke", gated: true },
    fs_bench_status:         { spec: "05", class: "read",   server: "none", directive: "fs-verdict" },
    fs_doc_search:           { spec: "05", class: "read",   server: "none", directive: "fs-doc" },
  },
  directives: ["fs-plan","fs-finding","fs-triage-summary","fs-threat","fs-canvas","fs-req",
               "fs-matrix","fs-component","fs-hbom-summary","fs-bench","fs-verdict","fs-doc"],
  mentionTriggers: { "@": ["fs-model","fs-docs"], "#": ["fs-intel"], "~": ["fs-runs"] },
} as const;
// CI: every registered tool appears here with the declared class; every tool with
// class !== "action" is statically verified to import no remote write module;
// every directive id has a messageDirective registration and a cold-cache test.
```

---

## 5. The safety model

### 5.1 The human-gate boundary, enumerated

**The agent has these standing capabilities:**

1. Read anything: SQLite caches, working YAML, firmware manifest/hydrated bytes, documents, bench history, sync status.
2. Write local YAML through validating tools or native Edit: VEX decisions (`.fs/triage/`), model entities (`product-security/`), overlay decisions (`.fs/`), link maps, HBOM cells *as proposals through the merge engine*.
3. Run `fs_sync_plan` and report what would happen.
4. Render directives, resolve mentions, emit summaries.
5. Materialize the firmware **manifest** (metadata only — always safe).
6. Commit to git if the session's git policy allows it — a commit is still local intent, gated by the same push boundary.

**Requires a human, always:**

1. **Push** — anything reaching Platform or Assurance Studio goes through the review panel. The CLI `push` spelling is only a non-mutating handoff to that panel (§5.4).
2. **Conflict resolution** — take-ours/take-theirs/edit are review-panel interactions; the agent reports conflicts, never resolves them (SPEC 01 §6).
3. **Blast-radius confirmations** — deletes (with referrer lists), >20-entity changes, typed confirmation for non-restorable entities (SPEC 03 §8.2). These prompts are interactive-only; no tool can answer them.
4. **HBOM acceptance** — `accepted`, `provenance: human`, and review-queue resolution have no agent path (SPEC 04 §5.2/§6.5).
5. **Attestation recording** — a manual verification attestation is a human act in the panel (SPEC 03 §4.3); there is no attestation tool.

Separately, the three architecturally allowlisted ACTION tools in §5.3 remain callable agent actions and are always logged. A running bb/provider policy may add an approval interaction, but that UI is not guaranteed and is not the safety boundary. No fourth server-touching action is permitted without an amendment.

### 5.2 Blast-radius rules

Inherited from SPECs 01/03 and restated as the layer's contract: the plan is the only mutation gate, and the plan enforces referential integrity, ordering, derived-field guards, vocabulary, and thresholds (SPEC 01 §5). The agent can *cause* a large plan; it cannot *confirm* one. `fs_triage_apply_policy` additionally self-limits: holdbacks are non-overridable by the caller, and `overwrite_existing` is not exposed as a tool argument at all — it lives only in the git-reviewed policy file.

### 5.3 The deliberate exceptions — every server-touching tool, justified

| Tool | What it touches | Why it's allowed | Gate |
|---|---|---|---|
| `fs_verification_run` | Invokes the platform's own check runs | ACTION-ONLY by class (SPEC 01): it is an *invocation of sanctioned analysis*, not an edit — the run is the only legitimate path by which verification status changes, and it produces evidence rather than destroying state (SPEC 03 §6.2's reasoning, adopted here verbatim) | Compile-time allowlist + invocation audit; any host/provider approval is policy-dependent |
| `fs_bench_run` | Dispatches a bench run (QEMU/pen-test/HIL) | Same class and reasoning; results land as signed evidence rows; the model is untouched | Compile-time allowlist + audit; run recorded as a thread (§7.1); any approval UI is policy-dependent |
| `fs_firmware_materialize` (byte modes) | Downloads firmware bytes from the platform | A server *read* (fetch), not a mutation — flagged because it is admin-permission-gated and bandwidth-heavy, not because it changes anything | Compile-time allowlist + byte/action audit; any approval UI is policy-dependent |
| `fs_sync_plan` (⚑9) | Read-only refresh of server tuples for conflict detection | A read; listed for completeness because "touches the server" must be an exhaustive list or it is worthless | none needed; degrades offline |

That is the complete list. §4.8's CI assertion keeps it complete: a tool that imports any Platform, AS, or optional Forge-compute action module without `class: "action"` fails the build.

### 5.4 Why there is no `fs_sync_push`

Four reasons, in descending order of importance:

1. **The gate is the product.** "The agent proposed changes to your security model — here is the exact diff — approve to push" is the demo beat (SPEC 01 §7) and the compliance story. An agent that can push converts every prompt-injection, every hallucinated justification, and every stale-cache mistake into a system-of-record write. The review panel is where trust is manufactured; a push tool would bypass the factory.
2. **Push has interactive semantics.** Conflicts must be resolved, blast radii confirmed, partial failures triaged (SPEC 02 §8.1). A tool call has none of those affordances; pretending it does would mean auto-answering questions that exist precisely because a human should answer them.
3. **Asymmetric cost.** Local YAML is infinitely revisable at zero cost; a push bumps server timestamps, fires audit rows, and (for deletes) can be irreversible (SPEC 03 §8.2 — requirements are non-restorable server-side). The boundary sits exactly where reversibility ends.
4. **It keeps the audit story one sentence long.** *Nothing reaches the system of record without a named human clicking Push.* That sentence survives a regulator.

### 5.5 Auditability — the record of what happened

- **`push_log`** (SPEC 00 §5): every push run, per-entity op and outcome, resumable. The answer to "what did we change upstream, when, and did it land."
- **Provenance stamping**: `[bb:{run-id}]` prefixed into `vex_reason` on push (SPEC 01 §5) — the only attribution channel until fs-api ships `vex_source` (SPEC 02 §7.4.2). Overlay `provenance.by` (`engineer id | bb-agent | vendor:<name>`) records authorship locally regardless.
- **Git history is the record of intent**: who wrote what (agent commits are attributable), who reviewed (the human's commit/merge), and — via `git log --follow` on any entity file — the entity's full life. Restore-from-git is the undo the server doesn't offer (SPEC 03 §8.2).
- **Bench evidence is externally verifiable**: Sigstore keyless signatures, Rekor transparency-log uuids on every attestation (SPEC 05 B10) — auditability that doesn't depend on trusting us.
- **`bb plugin logs finite-state`**: sync runs, tool invocations, and ACTION outcomes.

---

## 6. The Golden Loop — the end-to-end demo script

One continuous scenario, ~12 minutes rehearsed. Product: the **AX3000 Wi-Fi router** (the Eagle proof line). Precondition: warm cache — `bb finite-state pull all`, `firmware pull` for v2.3 and v2.4, bench host enrolled and hot, dev AS tenant seeded (OQ7). **Everything below works offline from the warm cache except the push beats and the bench dispatch** — which is exactly the SPEC 00 §12 discipline. Format per beat: **Operator** → **Screen** → *why it lands*.

**Beat 1 — One workspace.**
**Operator:** opens bb, FSDS Dark theme. Pans the file tree: `src/`, `product-security/`, `.fs/triage/`, `.fs-firmware/ax3000-v2.4/rootfs/`.
**Screen:** source code, threat model YAML, and 20,418 firmware files in one tree.
*Lands because: the entire product — code, model, bytes — is one worktree. Every later beat depends on the viewer having absorbed this in ten seconds.*

**Beat 2 — New firmware lands; the agent brings the workspace current.**
**Operator (in a thread):** *"v2.4 just came off CI. Bring the workspace up to date and tell me what changed."*
**Screen:** agent calls `fs_firmware_materialize {mode:"manifest"}` and the sync pull; the firmware chip ticks up; the agent posts the version diff — `+ libcrypto.so.3 · ~ httpd (RELRO partial→full ✓) · − telnetd ✓ · 20,331 unchanged, 0 bytes downloaded` — and the drift banner: **"312 decisions re-attached · 14 re-apply (carry-forward missed) · 9 stale · 2 orphaned."**
*Lands because: the platform silently lost 14 triage decisions in carry-forward; the workspace recovered them (SPEC 02 §8.4). "The platform lost this; the workspace didn't" — said with a number, not a claim.*

**Beat 3 — The agent sizes the new work.**
**Operator:** *"What's new and untriaged?"*
**Screen:** `fs_findings_query {triage:"untriaged", version:"v2.4"}` → the agent: "412 untriaged findings; 306 match the unreachable policy rule; 1 is in KEV — CVE-2026-31337 in httpd, EPSS 91st percentile, **reachable**." It renders `::fs-finding{id}` — the live finding card, in the message.
*Lands because: the agent didn't paste a wall of JSON; it showed the one card that matters.*

**Beat 4 — Policy does the routine work.**
**Operator:** *"Triage the routine ones per policy."*
**Screen:** `fs_triage_apply_policy` runs; in the Findings panel (split screen) gutter dots light up **live** as YAML is written (file watcher → realtime). The agent posts `::fs-triage-summary{id="tr-…"}`: *305 decisions written · 1 held (KEV) · view diff.*
*Lands because: bulk work happens in seconds, visibly, and touches nothing but files.*

**Beat 5 — 🔶 OH MOMENT 1: the agent's work is just a diff.**
**Operator:** opens the git diff on `.fs/triage/`. Scrolls 305 YAML blocks — status, justification, evidence, pin, provenance `by: bb-agent`. Edits one weak justification in the editor. Deletes one block they disagree with. Commits: `triage: v2.4 unreachable batch (agent, reviewed)`.
**Screen:** a plain diff view; a human editing an agent's reasoning like code.
*Proves: **the agent proposes, the human approves** — agent output is not a black-box action log, it's reviewable text under version control. This is the trust mechanism, seen rather than described.*

**Beat 6 — Plan, conflict, push.**
**Operator:** clicks the header chip → review panel. `304 to update · 1 conflict`. The conflict shows base/ours/theirs with audit attribution — *"jsmith set EXPLOITABLE in the web UI yesterday"* — theirs-wins pre-selected. Operator confirms, hits **Push**.
**Screen:** chunked bulk apply streams per-item progress; result card `304 applied · 0 failed`; each pushed reason carries `[bb:tr-…]`.
*Lands because: we didn't overwrite a teammate, and we can prove what we sent. (Fallback: against the dev tenant if stage network is down — the plan render itself is offline-safe.)*

**Beat 7 — 🔶 OH MOMENT 2: the real finding meets the threat model, in the chat.**
**Operator:** *"Now the KEV one. Is this covered by our threat model?"*
**Screen:** agent calls `fs_tara_query`, then renders `::fs-canvas{focus="COMP-httpd" highlight="THREAT-22"}` — **the live architecture canvas mounts inside the message**, zoomed to httpd, THREAT-22's attack path lit across the WAN zone boundary. Agent: "Yes — THREAT-22 covers spoofed management sessions, but no requirement mandates the session-binding mitigation. That's the gap."
*Proves: **one workspace** — the model isn't a document in another app; it answers questions visually, inline, from local state. Nothing else in the market does this.*

**Beat 8 — The agent drafts the requirement.**
**Operator:** *"Draft the requirement, EARS, traced to THREAT-22 and CRA Annex I."*
**Screen:** `fs_requirement_write` → validation passes on the second attempt (the first error and self-correction are worth leaving in — it shows the gates are real). Agent renders `::fs-req{id="REQ-118"}`: *WHEN a management session is established, the httpd service SHALL bind the session token to the client TLS channel…* — with an empty tier strip and status ○ Not run.
*Lands because: the requirement is born with its verification contract and its trace — and it is not "verified"; nothing is verified yet.*

**Beat 9 — The agent fixes the firmware source.**
**Operator:** *"Implement it."*
**Screen:** agent uses native Edit on `src/httpd/session.c` (same worktree, no tool ceremony), citing REQ-118 in the change. The working tree now holds: a source change, a new requirement YAML, and the KEV finding's triage block (`IN_TRIAGE`, reason referencing REQ-118).
*Lands quietly here; pays off at Beat 12.*

**Beat 10 — Dispatch the bench; the allowlisted action is visible.**
**Operator:** *"Prove it — run Tier 1 scoped to REQ-118."*
**Screen:** `fs_bench_run` is visibly recorded as one of the three allowlisted ACTION tools. It asserts full materialization (auto-hydrates the httpd closure with a progress bar), then the run appears in the Bench timeline **as a live thread** on `rack-01`: QEMU rehost boots, the Forge pen-test agent probes the management interface, the thread terminal scrolls. If the rehearsal's bb/provider policy presents an approval interaction, it may be shown as policy behavior—not as the plugin's safety boundary.
*Lands because: the sanctioned action is enumerated and auditable, and a verification run is a first-class thread, not a spinner.*

**Beat 11 — 🔶 OH MOMENT 3: evidence, not assertion.**
**Operator:** waits ~3 minutes (rehearsed against a pre-warmed image; canned run as fallback).
**Screen:** the run flips green; the agent posts `::fs-verdict{id}` — **the safe-to-OTA card**: tier coverage, *18 of 18 required requirements proven*, `Signed · keyless OIDC · Rekor a7f3… [verify ↗]`. Operator clicks the Rekor link: the public transparency log entry.
*Proves: the product's claim is **a signature anyone can check**, not a dashboard's opinion. The agent never said "it's safe" — the card did, and the card is signed.*

**Beat 12 — 🔶 OH MOMENT 4: one commit spans source + model + decisions.**
**Operator:** opens the combined diff and commits: `httpd: bind sessions to TLS channel (REQ-118, THREAT-22)`. The diff contains `src/httpd/session.c`, `product-security/requirements/req-118.yaml`, and `.fs/triage/…/httpd.yaml` — one review, one commit, three layers. In the Verifications matrix, REQ-118's row now reads static ✓ · emulation ✓, and the card's pill is ● **Verified — derived from runs; no button was ever clicked** (SPEC 03 §3.3).
*Proves: the seam between "the code," "the security model," and "the decisions" is gone. This is the sentence investors repeat afterward.*

**Beat 13 — The trace, end to end.**
**Operator:** opens REQ-118's detail; the traceability rail renders: `THREAT-22 → REQ-118 → CRA Annex I §2 → commit 3f91a → CHK run ✓ → attestation d4f1…`. Every segment is a live link; the operator clicks two of them fast.
**Screen:** threat card → canvas → commit diff → verdict card, each in under a second (all cache-local).
*Lands because: "traceability" stops being a compliance word and becomes a thing you can click.*

**Beat 14 — Close on the attestation.**
**Operator:** downloads the DSSE envelope from the verdict card, drops it on the table (figuratively): *"Firmware digest, requirement IDs, verdict, signature, public log. This file is the compliance deliverable — and everything you watched was files, diffs, and signatures. The agent did the work; a human reviewed every model-changing step that mattered."*

**The four oh-moments, and what each proves:** Beat 5 — *the agent proposes, the human approves* (trust is a diff). Beat 7 — *one workspace* (the model answers inline, visually). Beat 11 — *evidence, not assertion* (signed, publicly verifiable). Beat 12 — *the seam deletion* (source + model + decisions in one commit). If a rehearsal audience doesn't audibly react at 5, 7, or 12, fix the staging before touching the features.

---

## 7. Multi-agent and long-running work

**7.1 Bench runs are threads on hosts.** Per SPEC 05 B9: the emulation box and HIL rack enroll as bb hosts; dispatching a run spawns a thread (`bb.sdk.threads.spawn`, `origin: "plugin"`) bound to that host; the thread's terminal is the live log; `bench_run.thread_id` links row↔thread; the `threadPanelAction` "Bench run" tab pins the run beside whatever thread requested it. The plugin is the index and verdict layer over bb's own job model — we build no job runner. (The host-enrollment SDK surface is SPEC 05 OQ1 — the one architectural unknown; resolve before Phase 6 rehearsal.)

**7.2 Parallel triage across components.** The panel's "Ask agent to triage" and the CLI can fan out: one thread per component (or per filter shard), each scoped by predicate. Safety is structural, not coordinated: one YAML file per component (SPEC 02 §4.2) makes shards write-disjoint; every write is CAS, so an accidental overlap errors cleanly instead of clobbering; `overlay_index` converges via the file watcher regardless of writer count; policy application is idempotent (skips existing), so overlapping shards double-write nothing. No locks, no queues — partition + CAS + idempotency. If real contention appears (two agents editing one component's file), the loser's CAS failure is surfaced as a retryable tool error (OQ5).

**7.3 Progress via realtime.** All long work publishes the SPEC-defined channels (`fs-firmware-progress`, `fs-bench-run`, `fs-bench-log`, `fs-triage-overlay-changed`, `fs-push-progress`) as refetch nudges, never data (SPEC 00 §5). This is also the human-visibility half of the design law: an agent's bulk run lights up the panel *while it happens*, so "the agent is doing something to my model" is never a mystery state.

**7.4 Interruption mid-write.** A killed agent run cannot corrupt state, by construction: CAS file writes are atomic per file — there is no torn YAML; decisions written before the kill are valid, individually reviewable, and visible in `status` like any local change; re-running the task is convergent (§4.7) — it skips what's done and finishes the remainder; the `triage_runs` record marks the run incomplete, and `::fs-triage-summary` renders the partial honestly ("written 180 of ~305 — run interrupted"). The recovery procedure is the normal workflow: look at the diff, decide, re-run or revert via git. Push interruption is separately covered by `push_log` resumability (SPEC 02 §8.1). The worst case for every failure mode is *extra reviewable files* — which is the point of the iron rule.

---

## 8. Context management

**8.1 Injected automatically (small, always-on):**

1. **The plugin-skills tier** — descriptions of the eight skills; bodies load on trigger (§3.6).
2. **The auto-generated plugin-commands skill** — the CLI tree.
3. **The workspace-status block**, contributed via the SDK's instruction-contribution hook (`contributeInstructions()` — exact contract OQ1), budgeted at **≤150 tokens**:

```
[Finite State] project=acme-router version=v2.4
firmware: manifest ready (20,418 files, 312 hydrated)
sync: 3 local changes · 1 conflict · pulled 12m ago
Use fs_* tools to query; write YAML only; a human pushes.
```

That's the entire automatic footprint. It answers the three questions every session starts with (which product? how fresh? anything pending?) and re-states the iron rule in one line.

**8.2 On demand, everything else.** No entity bodies, no findings lists, no SBOM rows ride in ambient context — 39k findings would be ~4M tokens; the cache exists so they never need to be. The agent retrieves through tools (paged summaries), native Read (authored YAML), and mentions (the *user* pulls fresh context into their own message by typing `@REQ-104` — send-time resolution, SPEC 03 §6.5).

**8.3 The size discipline.** Tool responses ≤ ~4 KB soft budget (§4.3); directives cost the *human* screen space but the agent only the directive string — which is why the skills push "show, don't paste"; mention resolutions are single-entity cards, not dumps; the status block never grows a field without deleting one.

**8.4 The SQLite cache is the agent's memory.** Between sessions, the agent forgets; the workspace doesn't. The cache holds the world's state (findings, results, SBOM, runs), the YAML holds every decision with provenance, and git holds the history of both — so a fresh session reconstructs any prior conclusion by querying, not by remembering. "Why did we mark #CVE-2023-42364 not affected?" is answered from the overlay's `reason` + `evidence` + `provenance`, written precisely so that a future agent (or auditor) with zero conversation history can retrieve the reasoning. Durable knowledge goes in files; context is for the current task. The skills state this as craft: *if you conclude something worth keeping, write it into the decision's evidence — the next session only knows what the files know.*

---

## 9. Build plan + definition of done

Most of this layer ships *inside* Phases 2–5 — each surface lands its own tools, directives, mentions, and skill with the surface (SPEC 00 §12 requires it). Phase 6 is the consolidation and the proof:

| Step | Deliverable | Effort |
|---|---|---|
| 6.1 | **Apply the reconciliation log** — renames (⚑2/4/5/11), `#`-provider consolidation (⚑3), document-store unification (⚑12), confidence type (⚑13), tier mapping (⚑14); redlines to SPECs 00/02/03/05 | 2–3 d |
| 6.2 | **Registry-as-code + CI assertions** (§4.8): class/server checks, directive cold-cache tests, error-shape conformance | 2 d |
| 6.3 | **Skills pass** — root skill, final wording of all eight, triggering eval (20 scripted asks route to the right skill/tool), plugin-commands verification | 2–3 d |
| 6.4 | **Context injection** — status block via instruction contribution, token budget telemetry on tool responses | 1–2 d |
| 6.5 | **Golden Loop fixtures** — AX3000 v2.3/v2.4 pair with seeded carry-forward loss, KEV finding, THREAT-22 gap, pre-warmed rehost image, dev-tenant seed, canned bench run fallback | 2–3 d |
| 6.6 | **Loop wiring + rehearsal** — script beats 1–14, offline warm-cache pass end-to-end, interruption chaos tests (§7.4), two consecutive clean runs | 3–4 d |
| | **Total** | **~2.5–3.5 wks** |

**Definition of done for the layer:**

- Every §2.1 tool, §2.2 directive, §2.3 provider, and §2.4 verb exists, matches the registry constant, and has one integration test.
- CI proves the safety model: no non-action tool can reach a remote write/action module; the three ACTION tools are the exact compile-time allowlist and every invocation is logged; `fs_sync_push` does not exist and a test asserts its absence.
- Every directive renders correctly from a cold cache (fallback card) and a warm cache (live), offline.
- The skills eval routes ≥ 18/20 scripted asks correctly; no skill instructs anything the safety model forbids.
- The Golden Loop runs **twice consecutively, offline from warm cache** (push/bench beats against the dev tenant), in under 15 minutes, by someone other than the person who built it.
- An interrupted bulk run (killed mid-write) leaves state that `status` explains and a re-run completes — demonstrated, not argued.
- Every ⚑ item in §2.6 is either applied or has a tracked ticket with an owner.

---

## 10. Open questions

1. **`contributeInstructions()` contract.** The Build Guide names the hook but not its shape/refresh cadence. Verify against SDK 0.4.x before building §8.1; fallback is prepending the status block via the root skill (worse: static per-session).
2. **Multiple mention providers per trigger.** Does bb merge, rank, or conflict two providers on `#`? Verify before deciding whether ⚑3's consolidation is required or merely preferred. (Consolidate anyway — one dedup point.)
3. **In-message canvas interactivity** (SPEC 03 OQ1). Beat 7 works read-only with "Open in panel." Accept/reject-on-canvas inside a directive is real scope; decide *before* Phase 6, and only if a rehearsal shows Beat 7 needs it (current judgment: it doesn't).
4. **bb host enrollment** (SPEC 05 OQ1). Beats 10–11 depend on run-as-thread; if hosts are modeled as environments, bind to environment ids. The one architectural unknown in the Loop — resolve first in Phase 6.
5. **Contention beyond CAS.** Two agents on one component file error-and-retry today (§7.2). If real workloads show thrash, add an advisory per-file lease in the plugin backend; do not build it speculatively.
6. **Token-budget telemetry.** The ~4 KB soft budget is a design target; instrument real tool-response sizes during rehearsal and tighten schemas where the p95 exceeds it.
7. **Stage push target.** Does the live demo push to a seeded dev AS tenant (safe, resettable) or a production-like tenant (impressive, riskier)? Recommendation: dev tenant with production data shapes; record one production-tenant run as the "it's real" backup.
8. **Skill-triggering regression.** Skills select by description; provider-model updates can shift routing. Add the §9 triggering eval to CI so a model bump that breaks routing fails loudly.
