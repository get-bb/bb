# AGENTS.md — `bb-plugin-finite-state`

*This file is read on every run. It is the standing contract for anyone — human or agent — writing code in this plugin. If something here conflicts with a work package, the work package wins for its own scope; if it conflicts with a SPEC, this file wins (it reflects code-level recon the specs predate).*

**Place this at `plugins/bb-plugin-finite-state/AGENTS.md` in the bb fork.**

---

## What this is

A bb plugin that turns bb from a coding IDE into the workspace where a connected product is designed, analyzed, secured, and proven. Nine surfaces (threat model, requirements, verifications, SBOM, HBOM, documents, verification bench, findings triage, sync) plus the firmware filesystem, in the same worktree as the source code, editable by both the human and the agent.

**The product principle that decides arguments:** *the agent and the human work on the same artifacts, through the same review flow, in one workspace.* If a feature needs the agent to have a private channel the human can't inspect, or needs the human to leave bb, it's wrong.

**Read before your first commit:** `IMPLEMENTATION PLAN — Master.md`, your own `tasks/WP-NN-*.md`, and the SPEC your lane implements. Skim `plugins/tasks/` in this repo — it is the reference implementation for nearly everything you'll need.

---

## Before you write a line

```bash
# from the repo root
pnpm install
pnpm exec turbo run typecheck test --filter=bb-plugin-finite-state
```

If that isn't green before you start, stop and say so. Don't build on a red tree.

---

## Non-negotiables

### 1. Never edit a composition root

`server.ts` and `app.tsx` were written **once**, completely, in WP-01. Every lane's registration call is already there, pointing at your stub.

```ts
// server.ts — DO NOT EDIT
export default async function plugin(bb: BbPluginApi) {
  const ctx = createPluginContext(bb);
  await registerRemoteServices(bb, ctx); // sole bb.settings.define owner; registers connections.status
  registerSync(bb, ctx);
  registerFindings(bb, ctx);      // ← you implement lanes/findings/register.ts
  registerProductSecurity(bb, ctx);
  registerBom(bb, ctx);
  registerFirmware(bb, ctx);
  registerBench(bb, ctx);
  registerDocuments(bb, ctx);
  registerAgentic(bb, ctx);
}
```

You implement `lanes/<yours>/register.ts`. You do not touch the root. **CI fails the build if a composition root changes without an `AMENDMENTS.md` entry.**

### 2. Never edit a frozen interface

| File | Owner |
|---|---|
| `shared/contract.ts` | WP-03 |
| `lib/store/schema.ts` | WP-04 |
| `lib/sync/registry.ts` | WP-05 |
| `lib/remote/types.ts` | WP-06 |
| `test/mock-remote/fixtures/**` | WP-08 |

Need one changed? **Stop. Write to `AMENDMENTS.md`:** the interface, the change, why the current shape can't work, which lanes are affected. Then work on something else in your WP. Do not edit locally and do not work around it with a cast.

### 3. Stay in your directory

You own `lanes/<yours>/` and your tests. That's it. Anything outside `plugins/bb-plugin-finite-state/` needs a `FORK-DELTA.md` entry and a very good reason.

### 4. No new dependencies

Dependencies were frozen after WP-09 — `pnpm-lock.yaml` is 764KB, ordering-sensitive, and not human-mergeable, so every casual `pnpm add` costs someone an hour. Need a package? File an amendment. Someone batches lockfile changes daily.

`zod` is pinned repo-wide to **4.3.6** by a root override. Do not add another.

### 5. The agent never pushes

**There is no `fs_sync_push` tool and there will never be one.** bb has no per-tool approval mechanism — recon confirmed the registration contract has no `requiresApproval` field and bb's generic approval UI is not configurable per tool. So the human gate is **architectural, not a setting**: the capability simply does not exist in the agent's toolset.

Agent write tools mutate **local YAML only**. Three tools are the enumerated exception and may invoke server-side actions — `fs_verification_run`, `fs_bench_run`, `fs_firmware_materialize` (byte modes). They are ACTION-ONLY: they invoke, they don't mutate the model. **Adding a fourth requires a human decision recorded in `AMENDMENTS.md`.**

---

## How things actually work here (recon-verified — trust this over the specs)

### Manifest

The `bb` key is validated with **`.strict()`**. Unknown keys fail the load. `description` and `branding` are **required** — the specs omitted them.

```jsonc
{
  "name": "bb-plugin-finite-state",
  "version": "0.1.0",
  "engines": { "bb": ">=0.9", "bbPluginSdk": "^0.4.1" },  // ← outside the bb key
  "bb": {
    "name": "Finite State",
    "description": "Design, analyze, secure, and prove connected products.",  // required
    "branding": { "icon": "./assets/fs-icon.svg" },                           // required
    "server": "./server.ts",
    "app": "./app.tsx",
    "skills": ["skills"],
    "themes": [{ "id": "fsds-dark", "name": "Finite State Dark", "css": "./themes/fsds-dark.css" }]
  }
}
```

### Storage and migrations

Migrations are **inline TypeScript string arrays**, append-only, tracked in `_bb_migrations`. There is no `migrations/NNNN_*.sql` convention for plugins.

```ts
const db = bb.storage.database();               // <dataDir>/plugins/finite-state/data.db
bb.storage.migrate(db, MIGRATIONS);              // append-only; never reorder or edit a shipped statement
```

Use real SQLite in tests. **Never mock sqlite** — that's a house rule from `plugins/tasks/WORKERS.md` and it's a good one.

`bb.storage.kv` exists for small JSON (≤256KB/row). Use it for cursors and preferences, not data.

### Frontend ↔ backend

**`bb.rpc` is the bridge, not `bb.http`.** Standard Schema contracts, served at `POST /api/v1/plugins/finite-state/rpc/<method>`, envelope `{ok:true,result} | {ok:false,error:{code,message,issues?}}`.

```ts
bb.rpc.register(contract, handlers);   // backend
const { data } = useRpc(...);          // frontend
```

`bb.http` is for **binary and large payloads only** — file uploads, XLSX/SBOM export streams. Mounted at `/api/v1/plugins/finite-state/http/<path>`, default `auth: "local"`. You get a raw Hono `Context`.

**The frontend cannot use `bb.sdk`.** RPC is the only path. Validate every input server-side.

### Realtime

```ts
bb.realtime.publish("findings:changed", { projectId });   // backend
useRealtime("findings:changed", handler);                  // frontend
```

**There are no per-channel subscriptions in v1** — the server fans out to every connected client and the client filters. So: treat a signal as *a hint to refetch*, never as a data channel, and keep payloads tiny. House naming style is `<entity>:changed`.

### Agent tools

```ts
bb.agents.registerTool({
  name: "fs_findings_query",
  description: "…",
  parameters: z.object({ /* zod is the validated path */ }),
  async execute(params, ctx) {
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});
```

Return `string` or `{content: PluginAgentToolContentPart[], isError?: boolean}`. Tool sets apply at **next session start**, not hot-added mid-session.

### Directives

```ts
app.slots.messageDirective({ id: "fs-finding", component: FindingDirectiveCard });
```

`id` must match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`. **Attributes arrive as strings, always** — `Readonly<Record<string,string>>`, untrusted. Parse and validate them yourself. Components are ordinary React, so hooks and async fetching work.

### Mentions

Triggers available: `@ # $ ! ~`. `search()` runs server-side as the user types, **time-boxed at 2s**, failure-isolated. `resolve()` runs once at send time and returns `{context: string}` attached to the prompt — **throwing from `resolve()` blocks the send**, so never let it throw.

### Hosts (the bench)

`bb.hosts` is **tunnel-only** — `ensureSharedPortTunnel`, `declareSharedPorts`. It does not enroll.

Enrollment goes through the SDK escape hatch: `bb.sdk.hosts.createJoinCode()` — the same call bb's own "Add a machine" dialog makes. **The target machine must run bb's `host-daemon` binary** and redeem the code. Threads are always server-initiated onto the daemon; you cannot make an already-running external process "become" a thread.

### CLI

```ts
bb.cli.register({
  name: "finite-state",          // lowercase, not a reserved name
  summary: "…",
  commands: [ /* metadata only — rendered in help without executing plugin code */ ],
  run(argv, ctx) { /* … */ },
});
```

bb auto-generates a `plugin-commands` skill from the `commands` metadata. **Keep those summaries good — agents read them.** One registration per factory execution.

### Skills

`SKILL.md` with frontmatter `name` + `description`. **The directory name must exactly equal the frontmatter `name`.** Precedence is project > user > plugin > builtin, and name collisions are excluded — so namespace ours (`fs-triage`, not `triage`).

---

## UI rules

- **bb theme tokens only.** `bg-card`, `text-muted-foreground`, `border-border`. No hex, no oklch, no arbitrary Tailwind colors. Lint enforces it.
- **Hugeicons only.** Never Lucide. Never emoji.
- **Import from `@bb/shared-ui`** — we're in the monorepo, so don't vendor via the shadcn registry.
- Vendored Radix gets `usePortalScopeProps()`.
- **Every domain component takes an `id` and self-fetches.** This is the convention that makes the directive layer nearly free: the same `<ThreatCard id="THREAT-22"/>` renders in a panel and inside an agent message. No wrappers, no prop-drilling.
- **Virtualize anything unbounded** (TanStack Virtual): findings, SBOM, filesystem, logs.
- **Four states, always designed:** loading (skeleton, not spinner) · empty (what to do next) · error (what failed + retry) · unconfigured (`bb.status.needsConfiguration`).
- Density: compact rows, monospace for identifiers (CVE, hash, purl), right-aligned numerics, severity as **color plus label** — never color alone.

---

## Backend rules

- **Never keep `bb` in module state.** Register everything inside the factory; the factory reloads. Use `onDispose` for cleanup.
- **Never call any external service from a render path.** Platform and Assurance Studio calls happen in the plugin backend through named clients; optional Forge calls are compute jobs only. Sync into SQLite and serve paged RPC from there.
- Every list endpoint is paged: `{items, total, cursor}`.
- Chunk and rate-limit every bulk operation; make it resumable.
- Secrets live in plugin secret settings (0600 file). Never in the worktree, never in a diff, never in a log line.

---

## Remote-service facts worth knowing before you call them

- **Routine reads and writes go direct:** Platform operations use `PlatformClient`; TARA, requirements, verification records, and AS SBOM packages use `AssuranceStudioClient`. Forge is never a fallback proxy for either.
- **The route surface is closed.** There is no `as_raw_api`, generic fetch, arbitrary path/method API, or generic MCP tool invocation available to lanes, panels, CLI, or agents.
- Platform bulk VEX accepts up to 5000 records; the client chooses smaller resumable chunks and preserves per-item partial failures. Review bulk is **100** where the verified AS handler says so.
- Firmware bytes require the upstream permission documented in the vendored Platform references. **Per-file materialization of a large rootfs is not viable** — the primary path is STP's `standalone_unpack.py` locally.
- There is **no verified `/filesystem/export` tarball endpoint.** It's a filed ask, not a route to invent.
- Forge is optional compute only. Its async jobs return `job_id`; poll the named job method; terminal states are `COMPLETED | FAILED | TIMEOUT`; the result rides on the status response.
- Platform, AS, and Forge have independent settings, health, rate limits, and failure domains. Missing AS/Forge configuration disables only dependent surfaces/actions.
- Contract authority and provenance live in `docs/Implementation/api-reference/`; unknown or undocumented routes require reviewed evidence and a frozen-interface amendment.

**Develop against the remote-service mocks** (`test/mock-remote/`), not live services. Contract suites cover Platform, AS, and optional Forge compute independently. Full Forge needs PostgreSQL at boot and must not be required for core plugin tests.

---

## Testing

```bash
pnpm exec turbo run test --filter=bb-plugin-finite-state
```

- Vitest. `*.test.ts` / `*.test.tsx` beside the code.
- Backend: `createFakePluginHost({pluginId})` from `@bb/plugin-sdk/testing` → `{bb, harness}`. The harness gives you `callRpc`, `runCli`, `fetchHttp`, `callAgentTool`, `submitInteraction`, `runService`, `logEntries`.
- Frontend: `installTestPluginRuntime()` + `loadPluginApp(() => import("../app"))` + `renderSlot(...)` from `@bb/plugin-sdk/testing/app`.
- Real SQLite always.
- **Test the error paths.** The mocks can inject 409 `stale_tara_state`, 403 on firmware bytes, 429 with `Retry-After`, partial bulk failure, strict-schema rejection, mid-push connection reset, and an unavailable optional Forge compute service. If your WP touches a remote client, at least one test uses the relevant fault.

---

## Before you call a work package done

```bash
pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state
```

All four green, then check:

- [ ] Every acceptance criterion in the WP is satisfied — quote each one and say how
- [ ] No composition root touched
- [ ] No frozen interface touched
- [ ] No new dependency
- [ ] Error paths tested, not just the happy path
- [ ] All four UI states exist, if you built UI
- [ ] No secret, no absolute local path, no `console.log` left behind
- [ ] `[UNVERIFIED]` or `TODO` markers either resolved or explicitly listed in your summary

**Commit prefix: `fs plugin: `**

**If you're blocked, stop and say so.** A clear blocker written down beats a clever workaround every time — especially a cast that silences a type error at a frozen boundary. That kind of workaround is how nine parallel lanes quietly diverge.

---

## Things that will get a PR rejected

| Don't | Instead |
|---|---|
| Edit `server.ts` / `app.tsx` | Implement `lanes/<yours>/register.ts` |
| Edit a frozen interface | File an amendment |
| `pnpm add <anything>` | File an amendment |
| Call Forge from a panel or a render path | Sync to SQLite, serve RPC |
| Add a tool that pushes to the server | There is no push tool. By design |
| Hex colors, oklch, Lucide icons, emoji | bb tokens, Hugeicons |
| Mock SQLite | Use a real database |
| `as any` at a frozen boundary | File an amendment |
| Unpaged list endpoint | `{items, total, cursor}` |
| Silence a failing test | Fix it or report the blocker |
