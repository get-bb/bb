# IMPLEMENTATION PLAN — `bb-plugin-finite-state`

*Owner: Matt Wyckhouse. Status: ready to dispatch under the FS-93 scheduling gates. This is the tech-lead document — read before assigning any work. It converts SPECs 00–06 into a repo, a dependency graph, nine logical lanes, and a set of frozen interfaces that let those lanes run without colliding.*

**Companion artifacts:** `HANDOFF — Product & Architecture.md` (self-contained product and system overview) · `ADR — Direct APIs & Optional Forge Compute.md` (current integration ruling) · `api-reference/` (vendored reviewed API snapshots) · `AGENTS.md` (the instruction file every coding agent reads) · `tasks/WP-*.md` (the work packages) · `scheduling/PROGRAM-BOOTSTRAP.md` (binding decisions and model policy) · `scheduling/wp-coupling-manifest.json` (effective dispatch graph) · `scheduling/COORDINATOR-RUNBOOK.md` (cap and dispatch procedure) · `RECON — bb SDK & Forge Surface.md` (historical code-grounded recon, superseded by the ADR where noted).

---

## 0. What changed after recon — read this first

We ran code-level reconnaissance of bb, Forge, the Platform API, and Assurance Studio before planning. The first pass found nine corrections; the later Forge source audit added the load-bearing integration ruling in row 10. All are reflected in SPECs 00–06.

| # | What the spec assumed | What the code actually says | Impact |
|---|---|---|---|
| 1 | Forge needs new VEX wrappers | The Platform already exposes the required VEX routes, and the plugin calls them directly through `PlatformClient` | **Removes Forge as a blocking dependency.** Triage can start on day one |
| 2 | Manifest = `{name, server, app, skills, themes}` | Manifest is **`.strict()`** and additionally **requires `description` and `branding`**; `engines` sits outside the `bb` key | SPEC 00's manifest would have **failed validation**. Fixed |
| 3 | Migrations are `migrations/NNNN_*.sql` files | `bb.storage.migrate(db, statements: string[])` — **inline TS string arrays**, append-only, `_bb_migrations` table | Changes the shape of every store WP |
| 4 | Agent tools can be individually approval-gated | **No per-tool approval field exists.** bb's generic approval UI applies uniformly and is not configurable | SPEC 06 §5.3's safety claim was wrong. The gate must be **architectural** (no push tool at all), not a UI setting |
| 5 | Bench rack "enrolls as a bb host" — mechanism unknown | **Resolved.** `bb.hosts` is tunnel-only. Enrollment is `bb.sdk.hosts.createJoinCode()` — the same call the "Add a machine" dialog makes — **but the target must run bb's `host-daemon` binary**, and threads are always server-initiated | The design works, with a real prerequisite. No longer `[UNVERIFIED]` |
| 6 | Bulk limits: deletes ≤100, review ≤500, VEX ≤500 | Platform VEX endpoint ceiling is **5000**, while v1 intentionally uses resumable client chunks of 500. Review bulk is **100, not 500** | Chunking constants change |
| 7 | `bb.http` is the main frontend↔backend bridge | **`bb.rpc`** is, with Standard Schema contracts. `bb.http` is for binary/large payloads only | Confirms SPEC 00 §5, sharpens it |
| 8 | Firmware bytes are fetchable | Direct Platform bytes require **org-admin `VIEW_ANY_PROJECT_FILE`**; ranged reads cap at **128 KiB**; full mode must stream | Per-file hydration is bounded; local STP unpack remains the reliable fallback and a Platform tarball remains high leverage |
| 9 | A generic raw AS call can cover missing document APIs | The public client must have a closed route set; AS binary routes need handler verification and explicit typed methods | Documents are **plugin-local in v1**; no raw escape hatch |
| 10 | The bb plugin should connect to Forge for all Platform/AS data | Forge's clients are thin HTTP wrappers, while full Forge hard-requires PostgreSQL; its unique value is QEMU/dynamic verification, pen test, and compute-job orchestration | **Direct Platform + AS clients; Forge optional compute only.** Core works with Forge stopped |

**One more finding worth its own line:** `plugins/tasks/WORKERS.md` in the bb repo is literally a multi-agent build-coordination document for exactly this scenario. `AGENTS.md` is modeled on it.

---

## 1. Repo decision

> **Partly superseded — see `ADR — bb Is Not Modified.md` (accepted 2026-08-12).**
> The fork stands as a *development container*, but it is not a product artifact
> and **bb is never modified**. The "SDK changes (we will need some)" rationale
> below did not materialise and is withdrawn: no work package may change bb's
> source, its builtin plugins, or `builtin-registry.ts`. The product ships as an
> ordinary plugin installed with `bb plugin install`, and builtin registration
> (WP-02) is deferred as a BB release decision.

**Fork the bb monorepo. Develop at `plugins/bb-plugin-finite-state/`.**

| | Fork the monorepo (chosen) | Standalone repo via `bb plugin new` |
|---|---|---|
| Workspace resolution | Free — `pnpm-workspace.yaml` globs `plugins/*` | Manual |
| Build step in dev | **None** — `customConditions: ["source"]` resolves `@bb/*` to `src/` | Required |
| UI components | Import `@bb/shared-ui` directly | Vendor 44 components via shadcn registry |
| Reference implementation | `plugins/tasks/` sits in-tree, copyable | Read-only reference |
| Test harness | `@bb/plugin-sdk/testing` wired | Wired, but you own the config |
| SDK changes (we will need some) | Edit in place | Blocked on upstream |
| Cost | Carry a fork; rebase deliberately | Clean separation |

**Rules for the fork:**
- Pin to a bb release tag. Rebase on a schedule, never mid-phase.
- **Everything we write lives under `plugins/bb-plugin-finite-state/`** with two enumerated exceptions (§4.3), so the plugin can be extracted to standalone later without archaeology.
- Any change outside that directory requires a note in `FORK-DELTA.md` explaining why it couldn't live inside.

---

## 2. Toolchain (pinned, non-negotiable)

| Thing | Version / choice | Source |
|---|---|---|
| Package manager | **pnpm 9.15.0** (`packageManager` field) | bb root `package.json:61` |
| Node | **22.x** — `.nvmrc` says 22.12.0, root engines say ≥22.19.0. **Use 22.19.0**; fix `.nvmrc` in WP-01 | Conflict found in recon |
| Monorepo | Turborepo ^2.4.0 | `turbo.json` |
| Language | TypeScript, `strict: true`, `NodeNext`, ES2022, `noUnusedLocals` | `@bb/tsconfig/base.json` |
| Tests | **Vitest ^4.1.1**, `*.test.ts(x)`, `defineWorkspaceTestConfig` | `vitest.shared.ts` |
| Plugin test harness | `@bb/plugin-sdk/testing` (backend) · `/testing/app` (frontend) | SDK 0.4.1 |
| Bundler | esbuild **0.28.1 exact** (SDK-managed, don't touch) | `packages/plugin-build/src/toolchain.ts` |
| Lint/format | ESLint 9 flat config + Prettier 3 defaults | root configs |
| SDK | `@bb/plugin-sdk` **0.4.1** | `packages/plugin-sdk/package.json` |
| Icons | **Hugeicons only.** Never Lucide, never emoji | `plugins/tasks/WORKERS.md` |
| Styling | bb theme tokens only. No hex, no oklch literals, no arbitrary Tailwind colors | ibid. |

**`zod` is pinned repo-wide to `4.3.6`** via a root override. Do not add a different zod.

---

## 3. Architecture in one diagram

```
┌── plugins/bb-plugin-finite-state/ ──────────────────────────────────┐
│                                                                     │
│  server.ts   ← composition root. WRITTEN ONCE IN WP-01. FROZEN.     │
│    └─ for each lane: registerXxx(bb, ctx)                           │
│  app.tsx     ← composition root. WRITTEN ONCE IN WP-01. FROZEN.     │
│    └─ for each lane: registerXxxApp(app, ctx)                       │
│                                                                     │
│  shared/contract.ts     ← ALL rpc contracts. FROZEN IN WP-03.       │
│  lib/store/schema.ts    ← ALL tables. FROZEN IN WP-04.              │
│  lib/sync/registry.ts   ← ALL entities + classes. FROZEN IN WP-05.  │
│  lib/remote/types.ts    ← direct services + compute. FROZEN WP-06.  │
│                                                                     │
│  lanes/                 ← each lane owns exactly one directory      │
│    remote/  sync/  findings/  product-security/  bom/               │
│    firmware/  bench/  documents/  agentic/                          │
│                                                                     │
│  test/mock-remote/      ← Platform, AS, optional-compute mocks       │
└─────────────────────────────────────────────────────────────────────┘
```

**The anti-collision design, stated plainly:** the two composition roots (`server.ts`, `app.tsx`) are written **once, completely, in WP-01**, with every lane's registration call already present and pointing at a stub. After WP-01, **no lane ever edits a composition root.** A lane implements its own `lanes/<name>/register.ts` and the wiring is already there waiting for it.

This is the single most important structural decision in the plan. Without it, nine agents serialize behind two files.

---

## 4. The frozen interfaces

Max fan-out only works if the boundaries are settled before the lanes start. Five artifacts are frozen in Phase 0 and **may not be changed by a lane agent** — a change requires a human amendment and a broadcast to all lanes.

### 4.1 The five frozen files

| File | WP | Contains | Why frozen |
|---|---|---|---|
| `shared/contract.ts` | WP-03 | Every RPC method signature for all nine surfaces | Frontend and backend lanes develop against it in parallel |
| `lib/store/schema.ts` | WP-04 | Every SQLite table, as `bb.storage.migrate` statement arrays | Migrations are append-only; two lanes inventing table 001 is unrecoverable |
| `lib/sync/registry.ts` | WP-05 | `ENTITIES` — every entity, its class, dir/table, key function | SPEC 01's core abstraction; every surface reads it |
| `lib/remote/types.ts` | WP-06 | `PlatformClient`, `AssuranceStudioClient`, optional `ForgeComputeClient` | Production and mock implementations satisfy the same closed interfaces |
| `test/mock-remote/fixtures/` | WP-08 | Recorded Platform/AS/compute corpus | Every lane's tests assert against these bytes |

### 4.2 Amendment protocol

A lane agent that needs a frozen interface changed **stops and writes a one-paragraph amendment request** to `AMENDMENTS.md` with: the interface, the change, why the existing shape can't work, and which lanes it affects. It does not proceed on a local edit. A human merges the amendment, bumps `CONTRACT_VERSION` in `shared/contract.ts`, and notifies lanes.

**Expected rate: 3–6 amendments over the build.** Budget for them; they are a sign the freeze is doing its job, not failing.

### 4.3 The two sanctioned out-of-directory changes

1. `apps/server/src/services/plugins/builtin-registry.ts` + its two lockstep test files — **WP-02 only**, one time.
2. `.nvmrc` version correction — **WP-01 only**, one time.

Everything else outside `plugins/bb-plugin-finite-state/` needs a `FORK-DELTA.md` entry.

---

## 5. The nine lanes

| Lane | Owns | Spec | WPs | Can start after |
|---|---|---|---|---|
| **L0 Foundation** | Scaffold, composition roots, store, contracts, registry, theme, CI | 00 | WP-01…09 | — |
| **L1 Remote Services + Mocks** | `lanes/remote/`, `test/mock-remote/` | 00 §6 | WP-10…14 | WP-06 |
| **L2 Sync** | `lanes/sync/` | 01 | WP-15…21 | WP-05, WP-13 |
| **L3 Findings & Triage** | `lanes/findings/` | 02 | WP-22…30 | WP-13, WP-17 |
| **L4 Product Security** | `lanes/product-security/` | 03 | WP-31…40 | WP-13, WP-17 |
| **L5 BOM** | `lanes/bom/` | 04 | WP-41…46 | WP-13 |
| **L6 Firmware/Bench/Docs** | `lanes/firmware/`, `lanes/bench/`, `lanes/documents/` | 05 | WP-47…56 | WP-13 |
| **L7 Agentic** | `lanes/agentic/`, `skills/` | 06 | WP-57…64 | WP-13; per-surface tools follow their surface |
| **L8 Demo & E2E** | `test/e2e/`, `demo/` | 06 §6 | WP-65…70 | G3 |

**L4's canvas is a sub-lane.** It is ~2–2.5 weeks on its own and has no dependency on the other L4 work beyond the registry. Assign it a dedicated agent from the start.

### 5.1 Decision ownership and operational concurrency

The nine lanes describe product ownership, not permission to run nine agents immediately. FS-93 preserves all 70 WP keys and binds the 64 WPs that were still unstarted into 28 decision-owner clusters. The binding rule is strict: if one WP's acceptance criteria require a design choice owned by another, both packages use one owner and execute sequentially. The checked-in manifest is authoritative for this scheduling overlay and its validator prevents two sequential members from becoming concurrently ready.

The operational cap remains four until WP-10 through WP-13 are complete and dependency readiness passes. It then becomes **six lanes**. A later increase to **nine lanes** is conditional on nine independent active-or-ready decision clusters, workflow concurrency of at least nine, 45 GiB free after provisioning all worktrees, and a 35 GiB runtime free-space floor. A free slot never overrides an owner sequence.

Use `fs-critical` (Codex `gpt-5.6-sol`, `xhigh`) for L2 sync and the L4 canvas. Use `fs-standard` (the same model at `medium`) for routine/mechanical packages. Independent review uses `fs-review` (Claude Opus 5, `high`). Exact provider/model identifiers and the machine promotion command live in the manifest and coordinator runbook.

---

## 6. Dependency graph

```
                    WP-01 scaffold + composition roots
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
   WP-02 register       WP-03 contract.ts      WP-04 schema.ts
   in bb                     │                      │
                             └──────────┬───────────┘
                                        ▼
                                  WP-05 registry.ts
                                        │
                                        ▼
                                 WP-06 remote/types.ts
                                        │
                    ┌───────────────────┴────────────────┐
                    ▼                                    ▼
            WP-07 theme+tokens                   WP-08 mock fixtures
            WP-09 CI gates                              │
                                                        ▼
                                              WP-10…13 service mocks
                                                        │
    ┌────────────┬────────────┬────────────┬────────────┼────────────┐
    ▼            ▼            ▼            ▼            ▼            ▼
 L1 clients   L2 sync      L3 triage    L4 prodsec    L5 bom      L6 fw/bench
  WP-14       WP-15…21     WP-22…30     WP-31…40      WP-41…46    WP-47…56
  WP-14           │            │            │            │            │
                  └────────────┴──────┬─────┴────────────┴────────────┘
                                      ▼
                              L7 agentic WP-57…64
                                      │
                                      ▼
                              L8 demo/E2E WP-65…70
```

**Critical path: WP-01 → 03 → 05 → 06 → 08 → 13 → (L3) → L7 → L8.** Everything else has slack. Staff the critical path with your strongest agents and keep a human on WP-03/04/05 review — a mistake in a frozen file is the only thing here that can cost a week.

This diagram shows product prerequisites at lane scale. Dispatch uses the effective per-WP dependency graph in `scheduling/wp-coupling-manifest.json`, including owner-serialization edges such as WP-19 → WP-20 and WP-56 → WP-44.

---

## 7. Remote-service mocks — the thing that makes fan-out possible

Nine lanes cannot share live customer services, and full Forge requires PostgreSQL at boot. **Independent Platform, Assurance Studio, and optional Forge-compute mocks are not a testing nicety; they are the parallelization enabler.** Core tests never boot Forge.

**Build path (WP-10…13), in order:**

1. **Generate from the vendored references.** Platform OpenAPI/audit and AS OpenAPI/handler notes live in `docs/Implementation/api-reference/` with source commit and SHA-256 provenance. Builds and tests do not reach into a sibling Forge checkout.
2. **Patch verified AS gaps** only from the handler-backed audit. The AS spec is knowingly incomplete; handler evidence wins when it disagrees. An unverified route stays absent rather than becoming a generic raw request.
3. **Layer known-drift corrections** recorded in the vendored endpoint audit and contract fixtures. Reproduce these quirks exactly at the raw mock boundary:
   - `/findings/{pv}/{fid}/cves` returns a **CVE-keyed dict**, not a list
   - severity counts nest as `{"bySeverity": {...}, "total": N}`
   - CSV export ends with a `# rows_written=N rows_skipped=M` footer
   - bulk-VEX envelope: `{status, summary{total,succeeded,failed}, results[{findingId,success,status,error}]}`
   - AS envelope: `{success: true, data: {items, total, page, pageSize, hasMore}}`, `page` 1-based, `pageSize` camelCase
4. **Add fault injection per service.** Produce 409 `stale_tara_state`, direct-Platform 403 on firmware bytes, 429 with `Retry-After`, partial bulk failure, strict-schema rejection, mid-push reset, and unavailable optional Forge compute. A failure in one mock must not take down the others.

**Seed corpus target:** one product version with **~4,000 findings** across ~180 components, a 12-node TARA model, 40 requirements, a 900-entry SBOM, and a 6,000-file firmware tree. Big enough that virtualization bugs surface; small enough to live in git.

---

## 8. Phase gates

Demo-complete-first: a thin vertical slice of all fourteen Golden Loop beats before any surface gets its depth pass.

| Gate | Bar | Proves |
|---|---|---|
| **G0** | Plugin loads in bb; nav renders; native `bb.settings.define`/`get`/`onChange` works; typed `connections.status` RPC reports three independent service mocks; CI green | The scaffold, native configuration lifecycle, and service boundary are real without depending on WP-64 CLI |
| **G1** | Findings list renders 4,000 rows from cache at 60fps; `pull` populates SQLite | The data plane works end to end |
| **G2** | Triage round-trips: agent writes YAML → `git diff` → `plan` → `push` to mock → base advances | **The architecture is proven.** This is the moment the risk drops |
| **G3** | Every Golden Loop beat executes, even if some are stubs | No unknown unknowns remain |
| **G4** | Golden Loop runs end-to-end against the mock, **offline, from a warm cache**, unattended | It's demoable |
| **G5** | Golden Loop runs against real Platform + AS on a real product; Forge-compute beats also pass when configured | It's true and degradation boundaries hold |
| **G6** | Per-surface definition of done (SPEC 00 §12) met on all surfaces | It's a product |

**G4 is the demo bar.** Everything between G4 and G6 is the depth pass and can be resequenced against whatever the demo feedback says.

**Hard rule at every gate:** `pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state` is green. A gate is not a vibe.

---

## 9. Effort and staffing

| Lane | Serial effort | Unconstrained owner demand | Unconstrained wall-clock to G4 |
|---|---|---|---|
| L0 Foundation | 1.5–2 wk | 2 | 1 wk (mostly serial) |
| L1 Remote Services + Mocks | 2–2.5 wk | 2 | 1.5 wk |
| L2 Sync | 3.5–4.5 wk | 2 | 2.5 wk |
| L3 Findings & Triage | 4.5 wk | 2 | 3 wk |
| L4 Product Security | 5.5–7 wk | 3 (1 on canvas) | 3 wk |
| L5 BOM | 3.5–4.5 wk | 1 | 3.5 wk |
| L6 Firmware/Bench/Docs | 5–7 wk | 2 | 3.5 wk |
| L7 Agentic | 2.5–3.5 wk | 1 | 2 wk (trails surfaces) |
| L8 Demo & E2E | 1.5 wk | 1 | 1 wk |
| **Total** | **~30–37 agent-weeks** | **~14–16 potential; operationally capped below** | **~6–7 wk scenario, not a dispatch promise** |

Then **G4 → G6 is roughly another 4–5 weeks** of depth work at lower parallelism.

**Reality adjustment:** these are agent-weeks, not human-weeks, and they assume competent review throughput. The operational cap is four now, six only after WP-10 through WP-13 and readiness validation, and nine only after the second conditional promotion gate. The binding constraint is usually **human review bandwidth and merge serialization**, not nominal owner demand. Plan for one reviewer per two or three active lanes, and expect the actual schedule to be set by how fast frozen-interface amendments get adjudicated.

---

## 10. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **`pnpm-lock.yaml` merge hell.** 764KB, ordering-sensitive, not human-mergeable; any dep addition anywhere rewrites it | High | Medium | **Dependency freeze after WP-09.** All third-party deps declared once in WP-01. A lane needing a new dep files an amendment. One designated agent applies lockfile changes in a batch, daily |
| R2 | **Frozen interface churn** — contract.ts amended repeatedly, invalidating in-flight lane work | High | High | Spend real time on WP-03/04/05 with human review. Version the contract. Broadcast amendments. Accept 3–6; investigate at 10 |
| R3 | **Firmware bytes are admin-gated and range reads cap at 128 KiB.** N direct full streams make a 6,000-file first hydrate impractical | **Confirmed fact** | High | Direct Platform is primary for canonical metadata and bounded selected bytes; **STP `standalone_unpack.py`** is primary for a complete image/offline/non-admin use until a Platform tarball exists |
| R4 | Canvas port harder than estimated (React Flow + elkjs + AS extraction) | Medium | Medium | Dedicated agent from day one; spike in week 1 (WP-31) with a go/no-go before the rest of L4 commits |
| R5 | **Bench rack needs bb's `host-daemon` binary installed** to appear as threads | Medium | Medium | Provision the rack in parallel with L6 build. Fallback: bench runs as plugin background service with realtime progress — worse demo, same function |
| R6 | Composition-root discipline breaks; agents edit `server.ts` anyway | Medium | High | **Lint rule + CI check**: fail the build if `server.ts` or `app.tsx` diff after WP-01 without an `AMENDMENTS.md` entry |
| R7 | Mock and live Platform/AS/compute drift; G5 becomes a rewrite | Medium | High | WP-14 implements the frozen remote interfaces early; nightly contract suites run independently against mock and permitted live services |
| R8 | AS binary document contract remains unverified | **Confirmed gap** | Low | Documents are plugin-local in v1. Add direct AS binary methods only after handler verification; never use a raw escape hatch |
| R11 | Optional Forge outage accidentally breaks core data surfaces | Medium | High | Nullable `ForgeComputeClient`, narrow injection, independent health states, and a mandatory “Forge stopped” integration test |
| R9 | Agent tools can't be individually approval-gated | **Confirmed fact** | Medium | The safety model is **architectural, not UI**: no push tool exists. Rewrite SPEC 06 §5.3 claims accordingly (done) |
| R10 | Human review becomes the bottleneck and lanes idle | High | Medium | Batch reviews on a cadence. Let lanes stack PRs. Prefer many small WPs over few large ones — already reflected in the WP granularity |

---

## 11. Spikes to run before committing the schedule

Four unknowns are cheap to resolve now and expensive to discover in week four. Run these in parallel with WP-01.

| Spike | Question | Timebox | Kills / changes what |
|---|---|---|---|
| **S1** | Does the AS canvas actually extract cleanly? Port one node type + elkjs layout into a bare bb panel | 3 d | L4 sizing; possibly the whole canvas approach |
| **S2** | Run `standalone_unpack.py` on a real firmware image outside STP. What's the true dependency footprint and wall-clock? | 2 d | L6 approach; the mount's feasibility |
| **S3** | Stand up a bb `host-daemon` on a spare Linux box and drive a trivial thread onto it | 2 d | The bench-as-threads design (R5) |
| **S4** | Generate independent mocks from the vendored API references and measure generated vs hand-written coverage | 2 d | The mock estimate, which sits on the critical path |

**Do not skip S4.** The mock's cost is the single largest estimation uncertainty in the plan.

---

## 12. Definition of done — the whole build

The plugin ships when SPEC 00 §12 is met on every surface, **and**:

- `pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state` is green
- The Golden Loop runs unattended, offline, from a warm cache — and again against live Platform + AS; optional compute beats pass with Forge configured
- Core pull, panels, and plan/push remain healthy with Forge stopped and no Forge database
- No lane has edited a composition root without an amendment entry
- `FORK-DELTA.md` accounts for every change outside the plugin directory
- Every `[UNVERIFIED]` marker in SPECs 00–06 is either resolved or converted into a filed platform ask
- The five platform asks are filed with owners: `/filesystem/export` tarball · `begin_tara_trial` exposure · `vexChangedAt` + `expected` precondition · `vex_source` column · `.strict()` PATCH audit
