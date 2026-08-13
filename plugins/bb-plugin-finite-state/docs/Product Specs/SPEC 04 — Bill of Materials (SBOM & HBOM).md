# SPEC 04 — Bill of Materials (SBOM & HBOM)

*Product spec. Depends on SPEC 00 (conventions, plugin skeleton, direct Platform/Assurance Studio clients, SQLite) and SPEC 01 (sync engine, data classes, registry). Joins against SPEC 02's findings cache; feeds SPEC 03's cross-links; consumes SPEC 05's firmware mount and document viewer. Grounding docs, cited below: "bb Feature Designs — Firmware FS, EARS Conversion, HBOM" §Feature 3 **[FD]**, "AS Entity Inventory — View, Edit & Local Treatment" **[INV]**, "Findings & VEX Triage — Local-First Design" **[LFD]**, "UX & Front-End Plan — The Finite State Panels in bb" **[UX]**. Owner: Matt Wyckhouse. Status: ready for implementation. Phase 4 of the SPEC 00 build sequence.*

**One nav panel, two tabs.** `Bill of Materials` (`bom`) with subPaths `software/*` (SBOM) and `hardware/*` (HBOM) — matching the IA in [UX §3] and the link targets SPEC 03 already emits (`toPluginPanel("bom", { subPath: "software/<purl>" })`).

The two tabs are deliberately unequal. **SBOM is a read surface over rich server data** — the platform already computes everything; our job is to make 10,000 rows instant, joined, and cross-linked. **HBOM is an authored surface over almost nothing** — no HBOM entity exists anywhere in the stack [FD §3a], and the AS hardware-typed components it seeds from carry zero procurement fields [INV §1a]. SBOM's design problem is density and linkage. HBOM's design problem is *trust* — and that is where this spec spends its depth (§6).

---

## 1. The job to be done

### 1.1 SBOM — "what's in this product, and what's wrong with it"

A product security engineer, a compliance lead, or the agent asks: *what components ship in this firmware, at what versions, under what licenses, with what known vulnerabilities, and can the vulnerable code even run?* Today that answer is spread across the AS SBOM page (50 rows per server round trip [INV §1c]), the findings list, and a separate reachability view — and nothing links a component to the actual files it landed as in the image.

On this surface: the full SBOM is cached locally (CACHED class, SPEC 01 §2), renders in under 200ms, filters instantly, and every row is a hub — component → its CVEs (SPEC 02), → its files (SPEC 05 firmware mount), → the architecture components, threats, and requirements that reference it (SPEC 03). Export is one click to CycloneDX or SPDX with VEX decisions included, because the platform already generates those server-side [LFD §3.1].

### 1.2 HBOM — "what parts are on this board, where did they come from, can I prove it"

The hardware question has no system of record at Finite State or almost anywhere else. The state of the art is a procurement spreadsheet: unsigned, unprovenanced, stale the day the second source was approved, and silent about the one thing an auditor asks — *how do you know?*

**Why this suddenly matters (the regulatory forcing function):**

- **FCC** — the SBOM/HBOM FNPRM (DA 26-786 / FCC 26-50) proposes requiring a **signed HBOM and SBOM with every equipment certification application**. Every device our customers certify would need exactly the artifact this surface produces.
- **EO 14415 §3** — requires an **indentured (hierarchical) bill of materials with software provenance traced to origin** for covered products. "Traced to origin" is a provenance claim per line item — precisely the `{value, provenance, source_ref, confidence}` cell model this spec is built on.
- **CRA** — Annex I/II due-diligence expectations over components reach into hardware supply chain for connected products.

⚑ **Open question (§9.2):** verify the exact FCC paragraph and EO section/clause numbers against primary sources before any customer-facing compliance claim. The product design does not depend on the citations; the marketing claims do.

**The credibility bar:** an HBOM full of confidently-wrong part numbers is *worse* than no HBOM [UX §4] — it fails the audit and burns the trust the whole surface exists to earn. So every field carries provenance and confidence, every agent extraction is a proposal, and nothing reaches an export as "fact" without either strong evidence or a human's acceptance. Showing the uncertainty *is* the product.

### 1.3 Users (per SPEC 00 §2)

| User | SBOM job | HBOM job |
|---|---|---|
| Product security engineer | "Which components are actually exploitable? Which are copyleft?" | "Which parts are crypto-relevant / FCC-covered?" |
| Firmware engineer | "What version of OpenSSL is really in the image, and where?" | "What's the exact MPN of the SoC I'm debugging?" |
| Compliance/program lead | "Give me a signed SBOM for the certification package" | "Give me an HBOM I can defend, with the evidence chain" |
| The agent | Query the cache; cite components in threads | Extract from datasheets/BOMs; propose, never assert |

---

## 2. Tab 1 — SBOM (`bom` → `software/*`)

### 2.1 The table

Virtualized with `@tanstack/react-virtual` (SPEC 00 §7 — virtualize anything unbounded; target 10k rows at 60fps). Data from paged RPC (`{items, total, cursor}`, ≤200/page) backed by SQLite — **no external call in a render path** (SPEC 00 §10). Density per SPEC 00 §7: compact rows, monospace purls, right-aligned numerics, severity as color *plus* label.

**Columns** (defaults; user-configurable, persisted in `bb.storage.kv`):

| Column | Notes |
|---|---|
| Component | `name@version`; hover reveals full purl (monospace); no-purl badge for STP-native components (§7.1) |
| Version | monospace; stale badge when the cache row carries `is_stale` [INV §1c] |
| License | declared license expression; copyleft licenses get an outline chip; unknown renders as `—`, never blank |
| Vulns | severity histogram — four compact counts `C/H/M/L`, color + number; KEV dot when any finding is in KEV |
| Reachability | component-level verdict pill: `unreachable` (all CVE findings negative reachability) / `reachable` (any positive) / `mixed` / `unknown` — rolled up from the SPEC 02 findings cache (§4.1) |
| Files | count of known file locations in the image; click opens the file list (§2.3) |
| Links | icons when the component is referenced by architecture components / threats / requirements via `.fs/links/sbom.yaml` (SPEC 03) |

**Sort:** any column; default worst-vuln severity desc, then name. **Row expansion** (`Enter` or chevron): inline CVE list for the component — CVE id, severity, EPSS percentile, KEV badge, current VEX status badge (hollow/solid/dashed per SPEC 02 §3.1) — each row click-through to `toPluginPanel("findings", { subPath: "f/<stableKey>" })`. The expansion reads the same cache SPEC 02 owns; zero new data plumbing.

### 2.2 Filters, search, saved views

Filter chips + a `/`-focused query box; everything compiles to SQL against the cache — instant.

- **Filters:** worst severity (multi) · has KEV · EPSS ≥ n · reachability verdict · license (specific license, or the `copyleft` / `permissive` / `unknown` groups) · component source (`sca` / `manual`) · linked-to-architecture (yes/no) · has local VEX changes (join on SPEC 02's `overlay_index`).
- **Search:** name, purl, CPE substring. At >10k components, back with SQLite FTS5 over `(name, purl)` — decide in 4a, both are one migration.
- **Saved views**, three shipped: *Vulnerable by severity* (default) · *Copyleft* · *Unlinked to architecture* (components no threat model references — the "did we model this?" gap list). Same mechanism as SPEC 02 §3.2.

### 2.3 Detail pane (route `software/<componentKey>`)

Right split, list stays navigable. Sections top to bottom:

1. **Identity** — name, version, purl (monospace, copy button), CPE, supplier, license block.
2. **Vulnerabilities** — the expansion list, full-height, with the SPEC 02 `<FindingCard>` on click. A "Triage these" action deep-links to the Findings panel pre-filtered to this component.
3. **Files in image** — the cross-surface link that makes this feel like one product, not five tools. v1 source: distinct `location` values from the component's cached findings [LFD §1.1]; when a reviewed component→file Platform route is available, add a named `PlatformClient` method for the platform's unpack mapping — the coordinate system findings and reachability already share [FD §1a]. Each path click reveals the file in the firmware mount's native tree (SPEC 05); if the mount isn't materialized, show the path with a "Mount firmware to open" affordance, not a dead link.
4. **Referenced by** — architecture components linked via `.fs/links/sbom.yaml` (SPEC 03 OVERLAY), and through them the threats targeting those nodes and the requirements mitigating them. Rendered as link rows (`<ThreatCard>`/requirement rows on hover), navigating via `toPluginPanel("product-security", …)`. This is the SBOM-to-security-story join AS cannot draw today.
5. **HBOM link** — when an HBOM part declares this component in `firmware_link` (§3.2), show the part card link ("runs on BCM6755 — U1").

### 2.4 Export

Server-generated, proxied — the platform already produces CycloneDX and SPDX with `includeVex` [LFD §3.1]; we do not re-implement SBOM serialization.

- Panel: **Export…** → format (CycloneDX JSON / SPDX), include-VEX toggle (default on), version selector.
- The plugin backend calls the named `PlatformClient` export method directly and streams the result through a `bb.http` route (§5.6) — **RPC is strict-JSON and cannot return files** (SPEC 00 §5).
- CLI twin: `bb finite-state bom sbom export --format cyclonedx --include-vex` (§5.5).

### 2.5 States

Per SPEC 00 §7, all four designed: **loading** — skeleton table; **empty** — "No SBOM cached for this version. Pull to load." with a Pull button; **error** — stale-with-banner, never blank; **unconfigured** — `needsConfiguration("Connect the Finite State Platform to load your projects")`.

---

## 3. Tab 2 — HBOM (`bom` → `hardware/*`)

This is the novel surface. There is nothing to cache from the server — the pipeline is **seed → enrich → review → export**, entirely plugin-local [FD §3b], with every step leaving a git-reviewable trail.

### 3.1 The grid

A virtualized grid (parts are tens-to-low-hundreds of rows — virtualization is for column count and cell renderers, not row count). Columns in four groups, collapsible:

| Group | Columns |
|---|---|
| **Identity** | Part number · MPN · Manufacturer · Description · Category |
| **Placement** | Qty · Reference designators |
| **Supply** | Lifecycle status · Supplier · Country of origin |
| **Compliance & security** | Compliance flags · FCC-covered · Crypto-relevant · Security relevance |

Plus a left gutter: review-state dot (● cells pending review on this row, ⚠ conflict) and the AS-link icon (part seeded from / linked to an architecture component).

**Every cell renders its provenance state** — this is the visual contract, specified in full in §6.2. Summary: human/high-confidence cells render solid; medium-confidence agent extractions render with a **dashed underline and muted foreground**; low-confidence values render ghosted with a review chip; empty cells render as `—` (unknown) or `n/a` (human-confirmed not applicable — the distinction matters for country-of-origin audits). Hover any non-human cell for the provenance popover: *"MPN from bcm6755-ds.pdf p.7 · confidence 0.72 · extracted by agent 2026-07-29"* with a click-through that opens the source document at that page/cell (SPEC 05 viewer).

**Header strip:** completeness meter (% of fields populated · % human-verified), review-queue chip (`14 cells to review` → `hardware/review`), and the ingest dropzone trigger.

### 3.2 The schema

One YAML document, VERSIONED class, in the worktree (§4.2 for placement rationale). The full cell model is in §4.3; the field set:

| Field | Type | Notes |
|---|---|---|
| `part_number` | string | internal/catalog part number |
| `mpn` | string | manufacturer part number — the load-bearing identity for supply-chain checks |
| `manufacturer` | string | |
| `description` | string | |
| `category` | enum | `soc · mcu · memory · pmic · sensor · phy · crypto · connector · passive · module · other` |
| `quantity` | integer | per board |
| `reference_designators` | string[] | `["U1"]`, `["R14","R15"]` |
| `lifecycle_status` | enum | `active · nrnd · eol · obsolete · unknown` |
| `supplier` | string | distributor/source of supply |
| `country_of_origin` | string (ISO 3166) | the EO 14415 "traced to origin" field |
| `compliance_flags` | string[] | `RoHS`, `REACH`, `ITAR`, … |
| `fcc_covered_list` | boolean | FCC Covered List relevance |
| `crypto_relevant` | boolean | ties to HSM/TEE/CBOM story |
| `security_relevance` | string | free text, e.g. "root-of-trust host" |
| `firmware_link` | componentKey | joins the part to SBOM/firmware (§2.3.5) |
| `external_refs` | `[{type, url}]` | datasheet links etc. |

**Every one of these is a `{value, provenance, source_ref, confidence, by, at}` cell, not a scalar** [FD §3c]. That single decision drives the review queue, the merge engine, the UI states, and the export fidelity — and it makes the eventual server-side promotion a mechanical column mapping (§4.5).

### 3.3 Seeding from AS architecture components

`bb finite-state bom hbom seed` (also a first-run panel action): pull AS components through `AssuranceStudioClient`, filter **client-side** to hardware types — `hardware · sensor · actuator · ecu · hsm · tee · medical_device` (AS has no server-side type filter [FD §3b]) — and create one HBOM part per component:

- `description`, `category` (mapped from `component_type`), `security_relevance` (from criticality/zone context) — provenance `as_component`, confidence 0.5–0.7.
- Part-ish tokens parsed from `technologies`/`description` (e.g. "BCM6755" in a description) land as **candidates, not values** — the seed must not launder a prose mention into an MPN.
- All procurement fields (`mpn`, `supplier`, `country_of_origin`, `lifecycle_status`, …) start **empty**. The seed is shallow but real [FD §3a]: it gives the HBOM its logical skeleton and its AS linkage (`as_component_id`), and sets the honest expectation that **documents carry the real data**.

Re-seed is idempotent: matches on `as_component_id`, adds new AS components, flags AS-deleted ones (`as_missing: true` — never auto-delete a part a human may have enriched), and **never touches any cell whose provenance isn't `as_component`**.

### 3.4 Document-driven enrichment

The workflow that fills the HBOM [FD §3d]:

1. **Upload.** The panel dropzone (or `bom hbom ingest <file>`) posts the binary to the plugin's `bb.http` upload route (§5.6) — binary cannot ride RPC (SPEC 00 §5). Accepted kinds: `datasheet` (PDF), `bom` (XLSX/CSV), `schematic` (PDF/netlist text). Stored content-addressed in the single document store at `product-security/documents/<sha256>-<filename>` (git-tracked; SPEC 06 §2.6 ⚑12), recorded in the shared `document` ledger with a `doc_kind` (SPEC 05 C12.1) — `hbom_docs` is a filtered view over it (§4.4) — announced via realtime.
2. **Extract (agent).** Upload offers "Extract with agent" (or the agent picks it up when asked). The agent reads the document with **native tools** — it's in the worktree — reasons about it, and submits structured cells via `fs_hbom_extract` (§5.2). The skill grounds it hard: *emit only fields you can cite to a page/cell (`source_ref` required); set honest confidence; when two documents disagree, record both — never pick.*
3. **Merge.** The tool validates each cell (zod: field enum, confidence bounds, `source_ref` must resolve into a registered doc) and merges with precedence: **`human` > `datasheet` ≈ `bom_import` (equal rank — disagreement is a conflict) > `schematic` > `as_component` > `inferred`.** A lower-precedence claim against an occupied cell becomes a candidate; an equal-precedence disagreement becomes a conflict; **nothing ever silently overwrites, and `provenance: human` cells are immutable to every non-human writer.** Full rules in §6.4.
4. **Review.** Every merged write lands in the YAML as a **git diff** the human reviews (SPEC 01 §3 — the model gets code review before it's trusted), and every below-threshold or conflicted cell enters the **review queue** (§6.3).
5. **Export.** §3.5.

### 3.5 Export

Two formats, both produced in the **plugin backend** (ordinary Node) and streamed via `bb.http` routes — RPC is JSON-only and neither remote system has an HBOM entity [FD §3e]:

**XLSX (primary), via `exceljs`** — lazy-loaded (SPEC 00 §10 bundle budget). Four sheets [FD §3e]:

1. **`HBOM`** — one row per part, the §3.2 columns. Unreviewed cells get a fill color and an exceljs cell note carrying the provenance line; `n/a` and `—` semantics preserved.
2. **`Provenance`** — the long-form ledger: part / field / value / provenance / source_ref / confidence / by / at. **This sheet is the audit trail and is not optional.**
3. **`Documents`** — ingested docs: filename, kind, sha256, uploaded/analyzed timestamps.
4. **`Summary`** — counts by category, % human-verified, review-queue size at export time, export mode.

Export dialog offers two modes: **Full** (everything, provenance-annotated) and **Verified-only** (cells below the export threshold blanked to `—`; the Summary sheet says how many were withheld). Verified-only is what goes in a certification package; Full is what goes to your own engineers.

**CycloneDX-HBOM JSON (optional, second button)** — each part maps to a CDX `component` (`type: "device"`), `manufacturer`/`supplier` objects, MPN in the standard slot, and `properties[]` name-value pairs for the rest (`fs:hbom:reference_designators`, `fs:hbom:lifecycle_status`, `fs:hbom:country_of_origin`, `fs:hbom:quantity`) plus per-field provenance properties (§6.6). ⚑ **The exact CycloneDX-HBOM (ECMA-424) field schema is unverified [FD §3a] — validate the emitted document against the published schema at build time and adjust the mapping; treat §6.6's property names as ours-namespaced placeholders until then (§9.1).**

---

## 4. Data model

### 4.1 Registry lines (SPEC 01 §2)

```ts
// lib/sync/registry.ts — additions
export const ENTITIES = {
  // …SPEC 02/03 entries…
  sbomComponent: { class: "CACHED",    table: "sbom_components" },
  hbomPart:      { class: "VERSIONED", dir: "product-security/hbom", key: hbomIdKey,
                   server: "none" },   // local-only: no server entity exists yet (§4.5)
  hbomDoc:       { class: "CACHED",    table: "hbom_docs" },       // filtered VIEW over SPEC 05's shared
                                                                   // `document` ledger (⚑12); blobs on disk
} as const;
```

`hbomPart` is VERSIONED — authored domain content, git-tracked, three-way-merged — with the one twist that its push target doesn't exist yet. `server: "none"` makes `plan`/`push` report it as local-only rather than erroring; when the AS `hardware_component` entity lands, the registry line gains real endpoints and the sync engine handles it unchanged — *adding an entity means adding a registry line plus a serializer* (SPEC 01 §2).

### 4.2 SQLite — the SBOM cache (CACHED: read-only, refresh-only, regenerable)

```sql
CREATE TABLE sbom_components (
  pv_id            TEXT NOT NULL,
  project_id       TEXT NOT NULL,
  component_id     TEXT NOT NULL,        -- server id for this version (ephemeral, like finding uuids)
  purl             TEXT,                 -- tier-1 identity; NULL for STP-native components (§7.1)
  name             TEXT NOT NULL,
  grp              TEXT,                 -- namespace/group
  version          TEXT,
  cpe              TEXT,
  license_declared TEXT,
  supplier         TEXT,
  source           TEXT NOT NULL,        -- 'sca' | 'manual'
  is_stale         INTEGER NOT NULL DEFAULT 0,
  pulled_at        TEXT NOT NULL,
  PRIMARY KEY (pv_id, component_id)
);
CREATE INDEX sbom_purl ON sbom_components (project_id, purl);
CREATE INDEX sbom_name ON sbom_components (pv_id, name COLLATE NOCASE, grp COLLATE NOCASE, version);

-- vuln + reachability rollup, recomputed at pull time by joining SPEC 02's findings cache
-- on the componentKey ladder (purl → folded name/group/version). Derived, droppable.
CREATE TABLE sbom_vuln_rollup (
  pv_id         TEXT NOT NULL,
  component_key TEXT NOT NULL,           -- canonical serialization, same as SPEC 02 §4.3
  critical INTEGER NOT NULL DEFAULT 0, high INTEGER NOT NULL DEFAULT 0,
  medium   INTEGER NOT NULL DEFAULT 0, low  INTEGER NOT NULL DEFAULT 0,
  kev_count INTEGER NOT NULL DEFAULT 0,
  max_epss  REAL,
  verdict   TEXT NOT NULL,               -- 'unreachable'|'reachable'|'mixed'|'unknown'
  computed_at TEXT NOT NULL,
  PRIMARY KEY (pv_id, component_key)
);
```

Pull path: `PlatformClient` pages the authoritative version SBOM for software inventory; the optional AS project-SBOM package view uses `AssuranceStudioClient` only where the surface explicitly needs AS linkage. The pull writes rows in one transaction per page, then recomputes `sbom_vuln_rollup` from the findings cache. Cursor in `sync_state` (SPEC 00 §5); progress via realtime. The **componentKey** is SPEC 02 §4.3's ladder verbatim — one identity module (`lib/sync/stable-key.ts`) serves triage, SBOM rows, and HBOM `firmware_link`s.

### 4.3 The HBOM YAML (VERSIONED, git-tracked — the artifact of record)

`product-security/hbom/hbom.yaml` — in `product-security/` with the rest of the model, per SPEC 01 §2's placement convention (this supersedes the `.fs-hbom/` sketch path in [FD §3b]). Documents in the single shared store under `product-security/documents/` (§4.4; SPEC 05 C12, SPEC 06 §2.6 ⚑12).

```yaml
# product-security/hbom/hbom.yaml
schema: fs-hbom/v1
project: acme-router
as_project_id: "3f8a1c2e-…"
options:
  review_threshold: 0.90        # cells below this enter the review queue (§6.1)
  export_threshold: 0.90        # verified-only export blanks cells below this
parts:
  - id: HBOM-0001               # stable plugin id; never reused
    as_component_id: "9d2e…"    # null when the part has no AS counterpart (§7.4)
    part_number:
      value: BCM6755
      provenance: datasheet
      source_ref: "docs/1f9c…-bcm6755-ds.pdf#p1"
      confidence: 0.95
      by: bb-agent
      at: 2026-07-29T14:02:11Z
      accepted: { by: mwyckhouse, at: 2026-07-30T09:11:00Z }
    mpn:
      value: BCM6755KFEBG
      provenance: bom_import
      source_ref: "docs/8a41…-ax3000-bom.xlsx#Sheet1!A14"
      confidence: 0.72
      by: bb-agent
      at: 2026-07-29T14:02:11Z
      candidates:               # competing, unmerged claims — data, not UI state
        - { value: BCM6755KFEB, provenance: datasheet,
            source_ref: "docs/1f9c…-bcm6755-ds.pdf#p7",
            confidence: 0.61, by: bb-agent, at: 2026-07-29T14:02:11Z }
    manufacturer: { value: Broadcom, provenance: datasheet,
                    source_ref: "docs/1f9c…-bcm6755-ds.pdf#p1", confidence: 0.95,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    description:  { value: "Wi-Fi 6 SoC, quad-core ARM", provenance: as_component,
                    confidence: 0.60, by: seed, at: 2026-07-28T10:00:00Z }
    category:     { value: soc, provenance: inferred, confidence: 0.85,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    quantity:     { value: 1, provenance: bom_import,
                    source_ref: "docs/8a41…-ax3000-bom.xlsx#Sheet1!D14", confidence: 0.93,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    reference_designators:
                  { value: [U1], provenance: schematic,
                    source_ref: "docs/77b2…-sch.pdf#p3", confidence: 0.80,
                    by: bb-agent, at: 2026-07-29T14:05:40Z }
    lifecycle_status:
                  { value: active, provenance: datasheet,
                    source_ref: "docs/1f9c…-bcm6755-ds.pdf#p2", confidence: 0.55,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    supplier:     { value: Avnet, provenance: human, confidence: 1.0,
                    by: mwyckhouse, at: 2026-07-30T09:14:00Z }
    country_of_origin: { value: null }          # bare null cell = unknown (renders —)
    compliance_flags:  { value: [RoHS, REACH], provenance: datasheet,
                    source_ref: "docs/1f9c…-bcm6755-ds.pdf#p2", confidence: 0.70,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    fcc_covered_list:  { value: false, provenance: human, confidence: 1.0,
                    by: mwyckhouse, at: 2026-07-30T09:15:00Z,
                    note: "checked against Covered List rev. 2026-07" }
    crypto_relevant:   { value: true, provenance: inferred, confidence: 0.75,
                    by: bb-agent, at: 2026-07-29T14:02:11Z }
    security_relevance:{ value: "root-of-trust host", provenance: as_component,
                    confidence: 0.60, by: seed, at: 2026-07-28T10:00:00Z }
    firmware_link: { value: "acme-router|pkg:generic/broadcom-sdk@5.04", provenance: human,
                    confidence: 1.0, by: mwyckhouse, at: 2026-07-30T09:20:00Z }
    external_refs:
      - { type: datasheet, url: "https://…/bcm6755" }
```

Cell grammar (zod, `shared/contract.ts`):

```ts
const provenance = z.enum(["as_component", "datasheet", "bom_import",
                           "schematic", "inferred", "human", "vendor"]);
const cell = <T extends z.ZodTypeAny>(value: T) => z.object({
  value: value.nullable(),
  provenance: provenance.optional(),         // absent on bare-null (unknown) cells
  source_ref: z.string().optional(),         // required unless provenance ∈ {human, inferred, as_component}
  confidence: z.number().min(0).max(1).optional(),   // human ⇒ 1.0, enforced
  by: z.string().optional(), at: z.string().datetime().optional(),
  note: z.string().optional(),
  accepted: z.object({ by: z.string(), at: z.string().datetime() }).optional(),
  candidates: z.array(candidateCell).optional(),
}).refine(needsSourceRef).refine(humanIsCertain);
```

Two semantics worth calling out: **bare `{value: null}` = unknown** (renders `—`); **`{value: null, provenance: human}` = human-confirmed not-applicable** (renders `n/a`) — an auditor treats those very differently. And `confidence` is **numeric 0–1** (this spec refines [FD §3c]'s `high|medium|low` sketch — the task's own UI copy shows `0.72`, and thresholds need arithmetic); the named bands are derived for display (§6.1).

### 4.4 SQLite — HBOM mirrors (derived, rebuilt by the file watcher, droppable)

Same pattern as SPEC 02's `overlay_index`: YAML is the sole source of truth; SQLite makes it queryable at render speed.

```sql
CREATE TABLE hbom_cells (              -- one row per (part, field) — powers grid + review queue
  part_id    TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT,                     -- JSON-encoded for arrays
  provenance TEXT, source_ref TEXT, confidence REAL, by TEXT, at TEXT,
  state      TEXT NOT NULL,            -- 'solid'|'review'|'conflict'|'unknown'|'na'  (§6.2)
  PRIMARY KEY (part_id, field)
);
CREATE INDEX hbom_review ON hbom_cells (state) WHERE state IN ('review','conflict');

CREATE TABLE hbom_candidates (
  part_id TEXT NOT NULL, field TEXT NOT NULL,
  value TEXT, provenance TEXT, source_ref TEXT, confidence REAL, by TEXT, at TEXT
);

-- hbom_docs — the ingestion ledger, a filtered VIEW over the single shared `document`
-- ledger (SPEC 05 C12.1; SPEC 06 §2.6 ⚑12). One document store, one ledger; the
-- analysis-bookkeeping columns live on `document`.
CREATE VIEW hbom_docs AS
  SELECT id, filename, local_path AS path, sha256, doc_kind,
         size, uploaded_at, analyzed_at, analyzed_by, cells_extracted
  FROM document
  WHERE doc_kind IN ('datasheet', 'bom', 'schematic');
```

All YAML writes — panel edits, `fs_hbom_extract` merges, review resolutions — go through bb's SHA-256 compare-and-swap file API [LFD §6.0], so a panel write and an agent write cannot silently clobber each other. A file watcher on `product-security/hbom/**` rebuilds the mirrors and publishes `fs-hbom-changed`.

### 4.5 Why plugin-local, and what promotes later

**Plugin-local now** because there is nothing to sync *to*: no HBOM entity, table, route, or field exists anywhere in the platform [FD §3a][INV]. Building it plugin-side ships in days, is demoable, and — because the artifact is git-tracked YAML with per-field provenance — loses nothing when the server side arrives.

**Promotes later:** a real AS `hardware_component` entity (schema + routes + UI) makes HBOM multi-user, tenant-scoped, and joinable to the architecture graph server-side — **2–4 weeks of `finite-state-platform` work, then one named `AssuranceStudioClient` operation set** [FD §3f]. The migration is mechanical by construction: cells map to columns plus a provenance side-table; `hbomPart` flips from `server: "none"` to real endpoints; the first `push` is a bulk create; three-way merge takes over. Two smaller platform items ride along: a `datasheet`/`bom` document type and verified direct binary document routes so ingested docs can be retained in AS rather than only in the worktree [FD §3f] (§7.6).

---

## 5. bb integration

### 5.1 Nav panel + subPath routing

```ts
app.slots.navPanel({ id: "bom", title: "Bill of Materials", icon: "PackageSearch",
                     path: "bom", component: BomPanel,
                     headerContent: BomHeaderChips });   // sync chip · review-queue chip
```

| subPath | Screen |
|---|---|
| *(root)* | redirects to `software` |
| `software` | SBOM table, default saved view |
| `software/<componentKey>` | table + component detail pane |
| `software/view/<savedView>` | saved view applied |
| `hardware` | HBOM grid |
| `hardware/p/<hbomId>` | grid + part detail pane |
| `hardware/review` | the review queue (§6.3) |
| `hardware/ingest` | upload + per-document extraction report |

Tab switch is a segmented control in the panel header (Software / Hardware); browser back/forward walks panel history via `useBbNavigate().toPluginPanel("bom", { subPath })`. `componentKey` and stable-key strings are base64url-encoded in routes (same convention SPEC 02 lands in its open question 3 — one encoder, shared).

### 5.2 Agent tools

Per SPEC 00 §8: read tools are free; **write tools mutate local YAML, never the server**; there is no push tool.

```ts
bb.agents.registerTool({
  name: "fs_sbom_query",                 // READ — SQLite cache, never remote
  description: "Query cached SBOM components. Filters: version, name, purl, license, license_group, min_severity, kev, reachability, linked, limit/cursor. Returns components with vuln rollups and known file locations.",
  input: sbomQuerySchema,                // zod; paged { items, total, cursor }
  run: ({ input }) => querySbomCache(db, input),
});

bb.agents.registerTool({
  name: "fs_hbom_extract",               // WRITE — YAML only, via the merge engine
  description: "Submit cells extracted from a registered HBOM document. Every cell must cite a source_ref inside that document and carry an honest confidence. Cells merge under precedence rules; conflicts and low-confidence cells are queued for human review — never silently applied. Never contacts the server.",
  input: z.object({
    docId: z.string(),                   // must exist in hbom_docs — no citing unregistered files
    cells: z.array(z.object({
      part: z.union([hbomId, partIdentity]),   // HBOM-0001, or {mpn}/{ref_des} identity for new parts
      field: hbomField,                        // §3.2 enum
      value: z.unknown(),
      source_ref: z.string(),                  // "docs/<sha>-file.pdf#p7" | "...xlsx#Sheet1!A14"
      confidence: z.number().min(0).max(1),
    })).min(1).max(500),
    createMissingParts: z.boolean().default(false),   // BOM-spreadsheet ingest may add rows (§7.4)
  }),
  run: applyHbomPatch,   // validates → merges (§6.4) → CAS-writes YAML → returns
                         // { merged, queued, conflicts, candidates_added, rejected: [{cell, why}] }
});

bb.agents.registerTool({
  name: "fs_hbom_review",                // READ — the queue, for reporting and re-work
  description: "List the HBOM review queue: cells pending human review, with values, candidates, provenance, and source refs. Agents may resolve entries only by submitting better-evidenced cells via fs_hbom_extract — acceptance is human-only.",
  input: z.object({ state: z.enum(["review", "conflict", "all"]).default("all"),
                    limit: z.number().max(200).default(50) }),
  run: listReviewQueue,
});
```

The boundary that keeps HBOM honest: **`fs_hbom_extract` can propose; only a human can accept** (§6.5). There is no agent path to `accepted`, to `provenance: human`, or to resolving a conflict.

### 5.3 SKILL.md — `skills/bom/SKILL.md` (content outline)

1. **When to use this surface** — anything touching components, licenses, SBOM, parts, MPNs, datasheets, BOMs, HBOM, country of origin, FCC/EO BOM asks.
2. **Two tabs, two postures** — SBOM is read-only cache (query it, cite it, link it); HBOM is authored (you propose cells, humans accept).
3. **The iron rule** — HBOM writes go through `fs_hbom_extract` against a registered document; every cell cites a `source_ref`; confidence is honest, not optimistic; you never edit `hbom.yaml` around the merge engine, and you never resolve review-queue entries yourself.
4. **Extraction craft** — read the doc with native tools; prefer tables over prose; a part number in running text is a *candidate*, not a value; when a datasheet and a BOM disagree, submit both and say so; image-only PDFs: stop and tell the human OCR is needed (§7.5).
5. **Identity** — SBOM components key on the componentKey ladder (purl first); HBOM parts key on `HBOM-nnnn`; match new BOM rows by MPN, then ref-des, before creating parts.
6. **Show, don't tell** — `::fs-component{purl="…"}` when discussing a component; `::fs-component{part="HBOM-0001"}` for parts; `::fs-hbom-summary` after an extraction run; `#busybox` / `#BCM6755` mentions resolve to live context.
7. **Review etiquette** — after an extraction: summarize merged/queued/conflicts, point the human at the diff and `hardware/review`, and stop. Never describe extracted values as confirmed.

### 5.4 Directives + mention provider

- **`::fs-component{purl="pkg:generic/busybox@1.36.1"}`** — mounts `<ComponentCard>`: identity, license, vuln histogram, reachability verdict, file count, link row. **`::fs-component{part="HBOM-0001"}`** — same directive, HBOM mode: part card with provenance-styled cells. Self-fetches by id via RPC (attributes are untrusted strings — fetch by id, never render attribute payloads; SPEC 02 §6.4 rule). Click-through to the matching subPath.
- **`::fs-hbom-summary`** — the trust dashboard inline: parts count, completeness %, % human-verified, review-queue size, top missing fields; buttons *Open HBOM* / *Open review queue*. Emitted by the agent after extraction runs; also useful in status threads. Fetches live from `hbom_cells`, so it stays current after the human edits.
- **Mentions** — this surface's corpus registers into the single consolidated `#` provider **`fs-intel`** (registered in SPEC 02 §6.5; SPEC 06 §2.3/§2.6 ⚑3 — one registration on `#`, routing internally by pattern, one dedup point): the SBOM cache (name, purl) and HBOM mirrors (MPN, part number, ref-des) join the CVE/GHSA corpus in one ranked search. `#BCM6755` resolves at send time to the part's current cells + provenance summary; `#busybox@1.36.1` to the component row + vuln rollup. Same `<2s`, cache-only search contract as SPEC 02 §6.5.
- Both directives degrade to literal text on a cold cache (show the id + "pull to load"), per the host contract.

### 5.5 CLI verbs

Under the single SPEC 00 command; `--json` everywhere; agents discover via the auto-generated plugin-commands skill:

```
bb finite-state bom
  pull [--version <v>]                     # refresh SBOM cache + vuln rollups
  sbom list [--filter …] [--json]          # CLI twin of fs_sbom_query
  sbom export --format cyclonedx|spdx [--include-vex] [-o file]
  hbom seed                                # §3.3 — idempotent
  hbom ingest <file> [--kind datasheet|bom|schematic] [--extract]
  hbom status                              # completeness, review-queue counts, doc ledger
  hbom review [--json]                     # list queue; resolution is interactive/panel
  hbom accept <part> <field> [--candidate n]     # validate + open review panel; never resolves
  hbom reject <part> <field>                     # validate + open review panel; never resolves
  hbom export --xlsx|--cdx [--verified-only] [-o file]
```

The `accept` and `reject` spellings are agent-discoverable, **non-mutating review-panel handoffs**. They validate and locate the queue item, print/open `hardware/review`, and stop; they never write `accepted`, set human provenance, or invoke the review-resolution service. Only an authenticated human interaction in the panel can resolve a queue item.

### 5.6 `bb.http` routes (binary I/O — everything RPC can't do)

```ts
// server.ts — auth: "local" on all routes
bb.http.route("POST", "hbom/docs", uploadDoc);            // multipart; sha256-dedup; ledger row;
                                                          // publishes fs-hbom-docs-changed
bb.http.route("GET",  "hbom/docs/:id", serveDoc);         // streams the blob for the viewer popover
bb.http.route("GET",  "hbom/export.xlsx", exportXlsx);    // exceljs, streamed, correct content-type
bb.http.route("GET",  "hbom/export.cdx.json", exportCdx);
bb.http.route("GET",  "sbom/export", exportSbom);         // ?format=cyclonedx|spdx&includeVex= —
                                                          // proxies the fs-api export, streams through
```

Upload validation: extension/MIME allowlist (pdf, xlsx, csv, txt netlists), size cap (default 50MB, matching the AS documents convention [INV §1d]), sha256 computed server-side; a re-upload of the same bytes is a no-op that returns the existing doc id.

### 5.7 fileOpener registration

```ts
app.slots.fileOpener({ id: "fs-hbom-doc",
  match: (f) => isUnder(f, "product-security/documents/") ||
                (isBomSpreadsheet(f) || isDatasheetPdf(f)),   // heuristic outside the docs dir
  component: HbomDocOpener });
```

Clicking a datasheet or BOM spreadsheet in the file tree opens the SPEC 05 document viewer with an HBOM action bar: **Register as HBOM document** (if not in the ledger) and **Extract with agent** (spawns a thread pre-loaded with the doc + the skill). For spreadsheets, the opener renders a sheet preview with the extraction's `source_ref` cells highlighted after a run — the human can see exactly which cells the agent read.

### 5.8 Realtime

Per SPEC 00 §5 — hints to refetch, never data channels: `fs-bom-pull` (`{pvId, page, of, phase}`), `fs-hbom-changed` (file watcher — grid and review queue refetch; this is how agent extractions appear live), `fs-hbom-docs-changed`, `fs-hbom-extract-progress` (`{docId, cells, of}` during long extractions).

---

## 6. The provenance & confidence UX, in depth

This is where the surface earns trust. The design principle, stated once and enforced everywhere: **an agent's extraction is a proposal until a human accepts it or its evidence clears the bar — and the UI must make the difference impossible to miss.**

### 6.1 Confidence: numbers, bands, thresholds

Confidence is a 0–1 float set by the extractor per cell. Display bands (derived, not stored):

| Band | Range | Rendering | Queued? |
|---|---|---|---|
| **Verified** | `provenance: human`, or `accepted` set | solid text | no |
| **High** | ≥ 0.90 | solid text, provenance hover available | no |
| **Medium** | 0.60 – 0.89 | **dashed underline, muted foreground** | yes |
| **Low** | < 0.60 | ghosted value + review chip | yes |
| **Conflict** | any, with equal-precedence disagreement | value shown with ⚠, both claims in hover | yes, always |

Thresholds live in the YAML `options:` block (`review_threshold`, `export_threshold`; defaults 0.90) so they're project policy under git review, not a hidden setting. Rules: `human` provenance ⇒ confidence 1.0 (enforced by the zod refinement); acceptance does **not** rewrite confidence — it records `accepted: {by, at}` on top, so the export ledger preserves both "the extractor was 72% sure" and "a human signed off." Styling uses bb token classes only (`text-muted-foreground`, `decoration-dashed`) per SPEC 00 §7 — never color alone; the dashed underline is the signal, and a colorblind-safe review chip backs it.

### 6.2 The hover contract

Every non-human cell answers "how do you know?" in one hover:

```
MPN from ax3000-bom.xlsx (Sheet1!A14)
confidence 0.72 · extracted by agent · 2026-07-29
1 competing claim: BCM6755KFEB from bcm6755-ds.pdf p.7 (0.61)
[Open source] [Review]
```

*Open source* deep-links into the SPEC 05 viewer at the page (PDF `#p7`) or the sheet preview at the cell (`#Sheet1!A14`), with the region highlighted. *Review* jumps to the queue entry. Human cells hover to `by / at / note`. Seeded cells hover to the AS component link. **A cell with no hover story doesn't exist** — the merge engine rejects cells that can't cite themselves (§6.4).

### 6.3 The review queue (`hardware/review`)

One list, keyboard-driven like SPEC 02's triage (it *is* triage, for facts):

- **Row** = one cell decision: part · field · proposed value (provenance-styled) · candidates side by side · source snippets inline (the viewer excerpt, not just a link) · reason chip (`low confidence` / `conflict` / `incomplete`).
- **Actions:** `a` accept (records `accepted`, clears from queue) · `1–9` accept candidate *n* (candidate becomes the cell; loser demotes to candidate) · `e` edit (type the correct value ⇒ `provenance: human`, confidence 1.0) · `r` reject (value demotes to candidate; cell reverts to prior value or unknown) · `Enter` open source document · `j/k` navigate.
- **Bulk accept/reject:** filter the queue (by document, by field, by confidence ≥ n, by provenance), select-all-matching (predicate selection, SPEC 02 §3.4 pattern), then one action. The confirm bar states the blast radius: *"Accept 41 cells from ax3000-bom.xlsx (min confidence 0.83)?"* Bulk accept is how a good BOM-spreadsheet ingest becomes a 30-second review instead of 41 clicks; per-document bulk is the deliberate unit because trust attaches to sources.
- Every resolution is a YAML edit → a git diff → visible in `bb finite-state status`. Review decisions are themselves reviewable.

### 6.4 The merge engine (the rules, exhaustively)

Precedence: **`human` > `datasheet` = `bom_import` > `schematic` > `as_component` > `inferred`** (`vendor` slots at datasheet rank when vendor-attested docs arrive). On `fs_hbom_extract`:

1. **Validate** every cell: field in schema, value type-checks, `source_ref` resolves into the named registered doc, confidence in bounds. Invalid cells are rejected item-wise (`rejected[{cell, why}]`) — partial success, SPEC 00 style.
2. **Target empty** → cell written; queued if below `review_threshold`.
3. **Target lower precedence** → new cell takes the slot; old value demotes to a candidate (history is data, nothing deleted).
4. **Target equal precedence, same value** → merge into one cell, keep the higher confidence, both source_refs retained in candidates as corroboration.
5. **Target equal precedence, different value** → **conflict**: incumbent keeps the slot, challenger becomes a candidate, cell state ⇒ `conflict`, queued unconditionally.
6. **Target higher precedence** → challenger lands as candidate only. **A `human` cell is immutable to every non-human writer, at any confidence — no exceptions.**
7. **Same source re-extraction** (same doc sha, same field) → replaces its own prior claim in place; idempotent by `(doc, part, field)`.
8. Every write is CAS (§4.4) and lands in the working tree as a diff. **There is no code path that silently overwrites a value a human can see.**

### 6.5 Proposal, not fact — the presentation rules

- Agent-written cells render in the proposal style (dashed/muted) until accepted or ≥ threshold — in the grid, in the part detail, in `::fs-component` cards, everywhere the domain component renders (one component, self-fetching, per SPEC 00 §7 — so the styling cannot drift between surfaces).
- The agent's own report is constrained by the skill: it says *"proposed 34 cells (28 high-confidence), 6 queued for your review"* — never "the MPN is X" about an unaccepted cell.
- `::fs-hbom-summary` leads with the trust metrics (% human-verified, queue depth), not the completeness vanity number.
- The `hardware` tab header shows the review chip whenever the queue is non-empty. An HBOM with 200 unreviewed cells *looks* like one.

### 6.6 Provenance survives into the exports

The chain of custody doesn't stop at the export button:

- **XLSX:** the `Provenance` sheet is the full per-cell ledger (§3.5); unreviewed cells on the `HBOM` sheet carry a fill + an exceljs cell note with the provenance line; the `Summary` sheet records export mode, thresholds, and withheld-cell count. A recipient can audit any value back to a document and a page without access to our tooling.
- **CycloneDX:** per-field `properties[]` triples — `fs:hbom:<field>:provenance`, `:source`, `:confidence` — alongside the value mapping, plus document-level `fs:hbom:verified_ratio` and `fs:hbom:review_pending`. ⚑ Namespaced as ours until the ECMA-424 HBOM property conventions are verified (§9.1).
- **Verified-only mode** is the certification posture: below-threshold values are withheld (blank, not guessed), and the export says so. We never let a 0.55-confidence country-of-origin masquerade as a fact in a signed filing.

---

## 7. Edge cases

**7.1 Components with no purl.** STP-native and vendor-format components may carry no purl [LFD §1.3]. The componentKey ladder degrades to `(name, group, version)` exactly as SPEC 02 §4.3 does; the row shows a `no purl` badge; CycloneDX export emits the component without a `purl` field (valid) rather than fabricating one. Vuln rollup joins still work — the findings cache carries the same name/group/version columns.

**7.2 Duplicate / conflicting extractions across documents.** Two BOMs for adjacent board revs, a datasheet superseded by an errata sheet. Handled by construction: same-source re-runs replace themselves (§6.4.7), cross-source disagreements are conflicts with both claims preserved, and the review queue's per-document filter lets a human retire a whole document's claims at once (bulk reject filtered to that doc). A document can also be **withdrawn** in the ledger — its unaccepted cells demote to candidates; its accepted cells stay (acceptance is the human's, not the document's) but get a `source withdrawn` chip in hover.

**7.3 Very large SBOMs.** 10k+ components: virtualization + paged RPC handles rendering (SPEC 00 perf budget); pull streams in per-page transactions; the vuln rollup is one SQL pass over the findings cache, not N queries; FTS5 if name search degrades (§2.2). Export streams from the server through `bb.http` — never buffered through RPC or the renderer.

**7.4 HBOM parts not in AS.** A BOM spreadsheet lists 200 passives; AS architecture models 12 logical hardware components. Expected, fine: `createMissingParts` ingests them with `as_component_id: null`. The grid's AS-link column filters "modeled / unmodeled"; a part-detail action **"Create architecture component"** writes a VERSIONED component YAML stub (SPEC 03) so a security-relevant part (an HSM discovered in the BOM) can be pulled into the threat model — through the normal plan/push gate, not a side door. The inverse (`as_missing: true`, §3.3) marks parts whose AS seed vanished.

**7.5 Image-only PDFs.** Scanned datasheets defeat text extraction. The skill instructs the agent to detect this and stop — a hallucinated MPN from a bitmap is the exact failure mode this surface exists to prevent. The doc ledger marks the file `needs_ocr`; bundling an OCR step is deferred and unverified in bb's tooling [FD §3g].

**7.6 Losing the docs.** v1 stores documents in the worktree only; a lost clone loses the evidence behind `source_ref`s (the cells and their provenance records survive in git). Mitigations now: docs are git-tracked by default with a >25MB warning; content-addressing makes re-upload heal all references (same sha ⇒ same refs). Real fix: add named direct AS binary upload/download methods once the route and signed-upload flow are verified [FD §3g] (§4.5).

**7.7 Export fidelity.** XLSX: reference-designator lists join to `"R14, R15"` with the array preserved in the Provenance sheet; cell notes cap at Excel limits (truncate with ellipsis, full text in Provenance); `n/a` vs `—` semantics carried as literal strings plus a legend on the Summary sheet. CycloneDX: our property-based fields round-trip through conformant tools untouched (properties are pass-through by spec); anything we can't express in verified CDX fields goes in properties rather than being dropped silently. SPDX (SBOM): the platform's export is authoritative; we stream it unmodified.

**7.8 SBOM staleness.** A re-scan replaces the version's component set server-side; `is_stale` rows and a `pulled_at` older than the version's latest scan trigger the stale banner (SPEC 00 §7 error posture) with one-click re-pull. HBOM has no server to go stale against — its freshness signal is the review queue and the doc ledger dates.

**7.9 Multi-board products.** One `hbom.yaml` currently models one board. Rev-B boards and multi-PCB products need either a `board` field or per-board files. Deferred until a real product shape demands it (mirrors SPEC 02's multi-version-overlay deferral) — the schema reserves `board_rev` as an optional part field so the migration is additive. ⚑ §9.6.

---

## 8. Build plan

Phase 4 of the SPEC 00 sequence. Assumes the Phase-1 skeleton, the SPEC 01 engine, and SPEC 02's findings cache (the vuln rollup joins it). Estimates for one strong engineer; front-end shapes per [UX §6] (SBOM panel 3–4d, HBOM 4–5d FE) folded into the phases below; totals consistent with [FD] (SBOM data plane + HBOM ≈ 10–14 d plugin-side).

| Phase | Deliverable | Contents | Effort |
|---|---|---|---|
| **4a — SBOM read** | The fast table | `sbom_components` cache + pull + `sbom_vuln_rollup`; virtualized table, filters, saved views, search; row expansion (findings-cache join); detail pane with file locations (findings-derived v1) + `.fs/links` referenced-by rows (behind SPEC 03/05 readiness flags); four states; `bom pull` / `sbom list` CLI | **4–5 d** |
| **4b — SBOM agentic + export** | The hub wired up | `fs_sbom_query`; `::fs-component` (purl mode) + the SBOM/HBOM corpus in the shared `fs-intel` `#` mentions; `sbom export` via `bb.http` proxy; SKILL.md §1–2, 6 | **2–3 d** |
| **4c — HBOM core** | Schema, seed, grid | `fs-hbom/v1` zod schema + serializer + registry line; seed from AS components (idempotent); grid with provenance-styled cells + hover popovers; `hbom_cells`/`hbom_candidates` mirrors + file watcher; part detail; `hbom seed`/`status` CLI | **4–5 d** |
| **4d — Ingestion + review** | The trust machinery | upload route + doc ledger + fileOpener; `fs_hbom_extract` + the §6.4 merge engine (unit-tested against a conflict-matrix fixture); review queue UI + keyboard + bulk accept/reject; `fs_hbom_review`; `::fs-hbom-summary`; SKILL.md complete; `hbom ingest/review/accept/reject` CLI | **4–5 d** |
| **4e — Exports + hardening** | The deliverables | exceljs XLSX (4 sheets, verified-only mode, lazy-loaded); CDX-HBOM JSON + schema validation against ECMA-424 (closes §9.1); edge-case fixtures (no-purl, conflicting docs, 10k SBOM perf pass, withdrawn doc); scripted demo: *upload BOM → agent extracts → review queue → accept → export XLSX with provenance* | **3–4 d** |
| **Total** | | | **~3.5–4.5 weeks** plugin-side |

Demoable milestones: end of 4a — the SBOM table (already faster and better-joined than the web UI); end of 4c — a seeded, provenance-styled HBOM; end of 4d — **the flagship HBOM beat**: *the agent read your datasheet, proposed 34 fields with citations, and here's the queue where you accept them*; end of 4e — the signed-artifact story for the FCC/EO conversation.

Definition of done per SPEC 00 §12, including the offline warm-cache demo path.

---

## 9. Open questions

1. **CycloneDX-HBOM exact field schema** — verified only that the capability and component/supplier/properties model exist; the precise ECMA-424 field names and any emerging HBOM property conventions were not re-derived [FD §3a]. Validate emitted documents against the published schema in 4e; adjust the §3.5/§6.6 mapping; keep `fs:hbom:*` properties for anything without a standard slot.
2. **Regulatory citations** — confirm the FCC FNPRM paragraph numbers (DA 26-786 / FCC 26-50) and EO 14415 §3 language against primary sources before any customer-facing compliance claim. Product design is unaffected either way.
3. **AS SBOM cache vs Platform API as pull source** — default to direct Platform data for freshness; use the AS-side cache only for an AS-specific join whose handler contract is verified. The cache schema is source-agnostic.
4. **Component→file evidence operation** — v1 derives file locations from cached finding `location`s; add a named `PlatformClient` method only after the true unpack mapping route is present in the reviewed API inventory.
5. **Confidence calibration** — extractor confidences are self-reported by the agent. After real usage, sample accepted-vs-rejected rates per band and tune `review_threshold` defaults; consider per-provenance floors (e.g. `inferred` caps at 0.7).
6. **Multi-board / board-rev modeling** (§7.9) — one file vs per-board files; decide when a real product forces it.
7. **HBOM board view** — an SVG board/placement visualization (ref-des → position) was floated in the Build Guide and is deliberately out of scope here [FD §3g]; revisit post-demo if the grid + review queue prove insufficient for the story.

---

## Amendments applied by later specs

- **SPEC 07 §7.1 — `kicad_bom` becomes the top provenance tier.** The cell model gains provenance `kicad_bom` at confidence 1.0: *asserted by the design, not inferred*. `source_ref` is the schematic path plus the reference designator, so every HBOM value can name the exact symbol on the exact sheet it came from. The HBOM stops being assembled and starts being derived, with the design as its citation. Ingest lands in WP-78; WP-44/45 must treat the provenance vocabulary as open to these values.
- **SPEC 08 §4.2.1 — structured vendor provenance.** `svd` / `dfp` / `devicetree` join at confidence 1.0 (declared by the vendor in machine-readable form) and `re_corpus` at 0.85 (observed in shipped firmware). Full ladder: `svd`/`dfp`/`devicetree` 1.0 · `kicad_bom` 1.0 · `human` 1.0 · `as_seed` 0.9 · `re_corpus` 0.85 · `document` ~0.72.
