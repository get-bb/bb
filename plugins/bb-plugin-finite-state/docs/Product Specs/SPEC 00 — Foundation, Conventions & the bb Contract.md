# SPEC 00 — Foundation, Conventions & the bb Contract

_Product spec. Owner: Matt Wyckhouse. Status: ready for implementation. This is the spec every other spec references — the plugin skeleton, the shared infrastructure, and the conventions that keep seven surfaces coherent. Read this first._

**Spec set:** 00 Foundation (this) · 01 Sync Engine · 02 Findings & VEX Triage · 03 Product Security (TARA/Requirements/Verifications) · 04 Bill of Materials (SBOM/HBOM) · 05 Firmware Mount, Bench & Documents · 06 Agentic Surfaces

---

## 1. What we are building, in one paragraph

A single bb plugin — **`bb-plugin-finite-state`** — that turns bb from a coding IDE into the workspace where a connected product is designed, analyzed, secured, and proven. It brings seven surfaces (threat model, requirements, verifications, SBOM, HBOM, documents, verification bench) plus the firmware filesystem into the same workspace as the source code, and makes all of it editable by both the human and the agent, with changes reviewed as diffs and pushed to Assurance Studio deliberately.

**The product principle that decides arguments:** _the agent and the human work on the same artifacts, through the same review flow, in one workspace._ If a feature requires the agent to have a private channel the human can't inspect, or requires the human to leave bb, it's wrong.

---

## 2. Users and jobs

| User                                    | Job                                                                                 | What success feels like                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Product security engineer** (primary) | Triage findings, maintain the threat model, prove requirements                      | "I did a day of triage in twenty minutes and every decision is reviewable" |
| **Firmware engineer**                   | Fix what the analysis found; ship without breaking compliance                       | "I can see the security requirements next to the code that satisfies them" |
| **The agent** (a first-class user)      | Do the bulk work: triage, draft requirements, extract HBOM fields, run verification | Edits files, produces diffs, never surprises anyone                        |
| **Compliance/program lead** (secondary) | Know what's proven and what isn't                                                   | "I can see the gap and the evidence chain without asking anyone"           |

**Anti-user for v1:** multi-user concurrent editing. bb is a single-user, full-trust workspace. Assurance Studio remains the collaboration surface; bb is where focused work happens and gets pushed.

---

## 3. The plugin at a glance

```
bb-plugin-finite-state/
├── package.json                    # the manifest (bb key)
├── server.ts                       # backend factory (BbPluginApi)
├── app.tsx                         # frontend registrations (definePluginApp)
├── shared/contract.ts              # zod RPC contracts (shared, type-only in app)
├── lib/
│   ├── sync/                       # pull · plan · push · three-way merge
│   ├── store/                      # SQLite schema + migrations
│   ├── remote/                     # direct Platform + AS clients; optional Forge compute
│   └── format.ts                   # severity, CVSS, dates, hashes
├── panels/                         # one dir per nav panel
├── directives/                     # ::fs-* in-thread components
├── components/
│   ├── ui/                         # vendored from bb registry
│   └── domain/                     # extracted from AS + new
├── skills/                         # SKILL.md files — teach the agent
├── themes/fsds-dark.css
└── assets/fs-icon.svg
```

**Manifest** (`package.json`, `bb` key):

```json
{
  "name": "bb-plugin-finite-state",
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.1" },
  "bb": {
    "name": "Finite State",
    "description": "Review findings, product-security models, BOMs, firmware, and verification evidence in one bb workspace.",
    "branding": { "icon": "./assets/fs-icon.svg" },
    "server": "./server.ts",
    "app": "./app.tsx",
    "skills": ["skills"],
    "themes": [
      {
        "id": "fsds-dark",
        "name": "Finite State Dark",
        "css": "./themes/fsds-dark.css"
      }
    ]
  }
}
```

Plugin id is `finite-state` — it namespaces routes (`/api/v1/plugins/finite-state/…`), storage, settings, and the CLI (`bb finite-state …`).

---

## 4. The five architectural facts every spec must respect

1. **Routine data access is direct.** The plugin backend calls the Finite State Platform REST API and Assurance Studio REST API through closed, typed clients. React never calls an external service.
2. **Forge is an optional compute plane, not a data gateway.** Use its MCP surface only for capabilities that actually live in Forge: QEMU/dynamic verification, autonomous pen testing, and Forge job telemetry. The core product must start and sync with Forge stopped and no Forge PostgreSQL instance.
3. **Four data classes** (SPEC 01): VERSIONED (git YAML) · CACHED (SQLite, read-only) · OVERLAY (git YAML keyed by stable business key) · ACTION-ONLY (invoked, not stored).
4. **No optimistic concurrency on the server.** No ETag, no If-Match. Conflict detection is ours, at plan time, via three-way comparison.
5. **The worktree is the shared substrate.** Source, firmware rootfs, and the product-security model all live there — so the agent's native Read/Grep/Edit reach everything, and one commit can span all three.

---

## 5. Data plane

```
Finite State Platform REST ─┐
                            ├─► backend remote clients ─► sync engine ─► SQLite (cache)
Assurance Studio REST ──────┘                                  │                │
                                                              ▼                ▼
                                                        YAML in worktree   typed RPC
                                                        (git-tracked)          │
                                                                               ▼
Forge MCP (optional compute only) ─► backend job adapter ───────────────► React panels
```

**SQLite** (`<dataDir>/plugins/finite-state/data.db`) holds all CACHED data plus sync bookkeeping. Migrations via `bb.storage.migrate`. Every scoped table, primary/unique key, foreign key, and access index begins with explicit `project_id, project_version_id`; there is no workspace id, `scope_id`, `project_key`, or serialized scope codec. Wire contracts use `projectId` plus `projectVersionId`, where null means project-level. The backend storage boundary maps null to the one reserved non-null SQL sentinel exported as `PROJECT_LEVEL_VERSION_ID = "@project"`; external/RPC input must reject literal `"@project"`.

The D-1 base schema is an authorized in-place rewrite of the positional v1 migration only because the plugin is unregistered/unreleased and the recorded 2026-08-12 read-only search found zero persistent finite-state `data.db` instances. The original table/key/index statements carry D-1 directly; no corrective migration is appended. Base `CREATE TABLE` statements omit `IF NOT EXISTS`, so an unexpected preexisting schema fails loudly. This exception ends at the first frozen merge/registration; every statement is append-only thereafter under `AMENDMENTS.md`.

Pull pages write only rows carrying a staging `generation_id`. Readers select rows whose generation equals the exact project/version/kind `sync_state.accepted_generation_id`. After every requested kind/page validates, one SQLite transaction flips the requested accepted pointers, increments their `base_revision`, clears staging cursors, and marks the generation accepted. Failure or cancellation retains the prior accepted generation and resumable staging metadata. Tables are per-surface and specified in each spec; the shared control shape is:

```sql
-- shared sync bookkeeping
CREATE TABLE pull_generation (
  project_id          TEXT NOT NULL,
  project_version_id  TEXT NOT NULL,
  generation_id       TEXT NOT NULL,
  status              TEXT NOT NULL, -- staging | accepted | superseded | failed | cancelled
  requested_kinds_json TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  completed_at        TEXT,
  accepted_at         TEXT,
  error               TEXT,
  PRIMARY KEY (project_id, project_version_id, generation_id)
);

CREATE TABLE sync_state (
  project_id               TEXT NOT NULL,
  project_version_id       TEXT NOT NULL,
  entity_kind              TEXT NOT NULL,
  accepted_generation_id   TEXT,
  staging_generation_id    TEXT,
  base_revision            INTEGER NOT NULL DEFAULT 0,
  staging_continuation     TEXT,
  staged_pages             INTEGER NOT NULL DEFAULT 0,
  staged_rows              INTEGER NOT NULL DEFAULT 0,
  last_pull                TEXT,
  error                    TEXT,
  PRIMARY KEY (project_id, project_version_id, entity_kind)
);

CREATE TABLE push_log (           -- resumable, per-entity apply record
  project_id       TEXT NOT NULL,
  project_version_id TEXT NOT NULL,
  id               INTEGER NOT NULL,
  run_id      TEXT NOT NULL,
  base_generation_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  expected_base_content_hash TEXT,
  entity_kind TEXT NOT NULL,
  entity_key  TEXT NOT NULL,      -- stable key, not server uuid
  op          TEXT NOT NULL,      -- create | update | delete | noop | conflict
  status      TEXT NOT NULL,      -- pending | applied | failed | skipped
  error       TEXT,
  applied_at  TEXT,
  PRIMARY KEY (project_id, project_version_id, id),
  UNIQUE (project_id, project_version_id, run_id, entity_kind, entity_key)
);
```

`base_snapshot`, `id_map`, and remotely pulled cache rows carry the same explicit project/version pair plus `generation_id`. Local projections and action/evidence journals carry the pair without pretending to be pull generations. `base_revision` is monotonic per project/version/kind: publication increments it once, and each successful per-entity push increments it in the same transaction as the exact base/id-map advance. Plans bind accepted generation ids, starting revisions, and each operation's expected base content hash; generation identity alone is not a stale-plan fence.

**RPC** — typed zod contracts in `shared/contract.ts`, consumed via `useRpc`. Product docs use dotted logical names; pinned bb rejects dots in RPC keys, so exported `RPC_WIRE_METHODS` is the sole bijection to unique lower-camel wire names. Every list input uses `{ pageSize, continuation }` and every result uses `{ items, total, next }`; continuations are opaque. **Strict JSON only** — binary and large payloads go through `bb.http` Hono routes instead.

bb RPC currently supplies parsed input but no authenticated actor identity. Human-only mutation contracts reserve `humanApprovalCapability`, yet v1 has no capability mint/verification path, so push/conflict resolution, comment mutation, HBOM decisions, review transitions, and manual attestations remain authorization-unavailable before side effects. `confirmed`, plugin tokens, `requestInput`, Origin/Host checks, and CLI flags are not actor proof. Local HTTP authentication prevents cross-site access; it does not authorize a human decision.

**Realtime** — `bb.realtime.publish` for sync progress and cache invalidation. Broadcast is ephemeral and unreplayed; treat it as a hint to refetch, never as a data channel.

**Dot-root rule** — `.fs/` = git-tracked overlays/links; `.fs-sync/` and `.fs-firmware/` = gitignored machinery; **evidence never lives under an ignored root** — anything a `source_ref` cites is git-tracked (documents live at `product-security/documents/`, SPEC 05 C12).

---

## 6. Remote services (direct APIs, optional Forge compute)

`lib/remote/` is the only external-service boundary. It exposes three narrow clients behind one composition-only `RemoteServices` object:

- **`PlatformClient` (required for Platform-backed surfaces):** direct HTTPS with the Platform origin and the exact raw `X-Authorization` value stored in plugin secret settings. It owns projects, versions, findings/activity/comments, VEX, SBOM/components, firmware bytes, security assessments, and STP relay calls.
- **`AssuranceStudioClient` (required only for AS-backed surfaces):** direct HTTPS with the AS origin and `X-API-Key` stored in plugin secret settings. It owns TARA entities/checkpoints, requirements, verification checks/results/runs, and project SBOM-package reads.
- **`ForgeComputeClient | null` (optional):** MCP transport for the checksummed compute subset: dynamic/QEMU verification, autonomous pen testing, and Forge job status/list. The pinned Forge commit has no firmware-root registration method; `prepareFirmwareRoot` remains non-freezeable and remote-unsupported until WP-50 proves same-host process control or a separately reviewed Forge method. No Platform or AS CRUD method may route through it, even as a fallback.

All calls occur in the plugin backend. Panels read SQLite or tracked files via typed RPC; binary streams use authenticated `bb.http` routes. Each lane receives only the narrow client it needs, never a generic URL/method/path function and never a generic MCP tool bridge.

Every remote list uses the same normalized paging vocabulary: input `{continuation?, pageSize?}` and output `{items, total, next}`. `next` is an opaque, versioned continuation generated by the client adapter; resume passes it back as `continuation`. Callers never parse it or represent Platform offsets, Assurance Studio page numbers, or Forge registry positions. `next:null` is terminal, and abort is consistently driven by `RemoteCallContext.signal`.

Forge invocation and Forge job telemetry are intentionally different domains. The checksummed invocation allowlist is closed to `verify_dynamic`, `pen_test_run`, `get_job_status`, and `list_jobs`; job `tool` values and the `listJobs` tool filter are open registry metadata strings so jobs owned by other Forge workflows remain observable without becoming invocable.

At plugin RPC, domain, and storage boundaries, D-1 scope is the explicit `projectId` + `projectVersionId` pair—never a workspace binding or serialized scope codec. Direct remote request types remain faithful to reviewed upstream ownership rather than accepting ignored fields: project-only AS routes carry `projectId`, version-addressed Platform/Forge routes carry `projectVersionId`, and a route that uses both (finding activity) requires both.

**Configuration and failure isolation:** the remote lane calls native `bb.settings.define` once and owns its returned `get/onChange` handle. Platform origin/auth, AS origin/key, and optional Forge transport/auth are separate settings and service generations; changing one recreates only that client/limiter/health slot. Missing required Platform configuration may set plugin-level `needsConfiguration`; missing AS or Forge disables only dependent surfaces/actions. A configured-but-unreachable service reports `unreachable` through secret-safe `connections.status` and does not become `needsConfiguration`. A Forge outage must not break findings, VEX, SBOM, TARA, requirements, or ordinary verification data. Disposal aborts probes/retries and closes every limiter/compute transport.

**Contract authority:** the reviewed snapshots and checksummed Forge compute manifest in `docs/Implementation/api-reference/` generate types, mocks, route inventories, and contract tests. Production clients expose only named operations in the frozen interface. The Platform OpenAPI is authoritative for described endpoints; observed handler behavior and the vendored endpoint audit refine known quirks. The AS OpenAPI is incomplete, so handler-backed evidence in the vendored notes/gap audit must verify method, path, input, output, and concurrency semantics before a missing route is implemented. There is no public `as_raw_api`, `asRawApi`, or equivalent escape hatch.

**Operational rules:** rate-limit and chunk bulk operations, do not automatically retry ambiguous non-idempotent writes, stream bytes without buffering whole artifacts, normalize upstream failures to typed redacted errors, and emit job/sync progress as refetch hints through `bb.realtime`.

---

## 7. UI conventions (non-negotiable, enforced in review)

**Theming.** Ship FSDS as a bb theme. **Components use bb token classes only** — `bg-card`, `text-muted-foreground`, `border-border`. No hex, no arbitrary Tailwind colors. Lint rule enforces it.

**Components.** Chrome from bb's registry (`npx shadcn add @bb/table`). Domain components extracted from Assurance Studio or new, in `components/domain/`, with a provenance header comment when extracted.

**Every domain component takes an `id` and self-fetches.** This is the convention that makes the agentic surfaces nearly free: the same `<ThreatCard id="THREAT-22"/>` renders in a panel and inside an agent's message via a directive. No wrappers, no prop-drilling, no duplicate implementations.

**Virtualize anything unbounded.** SBOM, findings, filesystem, logs. TanStack Virtual, matching AS.

**Four states, always designed:** loading (skeleton, not spinner), empty (what to do next), error (what failed and the retry), and **unconfigured** (`needsConfiguration`) for missing required credentials. Per FS-158, missing optional host executables, runtimes, SDKs, workspace sources, or local data instead yields a scoped advisory on the dependent lane while the plugin remains running. A plugin that degrades gracefully feels like a product.

**Density.** These are professional data surfaces — compact rows, monospace for identifiers (CVE, hash, purl), right-aligned numerics, and severity as color _plus_ label (never color alone).

---

## 8. Agent integration conventions

Detailed in SPEC 06, but every surface spec must declare its four agent affordances:

| Affordance                                 | Convention                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent tools** (`bb.agents.registerTool`) | Read tools are free; **write tools mutate local YAML, never the server.** Remote human-only mutations remain unavailable until bb provides verifiable actor/capability proof |
| **Skill** (`skills/<surface>/SKILL.md`)    | Teaches the agent when to use the surface, the stable keys, the directive syntax, and the review expectation                                                                 |
| **Directive** (`::fs-*`)                   | For anything worth showing inline rather than describing                                                                                                                     |
| **Mentions**                               | Stable ids that resolve to fresh context at send time: `@REQ-104`, `#CVE-2026-1234`, `~bench-run-88`                                                                         |

**The rule that keeps this safe:** _agents write intent to files; humans review; a future authenticated capability may authorize the sync engine to push._ No agent tool calls a **model-mutating remote endpoint**, and v1 does not pretend panel input proves a human. The narrow, deliberate exception: **ACTION-ONLY invocations** (SPEC 01 class table — `fs_verification_run` in SPEC 03; `fs_bench_run` and `fs_firmware_materialize` byte modes in SPEC 05) may invoke enumerated actions; they are listed in SPEC 06 §5.3 and nowhere else. Transport does not change this policy.

---

## 9. CLI

One top-level command, discoverable by agents through bb's auto-generated plugin-commands skill:

```
bb finite-state
  connections status              # verify Platform, AS, and optional Forge compute
  connections configure           # open/describe plugin secret settings
  project list | use <id>
  pull [surface]                   # refresh caches + base snapshots
  status                           # local changes · upstream changes · conflicts
  plan [surface]                   # what would be pushed
  push [surface]                   # non-mutating handoff to the human review panel; never applies from CLI
  triage <subcommand>              # SPEC 02
  firmware pull <product-version-id>            # SPEC 05 — pre-warm the mount
  bench run <product-version-id> [--target <path>]   # SPEC 05
```

**Both the human and the agent may inspect with these commands.** Verbs deliberately mirror git and Terraform, but v1's `push` spelling only validates state and hands the operator to the human review panel; it has no `--yes`, conflict-resolution flag, confirmation bypass, or upstream mutation path.

---

## 10. Non-functional requirements

| Concern           | Requirement                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Performance**   | Panel first paint < 200ms from cache; 10k-row table scrolls at 60fps; no external call in a render path                                                           |
| **Offline**       | All panels read from cache; sync failures degrade to stale-with-banner, never blank                                                                               |
| **Data safety**   | Deletes require confirmation with blast radius; pushes are resumable; a failed push leaves coherent state; an interrupted pull never publishes a mixed generation |
| **Observability** | Every sync run logged to `bb plugin logs finite-state`; push runs recorded in `push_log` with per-entity outcome                                                  |
| **Secrets**       | Platform auth, AS key, and optional Forge credential live in plugin secret settings (0600), never in the worktree, a diff, telemetry, or an error message         |
| **Bundle**        | Lazy-load heavy libs (canvas/diagram, XLSX); target < 1MB initial panel bundle                                                                                    |

---

## 11. Build sequence

| Phase | Deliverable                                                                                                        | Spec   |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| **1** | Plugin skeleton, direct remote clients + optional Forge compute adapter, SQLite + migrations, one typed RPC, theme | 00     |
| **2** | **Findings & VEX triage** — the first sync-engine surface                                                          | 01, 02 |
| **3** | Product Security — TARA canvas, Requirements, Verifications                                                        | 03     |
| **4** | BOM — SBOM, HBOM                                                                                                   | 04     |
| **5** | Firmware mount, Bench, Documents                                                                                   | 05     |
| **6** | Agentic surfaces — directives, mentions, skills; the Golden Loop                                                   | 06     |

**Phase 2 is deliberately first.** Triage is the highest-value demo _and_ the hardest technical case (stable keys, three-way merge without server preconditions, bulk apply with partial failure). Everything after it reuses the engine it forces us to build.

---

## 12. Definition of done, per surface

A surface ships when: the panel renders from cache with all four states designed · the agent can read it via a tool and show it via a directive · a skill teaches the agent to use it · it appears in `bb finite-state` CLI where relevant · anything editable round-trips through plan/push with conflict detection · and there's a scripted demo path that works offline from a warm cache.
