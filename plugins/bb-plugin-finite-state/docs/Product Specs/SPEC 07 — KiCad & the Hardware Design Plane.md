# SPEC 07 — KiCad & the Hardware Design Plane

_Product spec. Depends on SPEC 00 (conventions), SPEC 04 (HBOM), SPEC 05 (mount pattern). Amends SPEC 03 (verification matrix) and SPEC 04 (provenance tiers). This is the surface that brings the hardware design into the workspace — and it is the piece that makes "one workspace" true for a physical product rather than just its firmware._

**Spec set:** 00 Foundation · 01 Sync Engine · 02 Findings & VEX Triage · 03 Product Security · 04 Bill of Materials · 05 Firmware, Bench & Documents · 06 Agentic Surfaces · **07 KiCad & the Hardware Design Plane (this)**

---

## 1. The job to be done

Today a hardware engineer's design lives in KiCad, the firmware lives in a repo, the bill of materials lives in a spreadsheet someone maintains by hand, and the compliance evidence gets assembled under deadline by a person reading all three. Nothing knows about anything else. Ask "which parts on this board have known vulnerabilities in their vendor SDK" and the honest answer is a week of work by someone senior.

On this surface, the KiCad project sits in the same worktree as the firmware source and the security model. The agent reads a schematic the way it reads code. The HBOM is not assembled — it is **read off the board**, with the schematic as its citation. And clicking a part on the schematic reaches its bill-of-materials row, the firmware that drives it, the CVEs against its SDK, and the threat-model node it belongs to.

**The product claim in one sentence:** _the reference designator is a join key, and once the design is in the workspace, everything else is already connected._

**Who it's for.** The hardware engineer who wants their design to stop being an island. The firmware engineer who needs to know what's actually on the board. The compliance lead who currently builds the HBOM by hand. And the agent, which cannot reason about a product it can only see half of.

---

## 2. The architectural position

**KiCad remains the editor. We are not building a PCB tool.**

This is the decision that keeps the surface tractable. KiCad is a mature native C++ application; reimplementing any part of it is a category error, and embedding its window in Electron is fragile in exactly the way live demos punish. Instead:

```
KiCad (the editor)          ──►  files in the worktree  ──►  bb (context, agents, derived artifacts)
  .kicad_sch / .kicad_pcb        plain-text S-expressions      viewers · HBOM · verification · linking
```

**Three data treatments, consistent with the four-class model (SPEC 01 §2):**

| What                                                               | Treatment                                        | Where it lives                              |
| ------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------- |
| The KiCad project                                                  | **Source.** Not ours, not synced, not classified | The worktree, git-tracked by the user       |
| Rendered and extracted artifacts (SVG, GLB, BOM, netlist, DRC/ERC) | **CACHED** — regenerable, gitignored             | `.fs-hw/<project-hash>/`, indexed in SQLite |
| What flows onward into the HBOM                                    | **VERSIONED / OVERLAY** via SPEC 04              | `product-security/hbom/hbom.yaml`           |

The design itself never becomes our data. We read it, derive from it, and cite it.

**A note on visibility.** bb's workspace file handling is gitignore-driven. A committed KiCad project is visible to search and to the agent's native tools with no work at all. An untracked or ignored one needs `.worktreeinclude` — the same consideration as the firmware mount (SPEC 05 A2).

---

## 3. The surface — one nav panel, three tabs

Nav panel `hardware`, with subPath routing per SPEC 00 §7.

### Tab 1 — Schematics (`/hardware/schematics`)

**Layout.** Sheet navigator on the left (hierarchical tree, since multi-sheet designs export one file per sheet), canvas on the right, inspector on demand.

**The canvas is a `@xyflow/react` viewport.** This is deliberate and it is not merely a convenience. React Flow is already a declared dependency for the TARA canvas (SPEC 03), so pan, zoom, fit-to-view, minimap, and selection come free — but more importantly, **the Schematics tab then shares an interaction idiom with the threat-model canvas.** One canvas that behaves one way, across the product.

**The render.** The schematic SVG mounts inside a custom node. SVG rather than PDF or PNG for three reasons: it's vector so zoom is lossless, it's text so it diffs, and — the one that matters — **it's a DOM, so things can be placed on top of it and hit-tested.**

**The semantic overlay.** KiCad's SVG export is graphics: paths and text, no component identity. So identity comes from the schematic file instead, which carries everything needed:

- every symbol instance's `(at X Y angle)`, `Reference`, `Value`, `Footprint`, and custom fields
- a `(lib_symbols …)` block embedded in the `.kicad_sch` itself (KiCad 6+), so symbol geometry is local — the library is not required
- the page size, which together with the SVG `viewBox` yields the coordinate transform

Transparent hit-targets are positioned over the render from that transform. The result is a schematic where hovering a part shows a card and clicking it selects it — without anyone having written a schematic renderer.

**Interactions.**

| Action       | Behavior                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Hover a part | Card: reference, value, footprint, HBOM confidence, open CVE count                      |
| Click a part | Selects it; inspector opens; the part enters agent context                              |
| Click a net  | Highlights the net across the sheet; lists connected parts                              |
| `⌘F`         | Search by reference, value, or footprint — **against parsed semantics, not SVG glyphs** |
| Select + `→` | Jump to the linked surface (BOM row, findings, firmware, threat node)                   |
| Sheet tree   | Navigate hierarchy; breadcrumb shows the sheet path                                     |

**States.** Loading (skeleton sheet list) · empty ("No KiCad project in this workspace" with the `.worktreeinclude` hint) · error (export failed, with the `kicad-cli` stderr) · lane-unavailable (KiCad not installed — an actionable hardware advisory). Per FS-158, missing KiCad keeps the plugin running; plugin-global `bb.status.needsConfiguration` is reserved for missing required credentials.

### Tab 2 — Board (`/hardware/board`)

**The 3D view.** A GLB exported from the board file, rendered in the panel. `<model-viewer>` is the default: it takes a GLB URL and renders it, with no React-reconciler entanglement. `@react-three/fiber` v9 + `drei` is the upgrade path when scene control is actually needed — noting that R3F bundles the React reconciler and is compatible with React 19.0–19.2, with 19.2's internal reconciler bump _not_ backward compatible with 19.1. **Pin deliberately or avoid.**

**The 2D view.** Board SVG with the same overlay technique as the schematic, driven by footprint positions from `.kicad_pcb`. Layer toggles. Same selection model, so a part selected on the schematic stays selected here.

**Stackup and design rules** read from `.kicad_pro` and `.kicad_dru`, displayed as a reference card — this is where "what are the isolation requirements on this board" gets answered.

### Tab 3 — Fabrication & Checks (`/hardware/fab`)

The outputs that prove the loop reaches manufacturing, and the checks that make it trustworthy:

- **Gerbers and drill files** — generated, listed, downloadable through `bb.http`
- **BOM** — the extract, shown as the HBOM's source with a link into SPEC 04's cell view
- **Netlist** — the connectivity graph, browsable and searchable
- **DRC / ERC results** — parsed from `--format json`, rendered as a violations list with severity, rule, and location; clicking one selects the offending part or net on the canvas

**DRC and ERC are verification results, not just reports.** See §6.

---

## 4. Extraction — how artifacts are produced

`kicad-cli` ships with KiCad 7+ and runs **headless with no GUI instance**, which is what makes this viable as a background job rather than an integration.

```bash
kicad-cli sch export svg     --output <cache>/sheets/ --no-background-color --exclude-drawing-sheet  <sch>
kicad-cli sch export bom     --output <cache>/bom.csv      <sch>
kicad-cli sch export netlist --output <cache>/board.net    <sch>
kicad-cli sch erc  --format json --output <cache>/erc.json <sch>
kicad-cli pcb export glb     --output <cache>/board.glb    <pcb>
kicad-cli pcb export svg     --output <cache>/board.svg    <pcb>
kicad-cli pcb export gerbers --output <cache>/gerbers/     <pcb>
kicad-cli pcb export drill   --output <cache>/drill/       <pcb>
kicad-cli pcb drc  --format json --output <cache>/drc.json <pcb>
```

**Cache discipline, mirroring the firmware mount.** Artifacts are content-addressed by the hash of their source file. Re-export only on change. The cache is gitignored. Provenance — source path, source hash, `kicad-cli` version, export timestamp — is recorded per artifact so every derived value can name where it came from.

**Semantics come from parsing, not from the exports.** `kicadts` (`parseKicadSch`, `parseKicadPcb`, `parseKicadMod`) provides the symbol table, net list, and geometry that the overlay and the search depend on. The exports provide pixels and fab outputs; the parser provides meaning. Keeping those two jobs separate is what stops this from becoming a rendering project.

**One shortcut worth taking, and one worth refusing.** Take: fixed-radius hit targets at symbol origins rather than true bounding boxes — rotation, mirroring, and pin extents cost a day and buy very little. Refuse: writing a schematic renderer. Let `kicad-cli` draw.

---

## 5. Data model

```sql
-- The KiCad project as discovered in the worktree
CREATE TABLE hw_project (
  project_key   TEXT PRIMARY KEY,       -- relative path of the .kicad_pro
  name          TEXT NOT NULL,
  sch_path      TEXT NOT NULL,
  pcb_path      TEXT,
  sch_hash      TEXT NOT NULL,
  pcb_hash      TEXT,
  kicad_version TEXT,                   -- as reported by the file, for compat gating
  discovered_at TEXT NOT NULL
);

-- Derived artifacts, content-addressed and regenerable
CREATE TABLE hw_artifact (
  project_key  TEXT NOT NULL,
  kind         TEXT NOT NULL,           -- sheet_svg|board_svg|glb|bom|netlist|gerber|drill|drc|erc
  sheet_path   TEXT,                    -- null except for sheet_svg
  path         TEXT NOT NULL,
  source_hash  TEXT NOT NULL,           -- the .kicad_sch/.kicad_pcb hash it was made from
  cli_version  TEXT,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (project_key, kind, sheet_path)
);

-- The symbol table — parsed, not exported. Drives overlay, search, and linking.
CREATE TABLE hw_symbol (
  project_key TEXT NOT NULL,
  sheet_path  TEXT NOT NULL,
  reference   TEXT NOT NULL,            -- U3, R12 — THE JOIN KEY
  value       TEXT,
  footprint   TEXT,
  mpn         TEXT,                     -- from a custom field when present
  manufacturer TEXT,
  at_x        REAL NOT NULL,
  at_y        REAL NOT NULL,
  angle       REAL,
  unit        INTEGER,
  fields      TEXT,                     -- JSON, all remaining custom fields
  PRIMARY KEY (project_key, sheet_path, reference, unit)
);
CREATE INDEX ix_hw_symbol_ref ON hw_symbol (reference);
CREATE INDEX ix_hw_symbol_mpn ON hw_symbol (mpn);

-- Connectivity
CREATE TABLE hw_net (
  project_key TEXT NOT NULL,
  net_name    TEXT NOT NULL,
  nodes       TEXT NOT NULL,            -- JSON [{reference, pin}]
  PRIMARY KEY (project_key, net_name)
);

-- DRC/ERC violations, surfaced as verification results (see §6)
CREATE TABLE hw_violation (
  id          INTEGER PRIMARY KEY,
  project_key TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- drc | erc
  severity    TEXT NOT NULL,            -- error | warning | exclusion
  rule        TEXT NOT NULL,
  description TEXT,
  refs        TEXT,                     -- JSON of affected references/nets
  at_x        REAL,
  at_y        REAL,
  run_at      TEXT NOT NULL
);
```

All of it is **CACHED** — every row is rebuildable from the KiCad files by a single re-extract. Nothing here is authored, so nothing here is versioned. If a value in this schema starts looking like a human decision, it belongs in the HBOM YAML instead.

---

## 6. Cross-surface linking — the reason this exists

The reference designator joins the hardware design to surfaces that are already built.

| From a part on the schematic | To                                      | Via                                 | Spec    |
| ---------------------------- | --------------------------------------- | ----------------------------------- | ------- |
| `U3`                         | Its HBOM row and provenance cells       | `reference` → `part_key`            | SPEC 04 |
| `U3`                         | SBOM entries for its SDK / driver stack | MPN or vendor mapping               | SPEC 04 |
| `U3`                         | Open CVEs against those components      | findings cache                      | SPEC 02 |
| `U3`                         | Firmware source that drives it          | worktree grep on symbol/driver name | SPEC 05 |
| `U3`                         | The threat-model node it belongs to     | architecture component mapping      | SPEC 03 |
| `U3`                         | Requirements that constrain it          | EARS traceability                   | SPEC 03 |

Links are stored as an explicit, reviewable mapping rather than inferred at read time, because inference that silently guesses wrong is worse than a gap:

```yaml
# product-security/links/hardware.yaml   (VERSIONED — reviewable as a diff)
version: 1
links:
  - reference: U3
    mpn: STM32H753ZIT6
    hbom_part: PART-014
    sbom_components: [pkg:generic/stm32-hal@1.11.0]
    threat_node: COMP-mcu
    firmware_paths: [src/drivers/stm32/]
    confidence: 1.0
    by: human # or: agent — proposals require acceptance
```

**The demo beat:** click the MCU on the schematic and see its HBOM row with provenance, the firmware that drives it, the CVEs against its SDK, and the threat-model node it sits in — one click, one workspace.

That claim requires the hardware design, the software bill of materials, the vulnerability data, and the threat model to be in the same place at the same time. Most tools have one or two.

---

## 7. Two amendments to existing specs

This surface changes two things elsewhere. Both are small; both are load-bearing.

### 7.1 SPEC 04 §4.3 — `kicad_bom` becomes the top provenance tier

The HBOM cell model already carries `{value, provenance, source_ref, confidence}`. KiCad adds the highest-quality source available:

| Source                           | Provenance      | Confidence | What it means                            |
| -------------------------------- | --------------- | ---------- | ---------------------------------------- |
| **KiCad BOM / schematic fields** | **`kicad_bom`** | **1.0**    | **Asserted by the design. Not inferred** |
| Human entry                      | `human`         | 1.0        | Someone typed it                         |
| AS architecture seed             | `as_seed`       | 0.9        | Modeled, but shallow                     |
| Document extraction              | `document`      | ~0.72      | An agent read a PDF and proposed it      |

`source_ref` is the schematic path plus the reference designator — so every HBOM value can name the exact symbol on the exact sheet it came from.

**The consequence worth stating plainly:** the HBOM stops being assembled and starts being _derived_, with the design as its citation. That is the difference between a compliance artifact produced under duress and one that falls out of the work.

### 7.2 SPEC 03 §4 — a `hardware` column in the verification matrix

DRC and ERC are verification, not reporting. The requirement × tier matrix gains a `hardware` column alongside `static`, `emulation`, `hil`, and `manual`. A requirement like _"the isolation barrier SHALL maintain 8mm creepage"_ is verified by a DRC rule, and its result belongs in the same matrix as a firmware test — because the question the matrix answers is "what's unproven," and that question does not care which discipline the proof came from.

`hw_violation` rows map into `verification_results` keyed by requirement, exactly as bench results do.

---

## 8. bb integration

### Panel and routing

`app.slots.navPanel({ id: "hardware", … })` with subPaths `schematics` · `board` · `fab`. Selection state is shared across tabs — a part selected on the schematic stays selected on the board.

### Agent tools

| Tool               | Class      | Behavior                                                                                       |
| ------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `fs_hw_query`      | read       | Query symbols, nets, violations. Returns **summaries with references, not dumps** (SPEC 06 §4) |
| `fs_hw_part`       | read       | Everything known about one reference designator, across all linked surfaces                    |
| `fs_hw_link_write` | write      | Proposes entries in `links/hardware.yaml`. **YAML only**                                       |
| `fs_hw_extract`    | **action** | Runs `kicad-cli` to regenerate artifacts. **A fourth server-touching-class tool — see below**  |

**On `fs_hw_extract` and the allowlist.** SPEC 06 §5.3 enumerates three ACTION-class tools and requires an `AMENDMENTS.md` entry to add a fourth. This is that fourth. The justification: it invokes a **local subprocess**, not a server mutation — it is closer to `fs_firmware_materialize` than to anything that writes to Assurance Studio. It changes no model state, and everything it produces is regenerable. **It must still be added to the compile-time allowlist explicitly**, because the guard's value is that nobody adds a fifth by accident.

### Directives

| Directive                             | Renders                                |
| ------------------------------------- | -------------------------------------- |
| `::fs-schematic{project,sheet,focus}` | The sheet, zoomed to a part or net     |
| `::fs-part{ref}`                      | The part card with cross-surface links |
| `::fs-board{project,view}`            | 3D or 2D board view                    |
| `::fs-drc{project}`                   | Violations summary                     |

Per SPEC 00 §7, each mounts a domain component that takes an id and self-fetches — so `<PartCard reference="U3"/>` works identically in a panel and inside an agent message.

### Mentions

Extend the existing **`fs-intel`** provider on `#` to resolve reference designators (`#U3`) alongside CVEs and software components. It is already the "what is this thing" provider; hardware parts belong to the same question. Disambiguation is by pattern, with the surface named in the result label so `#U3` never silently resolves to a software package.

### Skills

`skills/fs-hardware/SKILL.md` — when to use the surface, the reference designator as join key, the directive syntax, and the prohibitions: never edit KiCad files directly (KiCad owns them), never assert an HBOM value the design doesn't support, always propose links rather than writing them as fact.

### CLI

```
bb finite-state hw
  discover                  # find KiCad projects in the worktree
  extract [--force]         # regenerate artifacts
  parts [--sheet <path>]    # list symbols
  nets [--name <net>]
  drc | erc                 # run and summarize
  link <ref> --hbom <part>  # propose a link
```

---

## 9. Edge cases and failure modes

| Case                                    | Behavior                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KiCad not installed                     | Hardware-lane advisory with install guidance while the plugin remains running (FS-158). **Parsing still works** — `kicadts` needs no KiCad, so symbols, nets, and search degrade gracefully while renders don't. Before any project is ingested, project-scoped `hardwareArtifactsStatus` returns `HW_PROJECT_NOT_FOUND`, so this advisory is log-only; an unconditional probe is not part of the current contract |
| KiCad 5 or earlier files                | Unsupported; say so explicitly. The format predates S-expressions                                                                                                                                                                                                                                                                                                                                                  |
| Very large or dense sheets              | Heavy SVGs. Measure before optimizing; if needed, render coarse and swap detail on zoom                                                                                                                                                                                                                                                                                                                            |
| GLB export slow or large                | Never generate during a demo. Pre-export, cache, and show the cached artifact                                                                                                                                                                                                                                                                                                                                      |
| Stroke fonts plotted as paths           | In-SVG text search breaks. **Search parsed semantics instead** — better anyway                                                                                                                                                                                                                                                                                                                                     |
| Multi-unit symbols (U3A, U3B)           | Keyed by `(reference, unit)`; the part card aggregates units                                                                                                                                                                                                                                                                                                                                                       |
| Parts with no MPN                       | Common and legitimate. Link by footprint plus value; leave HBOM cells bare-null (`—`), never fabricate                                                                                                                                                                                                                                                                                                             |
| Reference renumbering between revisions | Links break silently. Detect by comparing symbol sets across hashes and **report as drift**, mirroring SPEC 02's re-scan handling                                                                                                                                                                                                                                                                                  |
| Two KiCad projects in one worktree      | Supported; `project_key` is the discriminator, with a project selector in the panel header                                                                                                                                                                                                                                                                                                                         |
| Schematic edited while a panel is open  | File-watch, invalidate the cache, banner offering re-extract. **Never auto-regenerate during an agent run**                                                                                                                                                                                                                                                                                                        |

---

## 10. Build plan

| Phase  | Deliverable                                                                     | Effort                                          |
| ------ | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| **7a** | KiCad discovery, `kicad-cli` driver, artifact cache, `hw_project`/`hw_artifact` | 3 d                                             |
| **7b** | `kicadts` parser → `hw_symbol`, `hw_net`; search                                | 2.5 d                                           |
| **7c** | Schematics tab — React Flow viewport, sheet tree, SVG render                    | 3 d                                             |
| **7d** | Semantic overlay — transform, hit-targets, inspector, part card                 | 3 d                                             |
| **7e** | Board tab — GLB view, 2D board SVG, stackup card                                | 2.5 d                                           |
| **7f** | Fab tab — gerbers/drill, BOM view, netlist browser, DRC/ERC list                | 2 d                                             |
| **7g** | HBOM ingest with `kicad_bom` provenance _(SPEC 04 amendment)_                   | 2 d                                             |
| **7h** | Cross-surface linking + `links/hardware.yaml`                                   | 3 d                                             |
| **7i** | DRC/ERC into the verification matrix _(SPEC 03 amendment)_                      | 1.5 d                                           |
| **7j** | Agent tools, directives, mentions, skill, CLI                                   | 3 d                                             |
|        | **Total**                                                                       | **~25.5 d / 5–6 wk at one agent, ~3 wk at two** |

**Sequencing note.** 7a–7d is the demonstrable core and lands in about two weeks. 7g and 7h are where the _product_ claim gets made — they are not polish, and they should not be deferred to a second pass on the theory that the viewer is the feature. The viewer is table stakes; the linking is the moat.

---

## 11. The KiCanvas question

**KiCanvas** is an interactive browser-based viewer for KiCad schematics and boards, written in vanilla TypeScript on Canvas/WebGL, that parses `.kicad_sch` and `.kicad_pcb` **directly in-browser with no KiCad installed**, and ships an embedding API. If it renders our boards, phases 7c–7e collapse dramatically and the `kicad-cli` render dependency disappears for the viewers.

**The reason it is not the plan of record:** it is early alpha, upstream development appears stalled, and it supports KiCad 6+ with KiCad 7 only "mostly supported" — leaving KiCad 8/9 files, which is what current designs produce, an open question.

**Decision rule.** Test it against real project files before phase 7c. If it renders correctly, adopt it _for rendering only_ — the parser, cache, linking, and HBOM path are unchanged either way, because those never depended on the renderer. If adopted for anything beyond a demo, plan to vendor and maintain a fork, and keep the `kicad-cli` SVG path alive as a fallback. **Do not make a stalled alpha load-bearing.**

---

## 12. Open questions

1. **MPN → SBOM component mapping** is the weakest link in §6. An STM32 part number does not mechanically imply `pkg:generic/stm32-hal`. Options: a curated vendor mapping table, agent proposal with human acceptance, or explicit manual linking. **Probably all three, tiered by confidence** — but this needs a decision before 7h.
2. **Does the HBOM promote to a server entity?** SPEC 04 keeps it plugin-local pending a 2–4 week platform change. `kicad_bom` provenance strengthens the case for promoting it — worth revisiting.
3. **Should we write to KiCad at all?** Everything here is read-only by design. Agent-authored schematic edits via the IPC API are a genuinely different product, and probably a later one. Flagging so the boundary stays deliberate.
4. **The IPC bridge** (KiCad 9's Protobuf-over-NNG API with official `kicad-python` bindings) buys live bidirectional control and incremental updates. It needs a Python sidecar alongside a TypeScript plugin, and requires the user to enable the API server manually. **Estimated 3–4 weeks, out of scope here.** Note the legacy SWIG `pcbnew` bindings are removed in KiCad 11 — any future work targets IPC.
5. **Cadence and other EDA tools.** Jakib has demonstrated a Cadence → KiCad round-trip. If that becomes a supported path, this spec's KiCad-specific extraction needs an abstraction layer beneath it. Not now, but do not design in a way that makes it impossible.
6. **Reference-designator stability across revisions** (§9) is the hardware analogue of SPEC 02's stable-key problem, and it is likely to be similarly annoying. Watch it.
