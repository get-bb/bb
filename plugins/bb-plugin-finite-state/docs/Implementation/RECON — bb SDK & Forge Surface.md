# RECON — bb SDK & Forge Surface

*Code-grounded reconnaissance run before implementation planning, August 2026. Every fact below was verified against the named source trees; unconfirmed items are marked `[UNVERIFIED]`. **Integration ruling (2026-08-12):** `ADR — Direct APIs & Optional Forge Compute.md` supersedes every Forge-first transport recommendation in this historical recon. Platform and AS data are called directly through frozen typed clients; Forge MCP is optional and compute-only. The source observations below remain evidence for route quirks, compute behavior, and bb SDK facts, but Forge wrappers and `as_raw_api` are not product interfaces. The vendored reference provenance is `api-reference/README.md`.*

---

## PART 1 — bb PLUGIN SDK

### 1.1 Package

`@bb/plugin-sdk` **0.4.1**, at `packages/plugin-sdk/`, ESM. Six export subpaths: `.` (`BbPluginApi`, contracts) · `./app` (`definePluginApp`, hooks) · `./internal/composer-customization-validation` · `./internal/composer-view` · `./testing` (backend harness) · `./testing/app` (frontend harness — kept separate so backend tests never load React).

Deps: `hono@4.11.9`, `better-sqlite3@12.10.0`, `zod@^4.3.6` (peer-optional), `react@^19`.

### 1.2 `BbPluginApi` namespaces

Bound to `export default function plugin(bb: BbPluginApi)`. Source: `packages/plugin-sdk/src/backend-contract.ts`.

| Namespace | Surface |
|---|---|
| `bb.storage` | `kv.{get,set,delete,list}` (JSON ≤256KB/row, shared bb.db) · `database(): Database.Database` (dedicated `<dataDir>/plugins/<id>/data.db`, WAL, busy_timeout 5000) · `migrate(db, statements: string[])` (append-only, `_bb_migrations`) |
| `bb.rpc` | `register(contract, handlers)` — Standard Schema. `POST /api/v1/plugins/<id>/rpc/<method>`, always `local` auth, envelope `{ok:true,result} \| {ok:false,error:{code,message,issues?}}` |
| `bb.http` | `route(method, path, handler, {auth?: "local"\|"token"\|"none"})`. Mounted `/api/v1/plugins/<id>/http/<path>`. Raw Hono `Context` |
| `bb.realtime` | `publish(channel, payload)`. **No per-channel subscriptions in v1** — fans out to all clients as WS `plugin-signal`, client filters |
| `bb.settings` | `define(descriptors)` → `{get, onChange}`. Kinds: `string` (`secret?`), `boolean`, `select`, `project`. Secrets in a 0600 file, never sent to frontend |
| `bb.status` | `needsConfiguration(message)` |
| `bb.agents` | `registerTool(...)` · `configure(provider)` → `{tools, skills, instructions?}` per thread |
| `bb.cli` | `register({name, summary, commands?, run(argv, ctx)})` |
| `bb.ui` | `registerMentionProvider(...)` |
| `bb.hosts` | `ensureSharedPortTunnel(hostId)` · `declareSharedPorts(hostId, ports)` — **tunnel only, not enrollment** |
| `bb.events` | `on(name, handler)`. Observed: `thread.created`, `thread.active`, `thread.idle`, `thread.failed`, `thread.deleted`. `[UNVERIFIED]` — full enum not read |
| `bb.background` | `service(name, {start(signal: AbortSignal)})` |
| `bb.log` | `info/warn/error/debug` |
| `bb.sdk` | **The escape hatch** — full BB SDK over loopback (`BbSdk`) |

### 1.3 Frontend registration — the complete slot list

`definePluginApp(setup: (app: PluginAppBuilder) => void)`. `app-contract.ts:685-711`:

```ts
interface PluginAppSlots {
  homepageSection(r): void;
  settingsSection(r): void;
  navPanel(r): void;
  threadPanelAction(r): void;
  pendingInteraction(r): void;
  sidebarFooterAction(r): void;
  experimental_threadList(r): void;          // unstable
  experimental_threadHeaderAction(r): void;  // unstable
  fileOpener(r): void;
  messageDirective(r): void;
  messageAction(r): void;
}
```

Plus `app.composer.customize(...)` and `app.contentScripts.register(...)`.

**There is no theme-registration function and no generic command slot.** Themes are declared in the manifest. Commands are `bb.cli` (backend) or `messageAction`/`threadPanelAction` (frontend).

### 1.4 Manifest — `.strict()`, and stricter than the specs assumed

Schema at `packages/domain/src/plugin-manifest.ts`, validated identically at build time and load time (no drift possible).

```ts
pluginBbManifestSchema = z.object({
  name:        requiredManifestString,   // REQUIRED
  description: requiredManifestString,   // REQUIRED  ← specs omitted this
  branding:    pluginBrandingSchema,     // REQUIRED  ← specs omitted this
  server:      requiredManifestString,   // REQUIRED
  app:         optional,
  skills:      z.array(string).optional(),   // default ["skills"]
  themes:      z.array({id, name, description?, css}).optional(),
}).strict();                              // unknown keys FAIL

pluginPackageJsonSchema = z.object({
  name, version,                          // REQUIRED
  engines: { bb?, bbPluginSdk? }.optional(),   // OUTSIDE the bb key
  bb: pluginBbManifestSchema,
}).passthrough();
```

### 1.5 `registerTool`

Two overloads. **Zod is the validated path**; a raw JSON-schema object is an unvalidated escape hatch.

```ts
registerTool<S extends z.ZodType>(t: {
  name: string; description: string; instructions?: string;
  experimental_statusLabels?: …;
  parameters: S;
  execute(params: z.output<S>, ctx): PluginAgentToolResult | Promise<…>;
}): void;

type PluginAgentToolResult =
  | string
  | { content: ({type:"text",text} | {type:"image",data,mimeType})[]; isError?: boolean };
```

**There is no per-tool approval model.** Exhaustive grep found no `requiresApproval` / `confirm` / `permission` field. bb's generic approval UI applies uniformly to all tool calls and is not configurable per plugin tool. Tool sets apply at **next session start**, not hot-added mid-session.

> **Consequence for our safety model:** the human gate cannot be a UI setting. It must be architectural — the pushing capability simply doesn't exist in the agent's toolset. SPEC 06 §5.3 has been corrected.

### 1.6 Directives

```ts
app.slots.messageDirective({ id, component });   // id: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
```

Props: `{attributes: Readonly<Record<string,string>>, source, message:{id,threadId,turnId,projectId}, openWorkspaceFile}`.

**Attributes are always strings and untrusted** — parse and validate in the component. Components are ordinary React, so hooks and async fetching work (demonstrated by `plugins/tasks`' `TaskDirectiveCard` → `useTaskEmbed` → `useRpc`).

### 1.7 Mentions

```ts
type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";   // all four we wanted are available
bb.ui.registerMentionProvider({ id, label, triggers?, search(ctx), resolve(itemId) });
```

`search()` runs server-side while typing, **2s time-boxed**, failure-isolated (throw → empty list). `resolve()` runs once at send time, returns `{context: string}` attached as agent-visible/user-hidden prompt input. **Throwing from `resolve()` blocks the send.**

### 1.8 Hosts — the flagged unknown, resolved

**A real host enrollment system exists in bb** (`docs/multiple-devices.md`, `apps/host-daemon/`), **but `bb.hosts` is not it.** `bb.hosts` is tunnel-port management only; its own doc comment says tunnel identity "is owned by the daemon's trusted enrollment." Zero matches for `registerHost` / `enrollHost` in the SDK.

**The reachable path** is `bb.sdk.hosts.createJoinCode(): Promise<{joinCode, hostId, expiresAt}>` (`packages/sdk/src/areas/hosts.ts:79-105`) — exactly what the "Add a machine" dialog calls (`AddMachineDialog.tsx:134`), passed through unmodified by `wrapSdkForPlugin`. A loopback caller passes the auth check by design.

**What it means:** a plugin can mint a real join code. It cannot make an arbitrary running process become a thread. The target must run bb's `host-daemon`, redeem the code via `POST /internal/hosts/enroll`, and thereafter threads are **server-initiated onto the daemon** (`thread.start` / `turn.submit` RPC), never externally ingested.

Full host management is available: `bb.sdk.hosts.{list,get,update,delete,directory,installProviderCli,…}`. Proof of plugin use: `examples/plugins/cascade/server.ts:166-181`.

### 1.9 Skills

`SKILL.md` + YAML frontmatter `name` (kebab-case ≤64) and `description` (≤1024), parsed with `gray-matter`. **Directory name must exactly equal frontmatter `name`.**

Precedence: **project > data-dir/user > plugin > builtin**, with name-collision exclusion within and across tiers → **namespace ours** (`fs-triage`, not `triage`). A plugin can narrow its own injected set per-thread via `bb.agents.configure({skills})`.

**Auto-generated CLI skill:** `syncPluginCommandsSkill()` writes `<dataDir>/skills-generated/plugin-commands/SKILL.md` from registered `{name, summary, commands}` metadata — **zero plugin code executed**. Re-synced on every load/reload/enable/disable. Write those summaries for an agent audience.

Reserved CLI names: `environment, guide, help, manager, plugin, project, provider, skill, status, theme, thread`. (`finite-state` is clear.)

### 1.10 Engineering environment

| | |
|---|---|
| pnpm | **9.15.0** pinned. Workspace globs include `plugins/*` and `examples/plugins/*` — auto-discovery, no registration needed |
| Node | `.nvmrc` = 22.12.0; root `engines.node` = ≥22.19.0. **They disagree — fix in WP-01** |
| TS | `strict`, `NodeNext`, ES2022, `noUnusedLocals`. **`noUncheckedIndexedAccess` is NOT set.** `customConditions:["source"]` resolves `@bb/*` to `src/` — no build step in dev/test |
| Vitest | ^4.1.1, `vitest.shared.ts` → `defineWorkspaceTestConfig` |
| ESLint 9 flat | Bans sync `child_process`; bans `apps/server` from `node:fs`; React Compiler rules at `warn` |
| Prettier 3 | No config — all defaults |
| Bundler | esbuild **0.28.1 exact**. `app.tsx` → browser ESM + `@scope`d Tailwind v4 CSS (utilities can't leak). `server.ts` → node22 ESM, externals `@bb/plugin-sdk`, `better-sqlite3` |
| Dev loop | `bb plugin dev [path]` — recursive `fs.watch` → 300ms debounce → rebuild → `POST /api/v1/plugins/reload`. **Rebuild-and-reload, not HMR** |
| CLI | `bb plugin {new,build,dev,reload,install,types}` |

### 1.11 Test harness

```ts
// backend — @bb/plugin-sdk/testing
const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
// harness: callRpc, runCli, fetchHttp, callAgentTool, submitInteraction, runService, logEntries
// uses a REAL better-sqlite3 handle — house rule: never mock sqlite

// frontend — @bb/plugin-sdk/testing/app
installTestPluginRuntime();
await loadPluginApp(() => import("../app"));
renderSlot(slot, props, { mockedHostState });
```

### 1.12 UI components

`packages/plugin-registry/registry.json` → 44 items → generated `r/*.json` **checked into git**, CI drift-checked. There is **no registry server**: a scaffolded plugin's `components.json` points `@bb` at a pinned GitHub raw URL (`.../desktop-v<bbVersion>/packages/plugin-registry/r/{name}.json`).

**In-repo plugins skip all of that and import `@bb/shared-ui` directly** (e.g. `plugins/tasks/.../new-task-dialog.tsx`: `from "@bb/shared-ui/dialog"`). Since we're developing in the fork, do this.

House rules from `plugins/tasks/WORKERS.md`: **Hugeicons only** (never Lucide, never emoji) · **bb theme tokens only** (no hex/oklch) · vendored Radix wrapped with `usePortalScopeProps()` · never keep `bb` in module state · **RPC is the only frontend→backend bridge; the frontend cannot use `bb.sdk`**.

### 1.13 Reference implementations, ranked

1. **`plugins/tasks/`** — a real official plugin with storage, CLI, skills, RPC, delegation, attachments, mentions, and directives all wired. Ships `WORKERS.md`, **a multi-agent build coordination doc for exactly our scenario**. Copy its shape.
2. **`examples/plugins/t3sidebar/`** — smaller and cleaner; best example of the test harness and of `bb.storage.migrate` used the SDK-native way (tasks uses a legacy hand-rolled migration table).
3. **`apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md`** — ~1600 lines covering the whole API surface. Have every coding agent read it.

### 1.14 Collision surfaces for parallel agents

**High frequency (the real risk):** `server.ts` (single composition root) · `app.tsx` (single `definePluginApp`) · a central route union if built (mirror `plugins/tasks/shell/routes.ts`) · the plugin's `package.json` (any dep touch → lockfile).

**One-time:** `apps/server/src/services/plugins/builtin-registry.ts` + two lockstep test files with hardcoded assertion lists (`official-plugins.test.ts` ~L87-102, `builtin-plugins.test.ts` ~L189-219) · `docs/official-plugin-release-process.md` · `turbo.json` if build ordering is needed.

**High blast radius:** `packages/plugin-sdk/src/{index,app,app-contract,backend-contract,rpc-contract}.ts` — only if we need new SDK capability.

**Codegen / lockfile churn:** `pnpm-lock.yaml` (**764KB, single root file, not human-mergeable — the #1 merge risk**) · `packages/plugin-sdk/bundled-types/*.d.ts` (6 generated files, CI `--check` gated, rolls up the entire contract surface) · `packages/plugin-build/src/runtime-export-manifest.ts` · `packages/plugin-registry/r/*.json`.

**Not a risk:** `pnpm-workspace.yaml` (glob auto-discovery), root `package.json`, CI workflows (no per-plugin jobs).

---

## PART 2 — FORGE & fs-api

### 2.1 Server shape

`FastMCP`, imperative registration — each module exposes `register(mcp, …)`, called from `create_server()` (`server.py:240-309`). **275 `@mcp.tool()` decorators across 60 files** (the "~272 across ~60" estimate was right). Pen-test lanes are gated, so a given deployment exposes fewer.

**Forge requires PostgreSQL at boot** (`FORGE_DB_URL`) — missing or unreachable and it refuses to start (`server.py:127-140`, `344-380`).

**Transports:** `stdio` (default), `sse`, `streamable-http`. Host/port `FORGE_SERVER_HOST` (127.0.0.1) / `FORGE_SERVER_PORT` (8000).

**Auth, three layers:**
- Client → Forge: bearer `FORGE_AUTH_TOKEN`, constant-time verified, **required for sse/streamable-http**, unused for stdio.
- Forge → platform: header **`X-Authorization`**, env `FINITE_STATE_AUTH_TOKEN` + `FINITE_STATE_DOMAIN`; base `https://{domain}/api`.
- Forge → AS: header **`X-API-Key: fsas_…`**, env `FORGE_AS_API_KEY`, base `FORGE_AS_URL` (origin only, no `/api`).

### 2.2 Return envelope and the file-path rule

Tools return Python dicts → JSON. Convention `{"success": bool, …}`; failures add `error`, often `status`/`code`.

**A tool returns a `file_path` when the payload is bulk, large, or persisted.** Confirmed:
- `get_findings` → `{success, file_path, findings_preview: findings[:10], count, offset, limit, metadata}`; on truncation adds `truncated`, `total_available`, `next_offset`
- `download_sbom` → always to disk
- `get_firmware_file` in `full`/`from_scan_id` mode **requires `save_to`** → `{saved_to, bytes_written}`; `range` without `save_to` returns a 256-byte hex `preview`

### 2.3 Async jobs

`get_job_status(job_id, tail_lines=50)` and `list_jobs(status?, tool?)`. Backgrounded: `pen_test_run`, `replay_pen_test`, `run_pentest_prep`, `run_full_assessment`, `run_cra_assessment`, `run_triage_pipeline`, `run_qabot_runbook`, `run_qabot_mission`, `export_exploitability_dataset`, and `run_recipe(background=True)`.

Status payload: `{job_id, status, tool, recipe, scope, environment, run_id, elapsed_seconds, log_path, log_tail, events, event_count}` plus `result` once terminal. **Terminal states: `COMPLETED`, `FAILED`, `TIMEOUT`** (running = `RUNNING`). Pentest jobs stream investigator telemetry (PLAN/REALIZE/RUN/ASSESS/DECIDE/SEAL) into `events`.

### 2.4 Rate limiting

Client-side only, process-local: bounded-concurrency asyncio semaphore + optional inter-request spacing, **default concurrency 8** (`FORGE_RATE_LIMIT_CONCURRENT`). No server-side or per-org cap encoded. Downstream the platform client honors 429 + `Retry-After` with exponential backoff to 64s, max 6 retries. `[UNVERIFIED]` whether the platform enforces per-org quotas.

### 2.5 Verdict table — what exists

| Capability | Tool | Verdict |
|---|---|---|
| Projects / versions | `list_projects`, `list_versions` | **EXISTS** |
| Findings | `get_findings`, `get_findings_summary` | **EXISTS** |
| **VEX single** | `set_vex_status` (`tickets.py:802`) | **EXISTS, first-class** |
| **VEX bulk** | `batch_set_vex_status` (`tickets.py:974`) | **EXISTS, first-class** |
| SBOM download | `download_sbom` | **EXISTS** |
| Components | `list_components`, `search_components`, `list_components_domain`, `as_list_project_sbom_packages` | **EXISTS** |
| Escape hatches | `as_raw_api`, `raw_api` | **EXISTS** |
| Firmware FS | `browse_firmware_filesystem`, `get_firmware_file` | **EXISTS (gated)** |
| Dynamic verify / pentest | `verify_dynamic`, `pen_test_run` | **EXISTS (gated)** |
| STP relay | 10 tools in `security_assessment` | **EXISTS** |
| TARA / threats / risks / mitigations / assets / zones / dataflows / components / requirements / attack-paths | `as_*` modules, full Tier-2 CRUD | **EXISTS** |
| CRA | `cra_lifecycle` (25 tools), `cra_srp`, `as_map_standard_to_requirements` | **EXISTS** |
| **Documents upload/list** | — | **MISSING** (and `as_raw_api` is JSON-only, so no upload path at all) |
| Standards/clauses CRUD | — | **NEEDS WRAPPER** (explicitly left to `as_raw_api`) |
| Filesystem tarball export | — | **MISSING** (confirmed; our filed ask) |

> **Correction to earlier notes:** first-class VEX wrappers do **not** need building. The "buried in workflow actions" claim is stale — `workflow_tools.py` also embeds VEX, but additively.

### 2.6 The signatures that matter

**Forge behavioral wrapper:** `set_vex_status(project_version_id, finding_id, status, response="", justification="", reason="", dry_run=False)` targets `PUT /public/v0/findings/{pv_id}/{finding_id}/status`. **FS-89 reconciliation:** this wrapper signature is not the plugin transport contract. The reviewed OpenAPI request has no `dryRun`, the route succeeds with 204/empty, and empty optional fields normalize to omission. Plugin dry-run remains a local policy/plan preview.

- `status`: `EXPLOITABLE, IN_TRIAGE, NOT_AFFECTED, FALSE_POSITIVE, RESOLVED, RESOLVED_WITH_PEDIGREE`
- `response`: `CAN_NOT_FIX, WILL_NOT_FIX, UPDATE, ROLLBACK, WORKAROUND_AVAILABLE`
- `justification`: `CODE_NOT_PRESENT, CODE_NOT_REACHABLE, REQUIRES_CONFIGURATION, REQUIRES_DEPENDENCY, REQUIRES_ENVIRONMENT, PROTECTED_BY_COMPILER, PROTECTED_AT_RUNTIME, PROTECTED_AT_PERIMETER, PROTECTED_BY_MITIGATING_CONTROL`

**`batch_set_vex_status(findings: list[{project_version_id, finding_id}], status, …)`** — **MCP tool caps at 500** (`_MAX_BATCH_SIZE`); groups by pv_id → `PUT /public/v0/findings/{pv}/status/set/bulk`, chunked at **5000** per HTTP call. Envelope `{status, summary{total,succeeded,failed}, results[{findingId,success,status,error}]}`. Falls back to per-finding PUTs on 404.

**`as_raw_api(method, path, body?, params?, reason, force=False)`** — `path` must start `/api/`; rejects `% ? # // ..`; **`reason` required**; **JSON only, no multipart/binary/SSE**; preflight **rejects any path already covered by a dedicated `as_*` tool** unless `force=True` (forced calls are journaled).

**`browse_firmware_filesystem(pv_id, path="/", depth=1, file_hash?, scan_id?)`** — tree or overview mode (`file_hash` set → arch + NX/PIE/RELRO/ASLR). `depth` clamped 1–8. Findings-read permission. **No bytes.** Error codes: `NO_FILESYSTEM_SCAN`, `PROJECT_VERSION_NOT_FOUND`, `STP_UPSTREAM_ERROR`.

**`get_firmware_file(pv_id?, file_hash, mode="meta", offset=0, max_bytes=4096, scan_id?, save_to?, from_scan_id?)`** — `mode ∈ {meta, range, full}`. **`range` capped at 131072 bytes (128 KiB).** **Byte modes require org-admin `VIEW_ANY_PROJECT_FILE`** → 403 otherwise. `full`/`from_scan_id` require `save_to` (streamed, path-traversal-checked).

**`verify_dynamic(pv_id, verdict_ids, budget_sec_per_verdict=60)`** — requires `FORGE_ALLOW_PENTEST=1` **and** `docker` on PATH. Env: `FORGE_QEMU_VERIFIER_IMAGE_TAG`, `FORGE_QEMU_BUNDLE_<PV_ID>`, `FORGE_QEMU_FIRMWARE_<PV_ID>`, `FORGE_QEMU_ADMIN_ALLOWLIST`, `FORGE_STP_BACKEND`.

**`pen_test_run(...)`** — 16 params; requires `FORGE_ALLOW_PENTEST=1` **and** the host `cve-evidence-verifier` binary on PATH. Backgrounds → `job_id`. `deployment_context` is STRICT, requiring `product_type, network_exposure, regulatory, deployment_notes, root_component_name, root_component_type`.

**STP relay (10):** `stp_callgraph`, `stp_find_binaries_with_symbols`, `stp_elf_dependency_graph`, `stp_binary_details`, `stp_kernel_config`, `get_scan_quality`, `stp_architecture`, `stp_configs`, `stp_services`, `stp_crypto`. All relay `GET /public/v0/projects/versions/{pv}/security-assessment/…`, each takes optional `scan_id`.

**AS create/update** returns `{"success": true, "<entity>": {...}, "review_status_set": bool}`. Attack-path **POST** collection has no wrapper (AS handler is a stub).

### 2.7 The firmware path — why the tarball ask is required, not nice

```python
# qemu_dynamic.py:103-123
def resolve_firmware_root(pv_id: str) -> Path:
    override = os.environ.get(f"FORGE_QEMU_FIRMWARE_{pv_id}")
    if override: return Path(os.path.expanduser(override))
    if pv_id not in _DEMO_FIRMWARE_ROOTS: raise ValueError(...)   # no download, no API fetch
    return Path(_DEMO_FIRMWARE_ROOTS[pv_id])
```

**No fetch fallback.** Firmware must be staged locally out of band. `resolve_bundle_path()` behaves identically for `FORGE_QEMU_BUNDLE_<PV_ID>`.

**`standalone_unpack.py`** (`finite-state-stp/services/unpack/`):
`python3 standalone_unpack.py <file> [-d OUT] [-o OUT.json] [--max-depth 12] [--no-json] [--verbose|--quiet]`; host wrapper `scripts/standalone_unpack.sh` runs it in `localhost:5000/services-unpack:latest`.

`snapshot.json`: `input_file`, `input_sha256`, `file_tree[]{file_path,file_hash,file_name,mime_type,full_type,file_size}`, `unpack_metadata{<hash>}{tried,tried_version,used,used_version[,error_type,error_msg]}`, `errors[]`.

**Not pip-installable.** Requires the FACT-extractor Docker image (p7zip 17.05, binwalk+libyara, simg2img, skopeo/umoci, `fact_helper_file`, entropython, minifs-extractor). "Standalone" means no ArangoDB/RabbitMQ/object-store — not "no binaries." Golden fixtures at `services/unpack/tests/integration/snapshots/`.

**No bulk export endpoint exists.** The only firmware HTTP surface is per-file: `filesystem/{tree,overview,content,file}`. Combined with the 128 KiB cap and the admin gate, **per-file materialization of a large rootfs is not viable** — hence local unpack as the primary path.

### 2.8 Concurrency and write semantics (verified in `finite-state-platform`)

**(a) TARA head-version + content-hash.** RPCs take `p_expected_head_tara_version_id` and `p_expected_working_hash`. SQLSTATE `40001`/`23505`/`55000` → **HTTP 409**:
```json
{"error":"TARA state conflict","code":"stale_tara_state",
 "message":"The live TARA state changed while this operation was in flight. Refresh and try again."}
```
`apps/web/src/app/api/projects/[projectId]/_lib/tara-version-control.ts:588-617`.

**(b) `review_version` (bigint).** `transition_review_lifecycle(..., p_expected_version)`. SQLSTATE `P0001` → 409. `review/bulk/route.ts:149-163`.

**(c) Standards.** Same mechanism — `p_expected_versions: [row.review_version ?? 0]`. **The token is `review_version`, not a separate `entity_version` write column** (a column named `entity_version` exists, but only on review-lifecycle audit/event tables). *Corrects the specs' naming.*

**`tara_snapshot_semantic_payload(p_entity_type, p_row, p_id_replacements)`** — IMMUTABLE SQL, migration `20260721100000_add_tara_version_control_foundation.sql:1533-1590`. Strips: `id, project_id, organization_id, org_id, updated_at, embedding, processing_started_at, processing_by, source_chat_run_id, needs_reanalysis, stale_reason, last_synced_at, synced_at, sync_status, sync_error, sbom_component_count, vulnerability_count, critical_vuln_count, has_exploit_intel, severity_order`; plus `created_at` (+ `processing_status`) for most types; `attack_path` also drops `route_signature`; `source_document` drops only `created_at`. Then applies `p_id_replacements`. **This is our YAML serializer's exclusion list.**

**Bulk limits, corrected:**

| Endpoint | Limit |
|---|---|
| `/review/bulk` | **100** (Zod `.max(100)`, unique) — *specs said 500* |
| VEX bulk | **500 at the Forge tool**, 5000 at the platform endpoint |
| VEX clear bulk | list of findingIds |
| "deletes ≤100" | `[UNVERIFIED]` — no distinct capped delete endpoint found; AS deletion uses `?mode=cascade\|detach` with a 409 `DeletionImpact` contract instead |

**`begin_tara_trial(live, expected_head, config, schema_version)`** — Postgres RPC, migration `20260721110000_add_tara_trial_apply_rollback.sql:808`. **Agents-API-only**, called solely from `apps/agents/src/api/routers/workflows.py:891`. Clones live→trial, snapshots `trial_base`, **rejects if `expected_head ≠ current head`**.

`prepare_tara_trial_apply` computes a true three-way diff over **base / trial / current**, emitting per entity `trial_change_kind`, `changed_fields`, `base_payload`/`trial_payload`/`current_payload`, and flags `protected_live` + `has_conflict`. `apply_tara_trial(trial, message, expected_head, expected_working_hash, resolutions)` atomically re-checks head + full live fingerprint, applies non-conflicting changes plus explicit resolutions, clears derived summaries where a conflict keeps live state, appends a `trial_apply` head, tears down the trial. No-op trials auto-discard. Lifecycle: `preparing → running → ready → applied|discarded`, plus `failed`/`cancelled`. Docs: `docs/TARA_TRIAL_RUNS.md`.

> This is the mechanism SPEC 01 wants to reuse rather than reimplement. Exposing it beyond the agents API remains the highest-leverage platform ask.

### 2.9 Mock-server raw material

1. **Two OpenAPI specs.** Platform: `finite-state-forge/.claude/skills/finite-state-api/openapi.yaml` — 3.0.3, **134 paths, 151 schemas**, `X-Authorization`, server `{baseUrl}` default `/api`; prose companion `SKILL.md` (89 KB). AS: `finite-state-forge/docs/as-reference/as-openapi-2026-05-12.json` — v1.0.0, **80 paths, 125 schemas**. **Read `docs/as-reference/README.md` first** — the AS spec only emits routes with registered Zod schemas, so item-level CRUD for Assets/AttackPaths/Zones/DataFlows, DELETE on Components/Requirements, the `?mode=cascade|detach` contract, and the 409 `DeletionImpact` response are all missing. **Rule: handler wins over spec.**
2. **`finite-state-forge/tests/fixtures/as_route_manifest.json`** — 24 curated AS routes with `path`/`methods`/`handler_file`/`covered_by_tool`, pinned to `finite-state-platform@031f2ab9`. The single most useful artifact for the AS mock's route table.
3. **Client contracts.** `api_client.py` — `X-Authorization`; `get_all(page_size=10000, max_pages=200)` unwrapping `{"items"|"scans":[...]}` or a bare list. `as_client.py` — `X-API-Key`; envelope `{success:true, data:{items,total,page,pageSize,hasMore}}`, `page` 1-based, `pageSize` camelCase; unwrapped by `tools/_as_common.py:unwrap()`.
4. **Quirks the mock must reproduce:** `/findings/{pv}/{fid}/cves` returns a **CVE-keyed dict**, not a list · severity counts nest as `{"bySeverity":{...},"total":N}` · CSV export ends `# rows_written=N rows_skipped=M` · bulk-VEX envelope as above.
5. **Reusable fakes:** the `httpx.MockTransport` builder repeated ~10× (canonical `tests/core/test_robustness.py:98-110`, `tests/core/test_findings.py:13-21`) · AS tool harness `_build_mcp()` in every `tests/test_as_*_tools.py` · narrow `FakeAPI` classes (`tests/test_vex_bulk_set.py:16`). Artifact fixtures: `tests/fixtures/vex_recommendations.json`, `remediation_package.json`.
6. **Caveats:** **no** pydantic/dataclass models pin HTTP response shapes (everything is `dict[str, Any]`); **no** VCR/respx cassettes; **no** wholesale fake platform server. Build path: generate from OpenAPI → patch AS gaps from the route manifest → layer the `tests/core/` MockTransport payloads as known-live-drift corrections.

---

## PART 3 — CONSOLIDATED CORRECTIONS TO SPECS 00–06

| # | Spec claim | Reality | Status |
|---|---|---|---|
| 1 | Forge needs `set_finding_vex`/`bulk_set_vex` wrappers | Already exist first-class | Corrected — dependency removed |
| 2 | Manifest = `{name, server, app, skills, themes}` | `.strict()`, also requires `description` + `branding`; `engines` outside `bb` | Corrected |
| 3 | Migrations are `NNNN_*.sql` files | `bb.storage.migrate(db, string[])`, inline, append-only | Corrected |
| 4 | Action tools are "gated by bb's tool-approval prompt" | No per-tool approval exists | Corrected — gate is architectural |
| 5 | Bench-as-bb-host mechanism `[UNVERIFIED]` | `bb.sdk.hosts.createJoinCode()`; target must run `host-daemon`; threads server-initiated | Resolved |
| 6 | Review bulk ≤500 | **100** | Corrected |
| 7 | VEX bulk ≤500 | 500 at tool, 5000 at platform | Clarified |
| 8 | Standards use `entity_version` | `review_version` via `p_expected_versions` | Corrected |
| 9 | Firmware bytes fetchable via API | Admin-gated, 128 KiB ranged cap, `full` needs `save_to` | Corrected — local unpack is primary |
| 10 | Documents reachable via `as_raw_api` | `as_raw_api` is JSON-only; no upload path | Corrected — plugin-local in v1 |
| 11 | `deletes ≤100` | Not found | `[UNVERIFIED]` |
| 12 | Directive attrs are typed | Always `string` | Corrected |
| 13 | Realtime has channels | Global fan-out, client filters | Clarified |
| 14 | `bb.http` is the main bridge | `bb.rpc` is | Clarified |
| 15 | Themes registered in `definePluginApp` | Declared in manifest only | Corrected |
