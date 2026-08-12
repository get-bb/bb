# Finite State bb Plugin — Product and Architecture Handoff

**Status:** ready for implementation

**Date:** 2026-08-12

**Audience:** product, design, engineering, implementation agents, and reviewers

**Implementation unit:** one bb plugin, `bb-plugin-finite-state`

**Detailed build plan:** 70 work packages across nine internal implementation lanes

## 1. Executive summary

Finite State is being built as **one integrated bb plugin**, not a collection of separately installed plugins. It combines a left-panel product experience with thread-native agent workflows:

- The left side of bb contains the full operational surfaces: Findings, Product Security, Bill of Materials, Documents, Bench, and Sync Review.
- Threads are the conversational operating layer. The agent can query the same data, propose tracked local changes, render live product cards, start narrowly allowed analysis jobs, and hand work to a human for review.
- The Architecture / Threat Model / Canvas is the visual center of the Product Security panel. It connects architecture components and dataflows to threats, findings, firmware files, requirements, and verification evidence.
- Git-tracked YAML is the authority for authored intent. SQLite is a fast, rebuildable cache and projection layer. Firmware bytes live in a separate ignored, content-addressed cache.
- The agent may propose changes but may not push the authored model upstream, resolve sync conflicts, accept HBOM evidence as human-verified, perform lifecycle approvals, or write manual attestations.

The product thesis is straightforward: **the agent works in the same reviewable engineering workspace as the human, and evidence moves through code, model, findings, and verification without becoming opaque agent state.**

## 2. One plugin, many surfaces

The nine “lanes” in the implementation plan are code-ownership and scheduling boundaries. They are not separate products or separately installed plugins.

The installed unit is:

```text
bb-plugin-finite-state
├── one manifest and plugin identity: finite-state
├── one backend composition root: server.ts
├── one frontend composition root: app.tsx
├── one settings and credentials surface
├── one shared SQLite database
├── direct Platform + AS clients, optional Forge compute, and one sync engine
├── one agent tool registry and skill family
├── one bb finite-state CLI tree
└── multiple panels, cards, openers, and thread integrations
```

Keeping this as one plugin matters. Every surface needs the same project selection, stable identities, independently configured remote services, local cache, authored files, plan, review state, and cross-links. Splitting the product would duplicate configuration and synchronization while making cross-surface navigation and atomic review harder.

### 2.1 Internal lanes

The code is organized into nine implementation lanes so teams and agents can work independently behind frozen contracts:

| Lane | Responsibility |
|---|---|
| Foundation | Manifest, composition roots, shared contracts, storage schema, entity registry, theme, CI |
| Remote Services + Mocks | Direct Platform/AS clients, optional Forge compute adapter, and independent deterministic mocks |
| Sync | Pull, status, plan, conflicts, push, and review UI |
| Findings | Findings cache, stable identity, triage, policy, VEX, and drift |
| Product Security | Architecture canvas, threat model, requirements, and verifications |
| BOM | SBOM and HBOM |
| Firmware / Bench / Documents | Firmware mount, verification execution, evidence, and local documents |
| Agentic | Agent tools, directives, mentions, skills, and CLI |
| Demo + E2E | Golden Loop fixtures, acceptance harness, offline mode, and runbook |

## 3. Where users encounter the product

The product is intentionally available in more than one bb surface. These are different views over the same domain services and data, not parallel implementations.

### 3.1 Primary left-panel application

The final work packages define six principal navigation panels:

| Panel | Purpose |
|---|---|
| **Findings** | High-volume vulnerability browsing, filtering, evidence, history, comments, manual triage, and policy proposals |
| **Product Security** | Architecture canvas, threat model, attack paths, requirements, traceability, and verification matrix |
| **Bill of Materials** | Software BOM and evidence-rich Hardware BOM review |
| **Documents** | Local evidence library, viewers, structured extraction, and precise citations |
| **Bench** | Hosts, verification runs, logs, artifacts, attestations, and Safe-to-OTA verdicts |
| **Sync Review** | Semantic plan, field-level conflicts, blast radius, human approval, push progress, and partial results |

Firmware is integrated primarily through bb’s native file experience rather than another redundant panel. The plugin adds mount status, materialization controls, firmware-aware file openers, binary metadata, and version diff behavior around the native tree.

### 3.2 Thread-native experience

Threads are where a user asks questions, delegates investigation, and receives live artifacts. The plugin contributes:

- **Skills:** eight namespaced skills teach identity rules, evidence standards, workflows, and human stopping points.
- **Agent tools:** sixteen tools—nine reads, four tracked-local writes, and three narrowly enumerated actions.
- **Live directives:** twelve React cards render findings, plans, threats, the canvas, requirements, matrix slices, components, HBOM summaries, bench runs, verdicts, and documents inside assistant messages.
- **Mentions:** `@` resolves authored model/doc objects, `#` resolves external intelligence such as CVEs and components, and `~` resolves runs and verdicts.
- **Thread-panel tabs:** bench and verification context can remain open beside the conversation and link to the native execution thread.
- **File openers:** firmware binaries, PDFs, spreadsheets, SVDs, and register maps open in domain-aware viewers.

The agent generally returns compact summaries and stable IDs, then renders the real product component. A message does not need to paste a threat model or 500-line result when it can emit a live card that fetches current state.

### 3.3 CLI

The plugin registers one command tree:

```text
bb finite-state ...
```

It supports scripted reads, local authoring workflows, pulls, status, plans, exports, firmware operations, and bench operations. Because bb exposes CLI metadata to agents, v1 human-only mutation verbs are conservative:

- `push` validates the plan and hands off to the Sync Review panel; it does not perform the upstream mutation.
- HBOM `accept` and `reject` validate the selected review item and hand off to the HBOM review panel.

An executable CLI push can be added only when bb exposes a verified human authorization primitive that cannot be minted or replayed from an agent shell.

## 4. Product Security and the Architecture / Threat Model / Canvas

The Architecture, Threat Model, and Canvas are not separate features. They are layers of one Product Security model and one visual workspace.

```text
Product Security
├── Architecture Canvas
│   ├── components
│   ├── zones
│   ├── assets
│   └── dataflows
├── Threat Model Overlay
│   ├── threats and STRIDE aggregates
│   ├── affected nodes and flows
│   └── selected attack paths
├── Requirements
│   ├── EARS-authored requirements
│   ├── threat and mitigation links
│   └── standard-clause traceability
└── Verification
    ├── requirement × tier matrix
    ├── checks and runs
    └── evidence and attestations
```

### 4.1 Architecture base layer

The canvas renders stable-slug architecture entities:

- Components, including software, hardware, sensors, actuators, ECUs, HSMs, TEEs, medical devices, and network elements
- Zones as containers and trust boundaries
- Assets as inspectable security-relevant objects
- Directed dataflows with protocol, authentication, encryption, and bidirectionality

Selecting a node or flow opens an inspector with identity, criticality, interfaces, technologies, zone, adjacency, affected assets/threats, and a link to the source YAML.

Authored references use stable slugs such as `COMP-httpd`, `FLOW-session`, and `THREAT-22`. Assurance Studio UUIDs remain transient transport handles in the backend and do not become workspace identity.

### 4.2 Threat overlay

The threat model appears over the architecture rather than in an unrelated diagram:

- STRIDE micro-bars summarize threats on each node.
- Selecting a threat focuses all affected nodes and flows.
- Selecting an attack path highlights one traversal at a time.
- Threat-table and canvas selection stay synchronized.
- The inspector links to mitigations, requirements, findings, and verification evidence.

This makes the canvas useful for reasoning, not merely presentation. It should answer: “Where does this vulnerability live, which threat does it contribute to, what requirement mitigates it, and is that requirement verified against the firmware we intend to ship?”

### 4.3 Cross-surface links

A selected component can link to:

- The corresponding SBOM component
- Findings affecting that component
- Relevant paths in the local firmware mount
- Threats and attack paths
- Mitigating requirements
- Verification runs and evidence

Links carry readiness and provenance. If a surface has not been pulled or mapped, the canvas explains the missing link and offers the safe next action rather than presenting a dead control.

### 4.4 Editing and review

The full Product Security panel is editable. A human or agent can propose component, zone, asset, dataflow, threat, mitigation, and requirement changes. Those edits update tracked local YAML first.

The workflow is:

1. Pull server state and establish a base snapshot.
2. Render semantic YAML plus cached server data.
3. Apply a local edit with compare-and-swap protection.
4. Refresh the canvas immediately from the workspace model.
5. Compute a semantic three-way plan: base, ours, and freshly observed theirs.
6. Show field-level differences, conflicts, dependencies, deletes, and blast radius in Sync Review.
7. Require a human to resolve conflicts and explicitly push.
8. Verify server read-back where upstream PATCH behavior can silently drop fields.

Deleting architecture entities includes a deletion-impact preview and explicit cascade/detach choice. Non-restorable types require stronger typed confirmation. Git remains the recovery path for local intent.

### 4.5 Layout is not the security model

Node position, collapse state, pan, zoom, and selection are intentionally separated from semantic content:

- Semantic architecture and threats participate in plan/push.
- Shared node position and collapsed state live in `product-security/layout/canvas.json`.
- Pan, zoom, and current selection are session-only.
- Layout is never pushed to Assurance Studio in v1.

This prevents dragging a box from appearing as a security-model change.

### 4.6 Canvas inside a thread

The same canvas module can render inside an assistant message:

```text
::fs-canvas{focus="COMP-httpd" highlight="THREAT-22"}
```

The message version is read-only, lazy-loaded, approximately 420px tall, and focused on the current discussion. It supports inspection and an **Open in Product Security** affordance. Editing remains in the full panel, where the complete inspector, stencil, conflict handling, and review context are available.

## 5. System architecture

```text
┌──────────────────────────────── bb ────────────────────────────────┐
│                                                                    │
│  Left panels                 Threads                 CLI / files    │
│  ───────────                 ───────                 ───────────    │
│  Findings                    skills                  bb finite-state │
│  Product Security            tools                   file openers   │
│  BOM                         mentions                native tree    │
│  Documents                   live directives                       │
│  Bench                       run context tabs                       │
│  Sync Review                                                      │
│       │                         │                         │          │
│       └─────────────────────────┼─────────────────────────┘          │
│                                 ▼                                    │
│                     Shared RPC / domain services                     │
│                                 │                                    │
│            ┌────────────────────┼─────────────────────┐              │
│            ▼                    ▼                     ▼              │
│    tracked workspace       shared SQLite       firmware cache       │
│    YAML + documents        cache/projections   bytes + sidecars     │
│            │                    │                     │              │
│            └────────────────────┼─────────────────────┘              │
│                                 ▼                                    │
│                Sync engine + backend remote services                │
└───────────────────────┬──────────────┬───────────────┬──────────────┘
                        ▼              ▼               ▼
                 Platform REST   Assurance Studio   Forge compute
                                  REST              (optional MCP)
```

### 5.1 Frontend composition

`app.tsx` registers all frontend extension points once. Lane-specific `registerXxxApp` modules contribute panels, directives, file openers, and thread tabs. Frontend code uses typed RPC and navigation helpers; it does not import the database, remote clients, secrets, or backend SDK. React never makes Platform, AS, or Forge calls.

Large tables and trees are paged and virtualized. Domain cards accept stable IDs and fetch their own data, allowing one component to render in a panel, the Sync Review diff, or a message directive without semantic drift.

### 5.2 Backend composition

`server.ts` creates a per-load plugin context and calls all backend lane registrars. Backend responsibilities include:

- Settings and secret handling
- SQLite migrations and repositories
- Direct Platform and AS transport/normalization, plus optional Forge-compute jobs
- Pull, plan, conflict, and push services
- HTTP routes for binary and streaming content
- Realtime invalidation hints
- Background refresh and job progress
- Agent tools, mentions, and CLI

The composition roots are frozen after scaffold creation. Lanes replace their own stubs and do not continuously merge into `server.ts` or `app.tsx`.

### 5.3 Frozen contracts

Five early artifacts allow parallel implementation:

| Contract | Purpose |
|---|---|
| `shared/contract.ts` | All 65 frontend/backend RPC method contracts |
| `lib/store/schema.ts` | Shared database: named inventory of 29 tables, one view, and 48 explicit indexes |
| `lib/sync/registry.ts` | Entity classes, storage locations, stable keys, and remote-sync eligibility |
| `lib/remote/types.ts` | Closed `PlatformClient`, `AssuranceStudioClient`, and nullable `ForgeComputeClient` contracts |
| `test/mock-remote/fixtures/**` | Deterministic per-service corpus shared by every lane and E2E test |

After freeze, a lane that needs a change files an amendment rather than inventing a shadow contract.

## 6. Data ownership and storage

The architecture deliberately separates authority, cache, and machinery.

### 6.1 Tracked authored state

Git-tracked files hold human- and agent-authored intent:

```text
.fs/triage/...                       VEX/triage decisions
.fs/verification/checks/...         local check parameters
.fs/attack-paths/...                local viability decisions
.fs/links/...                       explicit cross-surface mappings
product-security/architecture/...   components, zones, assets, dataflows
product-security/threats/...        threats
product-security/mitigations/...    mitigations
product-security/requirements/...   requirements
product-security/hbom/hbom.yaml     HBOM cells and provenance
product-security/documents/...      local evidence documents
product-security/layout/canvas.json shared layout only
```

These files are reviewable, diffable, branchable, and recoverable with ordinary engineering tools.

### 6.2 Shared SQLite cache and projections

SQLite stores data that is large, server-derived, or optimized for local joins:

- Findings, intelligence, comments, and audit history
- SBOM components and vulnerability rollups
- Standards, clauses, methodology vocabularies, and review tokens
- Attack-path bodies
- Verification checks, mappings, rollups, runs, results, artifacts, and attestations
- Rebuildable indexes over triage, HBOM, and document extraction files
- Sync base snapshots, ID mappings, status, push journal, and triage-run summaries

SQLite is never treated as the authority for authored threats, requirements, triage decisions, HBOM cells, or document bytes.

### 6.3 Firmware cache

Firmware is large, local machinery:

```text
.fs-firmware/<pv-id>/rootfs/
.fs-firmware/<pv-id>/manifest.sqlite
.fs-firmware/blobs/<sha256>
```

It is gitignored, content-addressed, path-safe, and shared across versions through hash reuse. Direct Platform APIs provide canonical metadata and bounded selected-byte hydration when authorized; local standalone unpack is the primary complete-image/offline/non-admin path until a Platform tarball exists. Forge enters only after the root is fully materialized and a QEMU or pen-test compute job is requested.

### 6.4 Documents

Documents are plugin-local in v1 because the AS binary handler flow is not yet frozen into closed client methods. Forge is not a document transport. They are content-addressed and tracked so citations survive a clone. Source references are structured and exact:

- PDF: digest + page + optional normalized bounding box
- Spreadsheet: digest + sheet + A1 cell/range
- Text: digest + line range

Filename-only evidence is not accepted.

## 7. Sync and review model

The sync engine applies a three-layer model:

```text
base    = last server state we pulled and accepted as the comparison base
ours    = current tracked workspace intent
theirs  = current server state refreshed for planning
```

The main operations are:

1. **Pull:** refresh server caches and base snapshots without destroying valid stale data on failure.
2. **Status:** report local changes, upstream drift, conflicts, orphans, and stale decisions.
3. **Plan:** compute semantic operations, validation failures, dependency ordering, conflicts, and blast radius.
4. **Resolve:** record explicit per-field choices—ours, theirs, or edited value.
5. **Push:** a human-triggered, resumable application of the reviewed plan with per-entity base advancement and read-back verification.

Push is not globally atomic because upstream APIs are per-row and do not expose universal transactions. The design is instead resumable and coherent under partial success: each successful entity advances its base, each failure remains dirty, and `push_log` records exact outcomes.

Stable identity is essential. Authored content uses slugs and business keys; server UUIDs remain mappings. Findings use a version-resilient ladder based on project, CVE, and component identity: purl first, then folded name/group/version, then folded name/group for explicitly promotable any-version decisions.

## 8. Agent operating model and safety boundary

The plugin exposes sixteen tools:

| Class | Count | Capability |
|---|---:|---|
| Read | 9 | Query compact cached/YAML summaries, validate, and prepare plans |
| Write | 4 | Write CAS-protected tracked local YAML only |
| Action | 3 | Start verification, start bench analysis, or fetch/materialize firmware bytes |

The three action tools are enumerated and compile-time allowlisted. Adding a fourth requires an explicit amendment.

### 8.1 What an agent may do

- Query findings, architecture, requirements, BOMs, evidence, runs, and documents
- Propose triage decisions, requirements, and HBOM extraction candidates in tracked files
- Prepare and explain a sync plan
- Start verification and bench runs
- Materialize firmware metadata or bytes through bounded services
- Render live product artifacts in a message

### 8.2 What remains human-only

- Push authored changes upstream
- Resolve sync conflicts
- Accept or reject HBOM evidence as human-reviewed truth
- Approve/reject review lifecycle transitions
- Write manual attestations
- Confirm non-restorable destructive actions

bb does not currently provide a trustworthy per-tool or CLI human-identity gate. The safety boundary is therefore architectural: forbidden capabilities are absent from the agent tool registry and from executable agent-readable CLI paths.

## 9. Remote services and bb integration

The backend owns three closed service boundaries:

- `PlatformClient`: direct REST for projects/versions, findings/VEX, SBOM/components, firmware, and security-assessment relays
- `AssuranceStudioClient`: direct REST for TARA entities/checkpoints, requirements, verification data/actions, and AS-specific project views
- `ForgeComputeClient | null`: optional MCP for dynamic/QEMU verification, autonomous pen testing, prepared firmware roots, and Forge job telemetry

Each has an independent deterministic mock and configuration/health state. The aggregate exists only at the composition root; lanes receive narrow clients. There is no generic request, arbitrary path/method, `as_raw_api`, or generic MCP-tool bridge.

Normal data flow is:

```text
Platform/AS → backend named client → sync/domain service → SQLite or tracked files
                                                        → typed RPC → panel/card

materialized firmware → optional Forge compute → normalized job/artifact cache
```

The plugin must start, pull, plan, and serve every non-compute surface with Forge stopped and no Forge PostgreSQL instance. A missing AS or Forge configuration degrades only dependent surfaces/actions.

Technical channel choices are deliberate:

- `bb.rpc` carries bounded typed JSON.
- `bb.http` carries binary uploads/downloads, full logs, artifacts, and document content.
- `bb.realtime` carries small refetch hints, never authoritative domain payloads.
- `bb.storage.database()` provides the shared plugin SQLite database.
- bb host enrollment and `host-daemon` support running bench work on a selected machine and linking the evidence back to the native thread.

## 10. The Golden Loop

The Golden Loop is both the product narrative and the end-to-end acceptance test:

1. A new firmware version arrives.
2. The agent materializes the firmware mount.
3. Findings and component changes are queried from the local cache.
4. The agent dry-runs and writes routine triage decisions to YAML.
5. A human reviews and edits the git diff.
6. Sync Review shows the semantic plan and an upstream conflict.
7. The human resolves the conflict and pushes.
8. A held finding is traced onto the architecture canvas and threat model.
9. The agent drafts a mitigating EARS requirement with automated validation gates.
10. The source/model/decision changes remain visible in one workspace.
11. A bench run executes against the exact firmware digest.
12. Results, artifacts, and signed evidence populate the verification matrix.
13. The Safe-to-OTA verdict changes only because complete, digest-bound evidence exists.
14. One commit spans source, model, requirement, and triage decision.

Four moments should remain visually and technically protected:

- **One workspace:** firmware, model, requirements, findings, and evidence coexist.
- **The agent proposes; the human approves:** the semantic diff is the trust boundary.
- **Evidence, not assertion:** verification state derives from runs and attestations.
- **One commit spans the engineering decision:** source and security intent remain reviewable together.

## 11. Failure behavior and offline posture

The UI is cache-first and designed for four explicit states: loading, empty, recoverable error/stale data, and unconfigured.

Important failure rules include:

- Failed refreshes preserve the last complete cache.
- Realtime events may be missed; consumers refetch durable state.
- Non-idempotent job ambiguity returns a status-query instruction and does not blindly retry.
- Partial VEX/push results are evaluated item by item even when transport status is successful.
- Firmware corruption, hash mismatch, or incomplete materialization cannot become ready evidence.
- Unsigned, invalid, unmapped, or wrong-digest verification evidence remains inconclusive.
- Malformed authored files show file/line repair guidance and do not make SQLite authoritative.

The G4 demo bar is a deterministic end-to-end Golden Loop that runs offline from a warm cache with no undeclared external network dependency.

## 12. Implementation strategy

The detailed plan contains 70 work packages. The critical path is:

```text
scaffold
→ frozen contracts/store/registry/remote-service interfaces
→ fixture corpus and independent fault-capable service mocks
→ sync vertical slice
→ findings and product surfaces
→ agentic integration
→ Golden Loop E2E
```

Implementation should proceed through gates rather than attempting all surface depth at once:

| Gate | Proof |
|---|---|
| G0 | Plugin loads, panel renders, native settings reconfigure independently, `connections.status` RPC reports all three mock services, and CI is green; no WP-64 CLI dependency |
| G1 | Findings pull and virtualized cache-backed list work end to end |
| G2 | Local YAML → diff → plan → human push → base advance works |
| G3 | Every Golden Loop beat exists, even if thin |
| G4 | Full loop runs offline from warm cache |
| G5 | Full loop runs against real Platform + AS; optional compute beats pass with Forge configured |
| G6 | Every surface meets its complete definition of done |

The frozen contracts deserve early human review. A mistake in an ordinary component costs a work package; a mistake in shared RPC, storage, identity, or remote-service contracts can invalidate multiple parallel lanes.

## 13. Deliberate v1 constraints and open platform questions

The following are known boundaries, not implementation surprises:

1. **Human CLI authorization:** executable push/accept commands wait for a bb primitive that proves distinct human authorization.
2. **TARA transaction fencing:** `begin_tara_trial` is agents-API-only; v1 uses an honest head/hash checkpoint bracket and exposes residual race semantics.
3. **Canvas layout upstream:** Assurance Studio has no verified layout write path; layout stays local-only.
4. **Verification check creation:** the public noninteractive creation path is not settled; `check:null` remains “needs check creation,” not silent invention.
5. **Risk treatment:** full risk treatment/acceptance is outside the v1 Product Security canvas scope.
6. **Firmware export:** there is no whole-filesystem tarball endpoint; local standalone unpack is the primary path.
7. **Documents:** binary documents are plugin-local; retention/LFS policy and verified OCR remain product decisions.
8. **Higher bench tiers:** v1 implements Tier 0 and Tier 1; HIL/manual policy is future work.

## 14. Source map for the next team

Read these in order:

1. `HANDOFF — Product & Architecture.md` — this document
2. `ADR — Direct APIs & Optional Forge Compute.md` — current integration decision
3. `api-reference/README.md` — vendored API provenance and authority rules
4. `IMPLEMENTATION PLAN — Master.md` — sequencing, frozen interfaces, gates, and staffing
5. `AGENTS.md` — binding implementation rules and precedence
6. `RECON — bb SDK & Forge Surface.md` — historical code-grounded facts, superseded by the ADR on transport ownership
7. `tasks/README — Work Package Index.md` — all 70 packages and dependencies
8. Product Specs 00–06 — domain and interaction detail

When sources disagree, use the documented precedence:

```text
Accepted ADR / frozen interfaces
→ API reference authority rules
→ RECON / Implementation Plan / AGENTS.md
→ Product Specs 00–06
→ supporting research and exploratory documents
```

The implementation packages already incorporate the cross-audit corrections made during planning: stable findings identity, explicit review tokens, complete verification evidence, bench host/thread linkage, exact document locators, strict directive inputs, and the non-agent push boundary.
