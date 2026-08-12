# SPEC 03 — Product Security (TARA Canvas, Requirements, Verifications)

*Product spec. Depends on SPEC 00 (conventions, plugin skeleton, direct Assurance Studio client) and SPEC 01 (sync engine — all VERSIONED/OVERLAY behavior here rides on it). Grounding docs: `Canvas Port — TARA Architecture Canvas into bb.md`, `AS Entity Inventory — View, Edit & Local Treatment.md`, `bb Feature Designs — Firmware FS, EARS Conversion, HBOM.md` §Feature 2. Owner: Matt Wyckhouse. Status: ready for implementation.*

**Spec set:** 00 Foundation · 01 Sync Engine · 02 Findings & VEX Triage · **03 Product Security (this)** · 04 Bill of Materials · 05 Firmware Mount, Bench & Documents · 06 Agentic Surfaces

**Scope:** one nav panel — **Product Security** — with three subPath tabs: `tara` (the architecture/threat canvas), `requirements` (EARS cards), `verifications` (the requirement × tier matrix). This is the surface where the threat model, the requirements that answer it, and the proof that they hold all live next to the code.

---

## 1. The job to be done

**The user:** the product security engineer who owns the TARA for a connected product, and the firmware engineer who has to satisfy it.

**What's painful today.** The threat model lives in Assurance Studio; the code lives in an IDE; the firmware lives in a scanner; the evidence lives in a test system. The security engineer alt-tabs between four tools to answer one question — *"is this threat actually mitigated, and can I prove it?"* — and every hop loses context. Requirements are prose in a web form; nobody can diff them, review them, or trace one to the commit that implemented it. Verification status is a column someone glances at, not a matrix anyone trusts. And when the agent proposes a change to the model, there is no way to see exactly what it wants to change before it lands.

**What this spec makes possible:**

1. **The model lives next to the code.** Threats, architecture, and requirements are YAML files in `product-security/` in the same worktree as the source and the firmware mount (SPEC 05). One commit can change a dataflow, the requirement that governs it, and the code that implements it — and get one review. The agent's native Grep/Read/Edit reach all three. `git log product-security/threats/threat-22.yaml` is the threat's history.
2. **The threat model is spatial and cross-linked.** The AS canvas — the most recognizable artifact of the product — ports into bb with the interaction model users already know, and gains the links AS cannot draw: node → SBOM entry, node → files in the firmware mount, node → mitigating requirements, node → verification runs. The product graph, visible.
3. **Requirements are contracts, not prose.** Every requirement is EARS-normalized with its verification contract inline. Status is *derived from runs* — there is no button that asserts "verified," only a button that runs the verification. That single rule is what makes the compliance story honest.
4. **"What's unproven?" has a screen.** The requirement × tier matrix answers the program lead's real question in one glance, and every cell drills to logs, artifacts, and a signed attestation.

Per SPEC 00 §2, the agent is a first-class user of every one of these: it drafts threats and requirements as YAML diffs, converts legacy requirements to EARS, queries the model, and triggers verification runs — always through the same review flow the human uses.

---

## 2. Tab 1 — TARA Canvas

### 2.1 What ships

The port of `finite-state-platform/apps/web/src/components/canvas/` (32 files, ~17k lines) per the Canvas Port plan: **React Flow (`@xyflow/react` v12) + `elkjs` auto-layout**, extracted into `components/canvas/` with imports re-pointed (`@/lib/utils` → bb's `cn`, shadcn primitives → bb's vendored set, `next-themes` → bb theme hook — the single Next.js import in the module), Supabase fetchers swapped for plugin RPC, `project-permissions-context` stubbed always-permitted, Supabase realtime deleted for v1. The hooks (`use-canvas-data.ts`, `use-canvas-nodes.ts`, `use-canvas-edges.ts`) are the data seam — swap fetcher internals, don't touch components. `AttackTreeCanvas.tsx` and `StrideMicroBar.tsx` come along.

Both canvas libs are heavy: **lazy-load the whole canvas module** (`React.lazy` inside the tab) so the requirements/verifications tabs never pay for it (SPEC 00 §10 bundle budget).

### 2.2 The viewport

Full-bleed inside the nav panel body (bb gives us zero host padding — we own layout and scrolling). Three regions:

```
┌──────────┬────────────────────────────────────────────┬─────────────┐
│ Stencil  │                Canvas                      │  Inspector  │
│ (left,   │   pan / zoom / box-select / drag           │  (right,    │
│ collaps- │   zones as containers, components as nodes │  collapsible│
│ ible)    │   dataflows as edges                       │  320px)     │
├──────────┴────────────────────────────────────────────┴─────────────┤
│ Threat table (bottom drawer, resizable, virtualized)                │
└─────────────────────────────────────────────────────────────────────┘
```

- **Pan/zoom/select** — unchanged from AS: wheel zoom, space-drag pan, click select, shift-box multi-select, fit-view button, minimap toggle. `elkjs` auto-layout on demand ("Tidy" button), never on every change.
- **Node types.** Zones render as labeled container groups (trust boundaries; nested per the parent hierarchy, cycle-guarded server-side). Components render as typed nodes with a distinct glyph per `component_type`: `software`, `hardware`, `sensor`, `actuator`, `ecu`, `hsm`, `tee`, `medical_device`, `network`. Entry points (`is_entry_point`) get a doorway badge; criticality tints the border (color + label, never color alone — SPEC 00 §7).
- **Dataflows** — directed edges with protocol label; lock glyph when `encrypted`, key glyph when `authenticated`; edges crossing a zone boundary render the boundary-crossing tick that makes trust boundaries legible.

### 2.3 Threat overlay (the reason the canvas matters)

- **STRIDE micro-bars.** Every component node carries a six-segment micro-bar (S·T·R·I·D·E), each segment sized by count of open threats in that category and tinted by max severity. Port of `StrideMicroBar.tsx`; category mapping comes from the cached methodology profile's `methodology_stride_property_map` — do not hardcode STRIDE labels.
- **Threat badges on edges** for dataflow-targeted threats.
- **Attack paths render as highlighted traversals**: selecting an attack path animates/hightlights its edge sequence node-by-node in step order, dims everything else, and shows the step list in the Inspector with the path's `is_viable` decision (an OVERLAY field — editable locally). Attack-path bodies are agent-computed and volatile; they come from the SQLite cache, keyed by `route_signature` (the stable key).
- **Bidirectional selection with the threat table.** Select a node/edge → the bottom threat table filters to threats targeting it. Select a threat row → its target nodes highlight and its attack paths become selectable. Selection state is ephemeral React state — never persisted, never in YAML.

The overlay is computed from local state: threats from the working YAML (so an *unpushed, agent-drafted* threat appears on the canvas immediately, marked with a "local" chip), counts and attack paths from the SQLite cache. No external call occurs in a render path (SPEC 00 fact #2).

### 2.4 Cross-surface links (what AS cannot do)

The Inspector for a selected component node shows four link rows, each a real navigation:

| Link | Source of truth | Target |
|---|---|---|
| **SBOM entry** | `component_sbom_package_links` (OVERLAY, `.fs/links/sbom.yaml`) + SBOM cache | SBOM panel row (SPEC 04), `toPluginPanel("bom", { subPath: "software/<purl>" })` |
| **Files in the firmware mount** | local mapping `.fs/links/firmware.yaml` (net-new, local-only — AS has no firmware mount) | bb's native file tree at `.fs-firmware/<pv_id>/rootfs/<path>` (SPEC 05) |
| **Requirements that mitigate it** | threat → mitigation → requirement joins from working YAML | Requirements tab, filtered to the node |
| **Verification runs** | `verification_results` cache joined through those requirements | Verifications tab, matrix filtered to the node's requirements |

These rows are how the demo says *"the product graph is real"*: click a node, see the package, the bytes, the requirement, and the proof. The firmware-files mapping is seeded by the agent (grep the mount for the component's binaries/configs, write the mapping file as a reviewable diff) — spec'd in the SKILL (§6.4).

### 2.5 Editing model

**Local edits → YAML → plan → push.** The canvas is a *view over the working tree*, not a client of the server:

- Add/edit/delete of components, zones, dataflows, and threats writes the corresponding YAML file under `product-security/` (serializers per §5). The canvas re-renders from the file change (the backend watches the model dirs and publishes a `fs-ps-changed` realtime nudge; panels refetch via RPC).
- **No save button on the canvas and no direct server write, ever.** The panel header shows the SPEC 01 status chip ("4 local changes"); push happens in the review panel (`/plugins/finite-state/sync`) or `bb finite-state push product-security`. This supersedes the Canvas Port doc's interim "explicit Save to Assurance Studio" idea — the sync engine *is* the save mechanism, for human and agent edits alike.
- **Layout is separate from model** (SPEC 01 serialization rule 3). Node positions, collapsed-zone state, and viewport go to `product-security/layout/canvas.json` — git-tracked (a teammate cloning the repo gets a sane layout) but **registered as a non-pushed entity**: it never appears in a plan. AS's `canvas_node_positions` tables are API-orphaned (no write route — Entity Inventory §1f), so there is nothing to push layout *to*. Debounce layout writes at 500ms trailing; a drag session is one file write, not sixty.
- Local undo/redo via the ported `use-canvas-history.ts`, operating on the in-memory graph before serialization. Undo does not revert files already written; the YAML diff in git is the durable undo.

### 2.6 Stencil, Inspector, context menu

- **Stencil** (left rail): draggable node templates — one per component type, plus zone. Dropping creates the YAML file with a generated slug (`comp-<name>`, uniqueness enforced) and opens the Inspector for immediate naming. Collapsed by default on first open; state in layout file.
- **Inspector** (right rail): properties of the selection, editable per the field rules in §5 — name, type, description, criticality, zone, interfaces (nested list editor), `is_entry_point`, `stores_data`; for dataflows: endpoints, protocol, `encrypted`/`authenticated`/`bidirectional`; for threats: full threat editor (category from methodology vocab, severity, affected refs as slug pickers). Derived/server-owned fields (counts, review state, `display_code`) render read-only with a lock glyph. Below properties: the four cross-surface link rows (§2.4).
- **Context menu** (right-click, bb's shimmed Radix context-menu): *Add threat targeting this* · *Link SBOM package…* · *Map firmware files…* (spawns the agent task) · *Show attack paths through this* · *Open requirements* · *Duplicate* · *Delete…* (impact-aware — §8.1).

### 2.7 States

Per SPEC 00 §7, all four designed: loading = skeleton graph (gray node placeholders at last-known layout); empty = "No architecture yet — draw one, import from AS with `pull`, or ask the agent to derive one from the firmware"; error = what failed + retry; unconfigured = `needsConfiguration`.

---

## 3. Tab 2 — Requirements

### 3.1 Cards, not rows

A requirement carries an embedded verification contract, a trace chain, and EARS structure — a table row can't hold it. The tab is a **virtualized card list** (TanStack Virtual; cards are ~fixed-height collapsed), with a filter bar on top and a detail view on click.

**Collapsed card, exact layout:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ REQ-104  [event-driven]  [security · high]              ● Verified   │  ← header row
│                                                                      │
│ WHEN a firmware update image is received,                            │  ← EARS text;
│ the Update Service SHALL verify the image signature against the      │    keywords
│ provisioned public key before writing it to flash.                   │    (WHEN/SHALL)
│ ────────────────────────────────────────────────────────────────────│    typographically
│ Verification   static ✓ · emulation ✓ · HIL —      2 of 2 required  │  ← tier strip
│ Evidence       attestation d4f1…9c2 · 2026-08-09                     │
│ Traces to      CRA Annex I §2(c) · THREAT-22 · commit a91f2          │
└──────────────────────────────────────────────────────────────────────┘
```

- **Header row:** monospace `req_id`, EARS pattern chip, type·priority badge, status pill right-aligned.
- **EARS text** set as the card body with the pattern keywords (WHEN/WHILE/IF…THEN/WHERE/SHALL) rendered in the heading face — the notation *is* the design.
- **Tier strip:** one glyph per tier with latest-result color + count; "—" for tiers with no mapped check.
- **Trace line:** clause · threat · commit, each a link (clause → clause card from the standards cache; threat → canvas focused on it; commit → bb's diff view).
- Local-modified cards get the "local" chip; drifted ones the "stale" overlay chip (§3.3).

### 3.2 The six EARS patterns

The pattern is data (`ears.pattern`), validated by the plan step and taught to the agent in the SKILL:

| Pattern | Shape | Chip |
|---|---|---|
| `ubiquitous` | The `<system>` SHALL `<response>` | UBIQ |
| `event_driven` | WHEN `<trigger>`, the `<system>` SHALL `<response>` | WHEN |
| `state_driven` | WHILE `<state>`, the `<system>` SHALL `<response>` | WHILE |
| `unwanted_behavior` | IF `<trigger>`, THEN the `<system>` SHALL `<response>` | IF/THEN |
| `optional_feature` | WHERE `<feature>`, the `<system>` SHALL `<response>` | WHERE |
| `complex` | Combination of the above clauses | CPLX |

Well-formedness rule (enforced at plan time, SPEC 01 §5 schema validation): the populated `ears.parts` fields must match the declared pattern (`event_driven` ⇒ `trigger` non-null, `state` null; etc.), and `ears.text` must round-trip from `parts` (template render, whitespace-normalized compare). This forces the structure and the prose to agree.

### 3.3 Status ladder — derived, never asserted

**The critical rule: `requirements.verification_status` is web-unwritable** — it is owned by the agents-service rollup and recomputed from `verification_results` on every run (confirmed in `verification/results/route.ts:12–40`; the POST body's `verification_status` key never writes the column). The UI encodes this: **there is no "mark verified" control anywhere in this plugin. The only affordance is "Run verification"** (and "Record attestation," which posts a *result row* through the record endpoint so the rollup fires — never a status write). The plan validator hard-rejects any YAML that includes `verification_status` (derived-field guard, SPEC 01 §5).

The displayed pill maps server truth (worst-wins ladder `failed > error > inconclusive > running > pending > verified > skipped`) onto five user-facing states:

| Pill | Derivation (over latest results of *required* checks) |
|---|---|
| ● **Verified** | all required checks `verified` |
| ◐ **Partial** | ≥1 `verified` or `inconclusive`, none `failed`/`error` (inconclusive adds a chip) |
| ● **Failed** | any `failed` or `error` |
| ○ **Not run** | no results exist |
| ⟳ **Stale** (overlay chip, composable with any of the above) | computed locally: the requirement's semantic content hash, or the target firmware version, changed after the newest result's `executed_at` |

Base states come from the cached server rollup (`ProjectVerificationSummary`) so we never re-derive what the platform already computes; **stale** is our local addition and is always visually an overlay, not a replacement — a stale-verified requirement is still "verified, but the world moved."

### 3.4 Filters and traceability view

**Filter bar:** free text · pattern · `req_type` · priority · status pill (incl. "stale only," "failing only") · tier ("has HIL check") · CRA clause (typeahead over the clause cache) · threat (slug) · "local changes only."

**Detail view** (card click, right-side sheet or full subPath route `requirements/REQ-104`): full card + rationale + original `source_description` (audit trail of the pre-EARS text) + the inline verification contracts (each check: method, tier, required, pass/fail criteria, expected evidence, latest result with `evidence_summary` and link into the matrix) + the **traceability chain rendered as a horizontal rail**:

```
THREAT-22 ──▶ REQ-104 ──▶ CRA Annex I §2(c) ──▶ commit a91f2 ──▶ CHK-sig-verify (static ✓) ──▶ attestation d4f1…
   threat        this req      clause (cache)       git blame on      verification run          signed evidence
                                                    the YAML file                                (SPEC 05)
```

Every segment self-fetches by id (SPEC 00 §7 convention) so the same rail renders inside a `::fs-req` directive. The commit segment comes from `git log --follow` on the requirement's YAML file — the payoff of the model living in git.

### 3.5 The EARS conversion flow

Converting a legacy AS project's free-text requirements into EARS is a reasoning task — it runs **in an agent thread**, not in deterministic backend code, with three gates before anything lands:

1. **Trigger.** Tab button "Convert to EARS" (or `bb finite-state ears convert`) spawns a thread (`bb.sdk.threads.spawn`, `origin: plugin`) scoped to all — or the selected/drifted — requirements.
2. **Grounding.** The thread gets (a) the AS requirement + mapped-check + result bundle via the `fs_ears_convert` tool's `bundle` action (§6.2), and (b) `skills/product-security/SKILL.md`'s EARS section: the six patterns with decision rules ("has a WHEN trigger → event_driven; WHILE state → state_driven; IF/THEN undesired → unwanted_behavior; always-true → ubiquitous; feature-gated → optional_feature; combinations → complex"), the exact YAML schema, and the hard rules: *preserve `req_id` verbatim; keep the original text in `source_description`; copy `pass_criteria`/`fail_criteria` from the AS check, never paraphrase; reference checks by slug; set `check: null` where AS has no check yet; never invent ids.*
3. **Output + the three gates.** The agent writes one YAML file per requirement into `product-security/requirements/`:
   - **Gate 1 — schema.** `fs_ears_convert {action:"validate"}` parses with the zod schema (§5.2): enum values, pattern/parts agreement, text round-trip. The agent iterates until clean.
   - **Gate 2 — round-trip.** The validator resolves every referenced slug against `id_map` + the AS pull: every requirement maps to a real `as_requirement_id`, every non-null check to a real check. Orphans and unknowns are listed; no hallucinated linkage survives.
   - **Gate 3 — human review as diff.** The conversion is now an ordinary working-tree change: the user reviews it in bb's native diff panel / the SPEC 01 review panel and commits. Push to AS is a separate, later act — and note that for already-imported requirements the EARS rewrite is an *update to `description`* on push (plan shows old → new), which is exactly the review that should happen.
4. **Drift re-runs.** When `pull` detects upstream requirement/check changes newer than the conversion snapshot, affected cards get the stale chip and the tab banner offers "Re-convert N changed" — re-spawning the agent scoped to only those, with the instruction to preserve human-edited EARS text unless the source `description` itself changed (`human_edited` discipline, mirrored locally via git history).

*(Supersedes the Feature Designs §2c single-file `.fs-requirements/…/requirements.yaml` layout: per SPEC 01, requirements are one VERSIONED file per entity in `product-security/requirements/`, keyed by `req_id`. No parallel `EARS-…` id namespace — the `req_id` is the slug.)*

---

## 4. Tab 3 — Verifications

### 4.1 The matrix is the primary view

The question this tab answers is **"what's unproven?"** — so the landing view is the **requirement × tier matrix**, not a list of runs.

```
                         static    emulation    HIL       manual*
 REQ-101  update auth      ✓✓         ✓          —           —
 REQ-104  sig verify       ✓          ✓          ⟳ queued    —
 REQ-107  TLS floor        ✗          ○          —           ✓ att.
 REQ-112  watchdog limp    —          —          ○           —
 …
 ✓ verified   ✗ failed/error   ◐ inconclusive   ⟳ running   ○ mapped, not run   — no check mapped
```

- **Rows** = requirements (virtualized; same filter bar as Tab 2, plus "unproven only" which is the default sort — rows with any ✗/○/— float up).
- **Columns** = tiers, mapped deterministically from `check_type`: `config_check | sbom_query | binary_analysis | binary_pattern | vuln_absence` → **static**; `dynamic` → **emulation** or **HIL** (disambiguated by check `parameters`/`category`; `external_sync` → HIL/bench bridge); `manual | attestation | document_review` → **manual** (narrow column, off by default — toggle in the header; open question §10.6). Bench run tiers (SPEC 05 B7, `tier0…tier4`) map onto these four columns at sync time: tier0 → static · tier1, tier2 → emulation · tier3 → HIL · tier4 → manual (mapping table in SPEC 05 B10).
- **Cells** colored + glyphed by the worst latest result among that requirement's checks in that tier (`is_latest` chain from the cache), with a count when >1 check. Color plus glyph, never color alone.
- Header row: project rollup — `coverage_percentage`, counts by status, `by_control_category` mini-bars — straight from the cached `ProjectVerificationSummary`.
- A row's ⟳ **stale** overlay (from §3.3) renders on the row label, not per-cell.

### 4.2 Cell → run detail

Clicking a cell opens the run detail (right sheet; subPath `verifications/REQ-104/static`):

- **Check contract:** name, code, pass/fail criteria, parameters (the one locally-editable field on checks — OVERLAY), `is_required`/`coverage_level`/`suppressed` toggles (OVERLAY on the requirement↔check mapping).
- **Result history:** the `is_latest`/`superseded_by` chain, newest first — status, confidence, `executed_at/by`, `fs_version_name` (which firmware build it ran against), `failure_reason`, `remediation_suggestion`.
- **Logs** — cursor-paged RPC over the cached/bench log store; large logs stream via a `bb.http` route (RPC is strict-JSON, no streaming).
- **Artifacts** — links served through `bb.http` proxy routes (auth stays server-side).
- **Signed attestation** — for bench-tier runs, the SPEC 05 verdict card: artifact hash, firmware hash, signature, timestamp. Visually unmistakable; it is the thesis of the product.

### 4.3 Triggering runs — ACTION-ONLY

Runs are **invoked, not stored** (SPEC 01 class table). Three affordances:

- **"Run verification"** on a cell/row/selection → the named check-run method on `AssuranceStudioClient`. The backend publishes progress/refetch nudges via `bb.realtime`; matrix truth returns from the next direct AS results refresh. If a check delegates to Forge compute, that is AS/Forge orchestration behind the check—not a reason for this surface to proxy all AS traffic through Forge.
- **"Record attestation"** (manual tier) → posts through `/api/requirements/{id}/verification/record` (which delegates to the agents service **so the rollup fires**) — never a direct `verification_results` insert, and never a status field write. Requires an evidence note; the UI copy makes the semantics honest: a manual `verified` does not outrank a failing automated check (ladder: failed > verified).
- **Bench/HIL runs** dispatch through the SPEC 05 bench (`bb finite-state bench run`), which writes results back to AS via `external_sync`; this tab only reflects them.

Nothing about a run lands in YAML; the plan never contains "run" operations.

---

## 5. Data model

### 5.1 Registry entries (extends SPEC 01 §2)

```ts
// lib/sync/registry.ts — additions for this surface
export const ENTITIES = {
  component:    { class: "VERSIONED", dir: "product-security/architecture/components", key: slugKey },
  zone:         { class: "VERSIONED", dir: "product-security/architecture/zones",      key: slugKey },
  dataflow:     { class: "VERSIONED", dir: "product-security/architecture/dataflows",  key: slugKey },
  asset:        { class: "VERSIONED", dir: "product-security/architecture/assets",     key: slugKey },
  threat:       { class: "VERSIONED", dir: "product-security/threats",                 key: slugKey },
  mitigation:   { class: "VERSIONED", dir: "product-security/mitigations",             key: slugKey },
  requirement:  { class: "VERSIONED", dir: "product-security/requirements",            key: reqIdKey }, // slug = req_id
  reqCheckMap:  { class: "OVERLAY",   inline: "requirement" },   // serialized inside requirement YAML; decomposed at plan time
  checkParams:  { class: "OVERLAY",   dir: ".fs/verification/checks",  key: checkCodeKey }, // parameters only
  attackPath:   { class: "OVERLAY",   dir: ".fs/attack-paths",   key: routeSignatureKey }, // viability decision over cached body
  sbomLink:     { class: "OVERLAY",   dir: ".fs/links",          key: componentSlugKey },  // component ↔ SBOM
  firmwareLink: { class: "OVERLAY", server: "none", localOnly: true, dir: ".fs/links", key: componentSlugKey }, // never pushed — AS has no concept
  canvasLayout: { class: "VERSIONED", server: "none", localOnly: true, file: "product-security/layout/canvas.json" }, // git-tracked, never planned
  verificationResult: { class: "CACHED", table: "verification_results" },
  verificationCheck:  { class: "CACHED", table: "verification_checks" }, // body cache; params edited via overlay
  standardClause:     { class: "CACHED", table: "standards_clauses" },
} as const;
```

There are exactly four classes: `VERSIONED`, `CACHED`, `OVERLAY`, and `ACTION-ONLY`. Local-only is the explicit `localOnly:true` capability on a `server:"none"` VERSIONED or OVERLAY entry; those files remain git-tracked and agent-readable but are excluded from semantic plan and remote push.

### 5.2 YAML — requirement (EARS with inline verification)

```yaml
# product-security/requirements/req-104.yaml
id: REQ-104                       # slug = AS req_id; never reused
req_type: security                # security|privacy|safety|regulatory|operational
priority: high
status: approved                  # draft|approved|implemented|verified (workflow status — writable; distinct from verification_status)
ears:
  pattern: event_driven
  text: >
    WHEN a firmware update image is received, the Update Service SHALL verify
    the image signature against the provisioned public key before writing it to flash.
  parts:
    trigger: "a firmware update image is received"
    precondition: null
    state: null
    feature: null
    system: "the Update Service"
    response: "verify the image signature against the provisioned public key before writing it to flash"
rationale: "CRA Annex I §2(c) secure update; prevents unsigned firmware."
source_description: >             # original AS free text, retained for audit
  Firmware updates must be cryptographically verified before installation.
mitigations: [MIT-secure-update]  # slug refs; pushed via PATCH add_/remove_mitigation_ids
controls: [CTRL-secure-update]    #            via add_/remove_control_ids
standards: [EU-CRA/annex1-2c]     #            via add_/remove_standard_ids
verification:                     # inline contract = requirement_verification_checks rows + check refs
  - check: CHK-sig-verify-static  # slug → verification_checks (id_map); null = check not yet created in AS
    method: binary_analysis       # AS check_type enum, kept for round-trip
    tier: static                  # static|emulation|hil|manual (derived; stored for readability)
    required: true                # → mapping.is_required
    coverage: full                # → mapping.coverage_level
    suppressed: false             # → mapping.suppressed ("don't re-suggest")
    pass_criteria: "sig-verify routine present AND dominates all flash-write paths"
    fail_criteria: "update path reaches flash write with no preceding verify"
    expected_evidence:
      - "STP callgraph: verify_signature -> flash_write dominance"
  - check: null                   # proposed check — plan flags it "needs check creation" (§10.3)
    method: dynamic
    tier: emulation
    required: false
    pass_criteria: "QEMU rehost: update with bad signature is rejected"
# NEVER serialized: verification_status, verification_summary, verification_last_run_at,
# verification_evidence_ids — server/derived; live values come from the cache.
```

At plan time the `verification:` block decomposes into its real API shapes: mapping create/PATCH (`{check_id, requirement_ids[]}`, `{is_required, coverage_level, suppressed}`), requirement PATCH `add_/remove_*` arrays for the trace lists. One YAML file, several ordered API calls — the serializer owns that mapping, the human never sees it.

### 5.3 YAML — threat

```yaml
# product-security/threats/threat-22.yaml
id: THREAT-22
name: "Spoofed management session on WAN-facing httpd"
category: spoofing                # validated against the cached methodology STRIDE vocabulary
threat_source: external_attacker  # AS threat_source enum
severity: high
description: >
  An unauthenticated attacker on the WAN interface establishes a management
  session by replaying captured session tokens…
affected_components: [COMP-httpd, COMP-mgmt-api]   # → threat_component_mappings
affected_assets: [ASSET-admin-cred]                # → threat_asset_mappings
dataflows: [FLOW-wan-mgmt]
mitigations: [MIT-tls-enforce, MIT-session-binding] # → threat_mitigation_mappings
assumptions: "Management interface reachable from WAN per current firewall defaults."
```

Mapping lists serialize as slug arrays inside the owning entity (SPEC 01 §4) and push as nested mapping POST/DELETEs, diffed as set operations (auto-mergeable per SPEC 01 §6).

### 5.4 YAML — architecture entities

```yaml
# product-security/architecture/components/comp-httpd.yaml
id: COMP-httpd
name: httpd
component_type: software          # software|hardware|sensor|actuator|ecu|hsm|tee|medical_device|network
description: "WAN-facing management HTTP daemon"
zone: ZONE-wan
criticality: high
is_entry_point: true
stores_data: false
interfaces:
  - { name: mgmt-api, protocol: https, port: 443, direction: inbound }
technologies: [openssl, uhttpd]

# product-security/architecture/dataflows/flow-wan-mgmt.yaml
id: FLOW-wan-mgmt
name: "WAN → management API"
from: COMP-wan-if                 # slug refs; idmap resolves at push
to: COMP-httpd
protocol: HTTPS
encrypted: true
authenticated: true
bidirectional: false
```

The dataflow serializer **absorbs the AS field-name mismatch** (POST wants `source_component_id`/`is_encrypted`; PATCH wants `from_component`/`encrypted` — Entity Inventory §2.4). YAML uses the domain names above; the push adapter maps per verb. Same treatment for assets' `business_value` (POST) vs `criticality` (PATCH).

### 5.5 The exclusion list (what never serializes)

Per SPEC 01 §4 rule 1: every VERSIONED entity strips the server-owned block — `id/project_id/organization_id` (uuids live in `id_map`), `source`, `created_by_agent`, `model_id`, `source_evidence_ids`, `source_chat_run_id`, `created_by_user_id`, all `review_*`, all `ai_*`, `human_edited/at/by`, `reviewed/reviewed_by/reviewed_at`, `processing_*`, `needs_reanalysis`, `stale_reason`, `embedding`, `created_at`, `updated_at`, plus per-entity derived fields (`display_code`, `*_count`, `verification_*`, `assurance_level`, computed severity). **Implement this by mirroring `tara_snapshot_semantic_payload()`** (`20260721100000_add_tara_version_control_foundation.sql:1533–1578`) — the platform's own canonicalization — so our local content hashes are directly comparable to server `semantic_hash` values. One function, shared by the serializer, the differ, and the stale detector. Do not hand-derive a second list.

### 5.6 SQLite cache tables (adds to SPEC 00 §5)

```sql
-- latest + history of verification outcomes (CACHED; refreshed on pull and after runs)
CREATE TABLE verification_results (
  id              TEXT PRIMARY KEY,          -- AS uuid
  requirement_key TEXT NOT NULL,             -- our slug (req_id), via id_map
  check_key       TEXT,                      -- check slug; NULL = manual attestation
  tier            TEXT NOT NULL,             -- static|emulation|hil|manual (derived at sync from check_type)
  status          TEXT NOT NULL,             -- verified|failed|error|inconclusive|running|pending|skipped
  confidence      TEXT,
  evidence_summary TEXT,
  result_data     TEXT,                      -- jsonb passthrough (logs pointer, artifact refs, attestation)
  executed_at     TEXT, executed_by TEXT,
  failure_reason  TEXT, remediation_suggestion TEXT,
  fs_version_id   TEXT, fs_version_name TEXT,
  is_latest       INTEGER NOT NULL DEFAULT 0,
  superseded_by   TEXT,
  sla_status      TEXT,
  synced_at       TEXT NOT NULL
);
CREATE INDEX vr_matrix ON verification_results(requirement_key, tier, is_latest);
CREATE INDEX vr_check  ON verification_results(check_key, is_latest);

-- check bodies (CACHED; the editable `parameters` lives in the .fs/ overlay, not here)
CREATE TABLE verification_checks (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  check_type TEXT NOT NULL, category TEXT, description TEXT,
  pass_criteria TEXT, fail_criteria TEXT, input_description TEXT,
  parameters TEXT, default_sla_days INTEGER, synced_at TEXT NOT NULL
);

-- per-requirement server rollup (ProjectVerificationSummary projection — the status pill source)
CREATE TABLE requirement_rollup (
  requirement_key TEXT PRIMARY KEY,
  verification_status TEXT,                  -- the server's derived value, displayed never written
  total_checks INTEGER, verified_checks INTEGER, failed_checks INTEGER,
  error_checks INTEGER, inconclusive_checks INTEGER, running_checks INTEGER,
  pending_checks INTEGER, skipped_checks INTEGER,
  last_run_at TEXT, synced_at TEXT NOT NULL
);

-- standards + clauses (CACHED, very low volatility; the traceability + filter vocabulary,
-- incl. the 69 EU CRA clauses)
CREATE TABLE standards (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
  scope TEXT NOT NULL,                       -- system|org
  synced_at TEXT NOT NULL
);
CREATE TABLE standards_clauses (
  id TEXT PRIMARY KEY, standard_id TEXT NOT NULL REFERENCES standards(id),
  clause_code TEXT NOT NULL,                 -- e.g. "annex1-2c"
  section_path TEXT, parent_clause_id TEXT,
  title TEXT, text TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX sc_std ON standards_clauses(standard_id, section_path);

-- attack-path bodies for the canvas overlay (CACHED; viability decision is the .fs/ overlay)
CREATE TABLE attack_paths (
  id TEXT PRIMARY KEY, route_signature TEXT NOT NULL UNIQUE,
  name TEXT, threat_key TEXT, steps TEXT NOT NULL,          -- ordered step/edge JSON
  edges TEXT, total_steps INTEGER, zones_traversed TEXT,
  exploitability TEXT,                                       -- computed score block, display-only
  synced_at TEXT NOT NULL
);
```

Plus the shared `base_snapshot`, `id_map`, `sync_state`, `push_log` from SPECs 00/01. Methodology-profile vocab (STRIDE map, risk scales, CIAG properties) is cached per Entity Inventory §1e — it is the plan validator's vocabulary input; this surface reads it, SPEC 01 owns its refresh.

---

## 6. bb integration

### 6.1 Nav panel + subPath routing

```tsx
// app.tsx
app.slots.navPanel({
  id: "product-security",
  title: "Product Security",
  icon: "ShieldCheck",
  path: "product-security",
  component: ProductSecurityPanel,          // owns /plugins/finite-state/product-security/*
  headerContent: PsHeader,                  // tab switcher + sync status chip + project picker
});
```

`ProductSecurityPanel` routes on `subPath`:

| subPath | View |
|---|---|
| `tara` | canvas (lazy chunk) |
| `tara/threats/<slug>` | canvas with threat selected + table row focused |
| `tara/nodes/<slug>` | canvas focused/zoomed to node, Inspector open |
| `requirements` | card list |
| `requirements/<req_id>` | card detail + traceability rail |
| `verifications` | matrix |
| `verifications/<req_id>/<tier>` | run detail sheet open |

Internal navigation via `useBbNavigate().toPluginPanel("product-security", { subPath })` so browser back/forward walks panel history. The header chip shows pending local changes (from `fs_sync_status`) and deep-links to the SPEC 01 review panel.

### 6.2 Agent tools (`bb.agents.registerTool`)

Four tools; per SPEC 00 §8, reads are free, **writes touch YAML only** — with one flagged, deliberate exception.

```ts
bb.agents.registerTool({
  name: "fs_tara_query",                    // READ
  description: "Query the product-security model: threats, components, zones, dataflows, "
    + "attack paths, requirements, verification state. Serves from local YAML + cache; "
    + "returns slugs suitable for directives and mentions.",
  input: z.object({
    kind: z.enum(["threat","component","zone","dataflow","asset","requirement",
                  "verification","attack_path","clause","trace"]),
    filter: z.record(z.string()).optional(),   // e.g. {component:"COMP-httpd"}, {status:"failed"}
    limit: z.number().int().max(200).default(50),
  }),
  // handler: SQLite + working-YAML index; paged; never calls a remote service
});

bb.agents.registerTool({
  name: "fs_requirement_write",             // WRITE → YAML ONLY
  description: "Create or update a requirement as EARS YAML in product-security/requirements/. "
    + "Validates schema + slug references and returns errors instead of writing when invalid. "
    + "Never contacts the server; changes appear in the plan for human review.",
  input: z.object({
    req_id: z.string().regex(/^REQ-[A-Za-z0-9-]+$/),
    yaml: z.string(),                          // full desired file content
  }),
  // handler: zod-validate → ears well-formedness → slug resolution → write file → return diff summary
});
```

`fs_requirement_write` exists so the agent gets **instant validation** instead of discovering schema errors at plan time; the SKILL says "prefer the tool; native Edit is allowed but plan will catch what you break." Threats/architecture edits go through native file tools (same YAML, same plan gate) — a dedicated validating writer for them is a fast-follow if error rates warrant.

```ts
bb.agents.registerTool({
  name: "fs_ears_convert",                  // READ + VALIDATE (the conversion scaffolding)
  input: z.discriminatedUnion("action", [
    z.object({ action: z.literal("bundle"),
               req_ids: z.array(z.string()).optional() }),   // → AS requirements + checks + results source material
                                                             //   cache-served (from the last pull), never a live AS
                                                             //   call; stale ids are caught by gate 2 (SPEC 06 ⚑10)
    z.object({ action: z.literal("validate"),
               paths: z.array(z.string()) }),                // → gates 1+2 results: schema errors, orphan refs
  ]),
});

bb.agents.registerTool({
  name: "fs_verification_run",              // ACTION-ONLY — the flagged exception
  description: "Trigger verification check runs for a requirement/tier. Invokes the platform's "
    + "own analysis; results land as server-side evidence rows. Does NOT edit the model.",
  input: z.object({
    requirement: z.string(),
    tier: z.enum(["static","emulation","hil","manual"]).optional(),
    check: z.string().optional(),
  }),
  // handler: AssuranceStudioClient.runVerificationCheck → realtime progress; returns job summary
});
```

**On the exception:** SPEC 00 §8's rule is "no agent tool calls a **model-mutating remote endpoint**," with ACTION-ONLY invocations as the enumerated exceptions (SPEC 06 §5.3). Verification runs are classified ACTION-ONLY in SPEC 01 precisely because they are *invocations of the platform's own analysis*, not edits to the authored model. `fs_verification_run` therefore stands, and it is the *only* remote-touching tool in this spec. There is **no** `fs_sync_push` and no attestation tool — attestations are a human act in the panel.

### 6.3 Directives (`app.slots.messageDirective`)

All four fetch by id via RPC (attributes are attacker-controlled — never render attribute content, never accept payloads):

| Directive | Renders | Notes |
|---|---|---|
| `::fs-threat{id="THREAT-22"}` | `<ThreatCard id/>` — name, category, severity, targets, mitigation/requirement links | click-through → `tara/threats/THREAT-22`; named for the entity rendered, not the tab (SPEC 06 §2.6 ⚑4) |
| `::fs-canvas{focus="COMP-httpd" highlight="THREAT-22"}` | **the live canvas inside the message** — see §6.6 | |
| `::fs-req{id="REQ-104"}` | the §3.1 card, identical component | click-through → `requirements/REQ-104` |
| `::fs-matrix{filter="component=COMP-httpd"}` | compact matrix slice (≤15 rows; "+N more → open panel") | filter grammar = the tab's filter params, validated |

Unknown ids render the designed empty/error card, never a crash (directives are ErrorBoundary'd; fallback is literal text).

### 6.4 SKILL.md outline

`skills/product-security/SKILL.md` (SPEC 06 owns final wording; this is the contract):

1. **What this surface is** — the model lives in `product-security/` as YAML; the firmware mount and source live beside it; AS is the system of record reached only via plan/push.
2. **Stable keys** — slug conventions (`THREAT-*`, `COMP-*`, `ZONE-*`, `FLOW-*`, `REQ-*`, `CHK-*`); reference by slug, never UUID; never reuse a slug.
3. **File map + edit rules** — which dirs are VERSIONED vs overlay vs local-only; edit YAML with native tools or `fs_requirement_write`; **never call a mutating API; never write `verification_status`, review fields, or any §5.5 excluded field**; run `bb finite-state plan product-security` to check your work; ask the human to push.
4. **EARS authoring** — the six patterns with the decision table; parts must match pattern; keep `source_description`; copy criteria verbatim.
5. **Verification honesty** — never claim a requirement is verified; query `fs_tara_query {kind:"verification"}` for truth; to change status, `fs_verification_run` and wait for results.
6. **Cross-links** — how to populate `.fs/links/firmware.yaml` (grep the mount, cite paths, write the mapping as a diff) and `.fs/links/sbom.yaml` (purl from the SBOM cache).
7. **Show, don't describe** — directive syntax + when to use each (discussing a threat → `::fs-threat`; architecture context → `::fs-canvas` focused; a requirement → `::fs-req`; coverage questions → `::fs-matrix`).
8. **Mentions** — use `@REQ-104` / `@THREAT-22` in replies so they resolve for the user.

### 6.5 Mention provider + CLI

```ts
bb.ui.registerMentionProvider({
  id: "fs-model", label: "Product Security", triggers: ["@"],
  search: async (q) => idIndex.search(q),   // REQ-, THREAT-, COMP-, FLOW-, CHK- over SQLite + YAML index
  resolve: async (itemId) =>                 // at send time: fresh YAML + cached live status
    renderMentionContext(itemId),            // e.g. @REQ-104 → EARS text, tier strip, latest results, trace refs
});
```

`@REQ-104` and `@THREAT-22` in a composer resolve to *fresh* context at send time — the traceability glue between the user's sentence and the model. (`#CVE-…` belongs to the shared `fs-intel` provider registered in SPEC 02 §6.5; `~bench-run-…` to SPEC 05.)

CLI (extends SPEC 00 §9; both humans and agents use these — all list output supports `--json`):

```
bb finite-state pull|status|plan|push product-security     # the sync verbs, scoped
bb finite-state tara show <slug>                            # threat/component/zone/dataflow by slug
bb finite-state req list [--status failed --clause EU-CRA/…] | show REQ-104
bb finite-state ears convert [--reqs REQ-104,REQ-107] [--drifted]
bb finite-state verify matrix [--unproven]                  # the matrix as a table
bb finite-state verify run REQ-104 [--tier static]
bb finite-state verify results REQ-104
```

1 MiB CLI output cap — page everything.

### 6.6 The canvas inside an agent message

`::fs-canvas{focus=… highlight=…}` mounts the same lazy canvas module in the message timeline:

- **Fixed height 420px** (min 280 / max 560 via optional `height`, clamped), full message width; pan/zoom live; minimap off; stencil and inspector hidden.
- **Read-only in-message** (v1 decision, §10.1): selection and hover work, editing affordances are suppressed. An **"Open in panel ↗"** button top-right navigates to `tara/nodes/<focus>` with the same highlight — editing happens there.
- `focus` zooms/centers the named node; `highlight` selects a threat and lights its attack-path traversal — the exact §2.3 overlay behavior, so *the agent reasons in prose and the model responds visually in the same message*.
- The chunk loads once per session (shared `React.lazy` module with the tab); a skeleton graph renders while loading. Data comes from the same RPC reads — a directive is never a second data path.

This is the capability nothing else in the market has, and it must be demo-reliable: it reads only from local cache/YAML, so it works offline from a warm cache (SPEC 00 definition of done).

---

## 7. Concurrency specifics

All per SPEC 01 §5–6 and Entity Inventory §3.1; restated here only where this surface is the one that exercises it.

**The tokens that exist.** Entity PATCH/PUT on every entity in this spec is last-write-wins — no ETag, no If-Match. The real tokens are: (1) **TARA head version + content hash** — version-control RPCs take `expectedHeadVersionId` (and trial-apply `expectedWorkingContentHash`); mismatch → HTTP 409 `{code:"stale_tara_state"}`; (2) **`review_version`** — per-row bigint checked by `transition_review_lifecycle(p_expected_version, p_operation_id)`.

**The checkpoint recipe (every push of this surface):**

```ts
// lib/sync/checkpoint.ts — bracket the push
const head = await assuranceStudio.getTaraState(projectId);  // verified TARA head/checkpoint read
if (head.id !== base.headVersionId) return abortAndReplan(); // upstream checkpointed since our pull

await applyRows(plan);                                       // §below: per-row, ordered, chunked,
                                                             // per-entity base advance (SPEC 01 §5)
const ckpt = await assuranceStudio.createTaraCheckpoint(projectId, {
  name: `bb push ${runId}`,
  expectedHeadVersionId: head.id,
});
// 409 stale_tara_state → someone else checkpointed mid-push. Applied rows are already
// base-advanced (coherent); re-pull, re-plan, surviving dirty items re-apply next run.
```

Honest limits, stated in the UI copy of the review panel: the head check catches drift **between checkpoints** — a concurrent writer's *un-checkpointed* entity writes are not detectable mid-push (our own writes set `tara_history_dirty` too). Keep push windows short, chunk small; the audit trail makes any residual race reconstructable. If the platform exposes `begin_tara_trial` on the web API (SPEC 01 open ask #1), push upgrades to a true fenced transaction with per-conflict resolutions and no client redesign.

**Review state** (badges shown on threats/requirements from cache): any approve/reject action we ship goes through the token-checked review endpoint with the cached `review_version` — ACTION-ONLY, never a YAML field, and a 409 there means refresh-and-retry, not merge. Direct writes to `reviewed*` columns make the server trigger RAISE; the plan validator rejects them before the server has to.

**Per-row pushes.** There is **no bulk create/update for any entity in this spec** — a changeset is one HTTP call per created/modified entity, ordered (creates before dependents: zones → components → dataflows/assets → threats → mitigations → requirements → mappings; deletes in reverse), chunked through the SPEC 00 token-bucket, resumable via `push_log`. The only bulk routes this surface may use: `threats/bulk` DELETE (1..100) for multi-delete, and mapping array-PATCHes. A 200-entity EARS conversion push is ~200+ sequential calls — the plan's blast-radius footer says so before you click Push.

**Read-back verification** after PATCH on routes without `.strict()` (components, zones — §8.5): re-GET and compare, because a 200 is not proof the field landed.

---

## 8. Edge cases

**8.1 Deletes: cascade/detach + the 409 contract.** TARA deletes are hard deletes negotiated per the deletion-impact contract: DELETE with `?mode=cascade|detach`; a disallowed mode returns 409 with `allowedActions`. The plan (and the canvas context-menu delete) must therefore *pre-fetch impact* and present it: "Delete COMP-httpd — detaches 3 dataflows, orphans 2 threats' mappings. Mode: [detach]." Deletes run last, reverse dependency order, each requiring the SPEC 01 blast-radius confirmation. A 409 mid-apply marks the item `failed` in `push_log` with the server's `allowedActions` echoed for the retry.

**8.2 Non-restorable entity types.** `restore_deleted_entity` hardcodes `requirement`, `mitigation`, `verification_check`, `verification_result` as **non-restorable** — a pushed delete of a requirement is forever, server-side. Two consequences: (a) deleting a requirement or mitigation requires the typed-confirmation variant of blast radius ("type REQ-104 to confirm"), copy stating it cannot be restored in AS; (b) our git history *is* the restore path — the review panel's post-delete toast offers "restore from git" which resurrects the YAML file and plans a re-create (new server UUID; `id_map` rebinds; slug — and therefore all local references — survive, which is precisely why we reference by slug).

**8.3 Canvas position churn.** Positions change on every drag and belong to no model change. Handled structurally (§2.5): layout in `product-security/layout/canvas.json`, debounced 500ms, never planned/pushed. Remaining risk is **git noise** — a browse session that only moved nodes still dirties the layout file. Mitigations: write only on actual position/collapse deltas (not on pan/zoom — viewport is in-memory only), round coordinates to integers, stable key order + stable float formatting so diffs are minimal and reviewable. If churn still annoys in practice, demote the layout file to gitignored local-only via a plugin setting — but default is tracked, because a shared layout is worth a small diff.

**8.4 Large threat models.** Design targets: 500 components / 2,000 threats / 5,000 attack paths (the AS canvas's own fetch cap) / 5,000 requirements (the AS list clamp).
- Canvas: `elkjs` runs in a Web Worker (it supports this) with a layout spinner — never on the main thread, never automatically above 200 nodes; React Flow `onlyRenderVisibleElements`; STRIDE micro-bar counts come from a pre-aggregated SQLite view refreshed on sync/edit, not per-render joins; attack-path overlay renders one selected path at a time, not all 5,000.
- Requirements: virtualized cards; filters push down to SQLite (`LIMIT/OFFSET` + total); never fetch-all through the AS default — always page explicitly.
- Matrix: virtualized rows; cell states from the single `vr_matrix`-indexed query; the whole matrix for 5,000 × 4 is one SQL pass, not N queries.
- Pull: requirements/results paged per the Entity Inventory pagination styles; progress via realtime.

**8.5 `.strict()` PATCH drops.** The inconsistency is server-side reality; the plan absorbs it (SPEC 01 derived-field guards + per-route field sets):
- **Strict routes** (threats, assets-PATCH, damage scenarios, goals, claims): a stray key = 400. The serializer emits exactly the allowlisted field set, so this never fires in production — it fires in CI, where a schema test pushes one of each entity against a dev tenant.
- **Non-strict routes** (components, zones, attack-path POST): unknown keys are *silently stripped* — hence read-back verification (§7) after every PATCH there.
- **Risks PATCH** silently drops non-allowlisted keys with a 200 and no guard; risk-treatment edits are OVERLAY and out of this tab's v1 scope, but the shared plan validator already special-cases the allowlist so nobody trips it later.
- **Dataflows**: the POST/PATCH field-name mismatch (§5.4) — covered by the per-verb adapter; a CI round-trip test (create → patch → get → compare) pins it against upstream rename drift.

**8.6 Orphans and drift.** Overlay decisions whose stable key no longer resolves (a check deleted server-side; an attack path whose `route_signature` vanished on re-run) surface in `status` as orphans (SPEC 01 §5) with a sweep action in the review panel. Requirement staleness (§3.3) is recomputed on every pull; a firmware re-scan (new `fs_version_id` on latest results) flips stale chips without any user action.

---

## 9. Build plan

Slots into SPEC 00 build sequence Phase 3 (after Findings/VEX has forced the sync engine into existence). One strong front-end-leaning engineer plus the shared infra and direct AS client already standing.

| Step | Deliverable | Effort | Notes |
|---|---|---|---|
| 3.1 | **Canvas port** — extract, re-point imports, RPC data boundary, permissions stub | 5–7 d | Canvas Port Phases 1–2; the hooks are the seam |
| 3.2 | Canvas **editing model** — YAML writers, layout file, watcher → realtime, undo | 2–3 d | supersedes "explicit save"; rides SPEC 01 |
| 3.3 | **Threat overlay** — STRIDE micro-bars, attack-path traversals, bidirectional table selection | 3–4 d | ports `StrideMicroBar`/`AttackTreeCanvas` |
| 3.4 | **Cross-surface links** — Inspector link rows, `.fs/links/*` overlays, agent mapping task | 2–3 d | needs SBOM (04) + firmware mount (05) to *land*; build behind readiness flags in this phase |
| 3.5 | **Requirements tab** — EARS schema + zod validator, card list/detail, filters, traceability rail | 4–5 d | |
| 3.6 | **EARS conversion** — `fs_ears_convert` bundle/validate, skill section, drift re-run, review-gate wiring | 3–4 d | conversion itself is agent reasoning; this is the scaffolding |
| 3.7 | **Verifications tab** — matrix, run detail, run/attestation actions, results sync | 4–5 d | |
| 3.8 | **Agentic surface** — 4 tools, 4 directives, mention provider, CLI verbs, SKILL.md | 3–4 d | domain components already self-fetch, so directives are thin |
| | **Total** | **~5.5–7 wks** | |

**The canvas is ~2–2.5 weeks on its own (steps 3.1–3.3)** — it is deliberately its own line item, not a "TARA panel" rounding error; it is the most recognizable artifact of the product and the most demo-valuable surface we have. Ship order within the phase: 3.1–3.2 first (a working, editable canvas is the milestone demo), then requirements, then verifications, then the agentic layer.

**Remote dependency — closed Assurance Studio operations.** Implement the frozen `AssuranceStudioClient` methods for checks, results, requirement rollups/mappings, check runs, and manual result recording. The vendored AS OpenAPI is incomplete, so each missing route must be verified against handler-backed evidence before implementation. There is no generic raw-API fallback; an unverified operation stays blocked behind a typed amendment rather than becoming an arbitrary request seam.

**Definition of done:** SPEC 00 §12, plus surface-specific checks — canvas edits round-trip through plan/push against a dev tenant including the dataflow field-mismatch and a cascade-delete 409; the EARS converter passes all three gates on a real legacy project; the matrix renders 5,000 requirements from cold cache <200ms; `::fs-canvas` works offline from warm cache.

---

## 10. Open questions

1. **In-message canvas editability.** v1 is read-only-in-message with "Open in panel" (§6.6). If the Golden Loop demo wants "agent proposes an architecture change and you accept it *on the canvas in the message*," that's real scope (accept/reject affordances + plan integration inside a directive) — decide before Phase 6, not during.
2. **`begin_tara_trial` web exposure** (SPEC 01 open ask #1). If it lands, §7's bracket upgrades to a fenced server-side transaction. Track; don't block.
3. **Check creation path.** `verification_checks` POST goes through the AGNO proxy (and rejects `project_id` in the body) — it's unclear bb can create checks non-interactively. Until verified, a `check: null` contract in requirement YAML plans as **"needs check creation — run the verification-authoring agent"** rather than a create op. Needs a platform answer.
4. **`scope_specs` has no dedicated public REST route** (Entity Inventory flag). Scope is VERSIONED in the registry but un-pushable today; keep it pull-only and flag edits as local-only until the route exists.
5. **Canvas layout tables are API-orphaned in AS.** If AS ever adds a layout write path, decide whether `canvas.json` starts syncing (probably yes, as a low-priority OVERLAY) — the local file format should stay a superset of AS's `canvas_node_positions` shape to keep that door open.
6. **Manual tier column default.** Matrix ships with manual hidden by default (§4.1) on the theory that attestations are exceptions, not coverage. Revisit after first regulated-customer feedback — a 510(k) shop may want it front and center.
7. **Risk records on this surface.** Risk treatment/acceptance (OVERLAY) is deliberately out of v1 — the threat table shows severity, not the full risk chain. Decide whether a `tara/risks` sub-view joins this panel or waits for a dedicated surface.
