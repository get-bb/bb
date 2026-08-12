# WP-01 — Repo scaffold, manifest & composition roots

**Lane:** L0 Foundation · **Spec:** SPEC 00 §3, §5, §11 · Master Plan §1–§4 · RECON §1.4, §1.10 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** — (root of the graph) · **Blocks:** WP-02…WP-70 (everything)
**Produces a FROZEN artifact:** yes — `server.ts` and `app.tsx` are FROZEN after this WP. So is `lib/context.ts` / `lib/app-context.ts`.

## Files you own
```
plugins/bb-plugin-finite-state/package.json                 # the manifest (bb key)
plugins/bb-plugin-finite-state/tsconfig.json
plugins/bb-plugin-finite-state/vitest.config.ts
plugins/bb-plugin-finite-state/server.ts                    # backend composition root — FROZEN
plugins/bb-plugin-finite-state/app.tsx                      # frontend composition root — FROZEN
plugins/bb-plugin-finite-state/lib/context.ts               # backend PluginContext — FROZEN
plugins/bb-plugin-finite-state/lib/app-context.ts           # frontend AppContext — FROZEN
plugins/bb-plugin-finite-state/AGENTS.md                    # copy the companion AGENTS.md here verbatim
plugins/bb-plugin-finite-state/assets/fs-icon.svg           # placeholder brand icon
plugins/bb-plugin-finite-state/skills/.gitkeep
plugins/bb-plugin-finite-state/.gitignore                   # .fs-sync/ .fs-firmware/ node_modules
```

You also create **compiling stubs** for every frozen artifact and every lane so the tree is green from cold. Each stub is later replaced by its owning WP:
```
plugins/bb-plugin-finite-state/shared/contract.ts           # stub → WP-03
plugins/bb-plugin-finite-state/lib/store/schema.ts          # stub → WP-04
plugins/bb-plugin-finite-state/lib/sync/registry.ts         # stub → WP-05
plugins/bb-plugin-finite-state/lib/remote/types.ts          # stub → WP-06
plugins/bb-plugin-finite-state/lib/remote/index.ts          # createRemoteServiceController → WP-14
plugins/bb-plugin-finite-state/lib/format.ts                # stub → WP-07
plugins/bb-plugin-finite-state/themes/fsds-dark.css         # stub → WP-07
plugins/bb-plugin-finite-state/lanes/remote/register.ts            + register.app.tsx
plugins/bb-plugin-finite-state/lanes/sync/register.ts              + register.app.tsx
plugins/bb-plugin-finite-state/lanes/findings/register.ts          + register.app.tsx
plugins/bb-plugin-finite-state/lanes/product-security/register.ts  + register.app.tsx
plugins/bb-plugin-finite-state/lanes/bom/register.ts               + register.app.tsx
plugins/bb-plugin-finite-state/lanes/firmware/register.ts          + register.app.tsx
plugins/bb-plugin-finite-state/lanes/bench/register.ts             + register.app.tsx
plugins/bb-plugin-finite-state/lanes/documents/register.ts         + register.app.tsx
plugins/bb-plugin-finite-state/lanes/agentic/register.ts           + register.app.tsx
```

## Files you must not touch
`apps/server/src/services/plugins/builtin-registry.ts` and its two test files (that is WP-02, the *other* sanctioned out-of-directory change). `pnpm-lock.yaml` beyond the one dependency-declaration commit. `turbo.json` unless build ordering forces it (note in `FORK-DELTA.md` if so).

## Context
This is the anti-collision keystone (Master Plan §3). The two composition roots are written **once, completely, here**, with every lane's `registerXxx(bb, ctx)` / `registerXxxApp(app, ctx)` call already present and pointing at a stub that returns cleanly. After this WP no lane ever edits a root — a lane implements its own `lanes/<name>/register.ts` and the wiring is already waiting. If the roots are wrong, nine agents serialize behind two files. The stubs for the frozen artifacts exist so `typecheck` is green from cold (G0 bar): each owning WP replaces its stub with real content, then freezes it.

## What to build
1. **The manifest** (`package.json`). Use the recon-verified shape exactly (RECON §1.4, AGENTS.md "Manifest"). The `bb` key is `.strict()` and **requires `description` and `branding`**; `engines` sits **outside** the `bb` key. Getting any of this wrong fails load *and* build (validated identically at both — RECON §1.4).
2. **Fix the Node conflict** (RECON §1.10, Master Plan §2): repo `.nvmrc` says 22.12.0, root engines say ≥22.19.0. Set the plugin's engine expectation to 22.19.0 and correct the repo `.nvmrc` to `22.19.0` — **this `.nvmrc` edit is the second (and only other) sanctioned out-of-directory change** (Master Plan §4.3); note it in `FORK-DELTA.md`.
3. **Declare all third-party dependencies once** (R1 dependency freeze). No lane may `pnpm add` after WP-09. The full set: `@modelcontextprotocol/sdk` (Forge MCP transport), `@tanstack/react-virtual` (tables/tree), `@xyflow/react` v12 + `elkjs` (canvas, lazy), `exceljs` (HBOM export, lazy), `yaml` (overlay serialization). `zod` is **pinned repo-wide to 4.3.6 by a root override — do not add a version, do not add a second zod** (RECON §1.10, AGENTS.md). `@bb/plugin-sdk` and `better-sqlite3` are **externals** provided by the monorepo (esbuild externalizes them — RECON §1.10); import, don't bundle.
4. **`tsconfig.json`** extends `@bb/tsconfig/base.json` (`strict`, `NodeNext`, ES2022, `noUnusedLocals`; `noUncheckedIndexedAccess` is **not** set — RECON §1.10). `customConditions:["source"]` resolves `@bb/*` to `src/` (no build step in dev/test).
5. **`vitest.config.ts`** via `defineWorkspaceTestConfig` from `vitest.shared.ts` (Vitest ^4.1.1). Real SQLite in tests, never mocked (house rule, AGENTS.md).
6. **`lib/context.ts`** — the backend `PluginContext` (see Interface contract). `createPluginContext(bb)` returns a ctx that memoizes the migrated DB and holds a generic cross-lane singleton registry (`service<T>`). Migration runs `bb.storage.migrate(db, MIGRATIONS)` importing `MIGRATIONS` from `lib/store/schema` (the WP-04 stub is `[]` at cold start). **Never keep `bb` in module state** (AGENTS.md) — it lives only inside ctx, created per factory execution.
7. **`lib/app-context.ts`** — the frontend `AppContext`. Minimal: `pluginId` plus RPC/navigation helpers. **The frontend cannot use `bb.sdk`** (RECON §1.12) — do not import anything backend (no `better-sqlite3`).
8. **`server.ts`** and **`app.tsx`** — the exact composition roots below. Nine backend registrations, nine frontend registrations, each pointing at a stub that returns cleanly. The backend factory is async only so it can await the one remote-registration bootstrap; the composition root itself never calls `bb.settings.define`.
9. **Nine lane stub pairs.** Each `register.ts` exports `registerXxx(bb, ctx): void` that does nothing (a `// TODO: <lane>` comment) and returns; each `register.app.tsx` exports `registerXxxApp(app, ctx): void` likewise. They must typecheck against the frozen ctx and the SDK builder types.
10. **`assets/fs-icon.svg`** — a simple placeholder (WP-07 may reskin). Manifest `branding.icon` points here.
11. **`.gitignore`** — reserve `.fs-sync/` and `.fs-firmware/` (gitignored machinery — SPEC 00 §5 dot-root rule); `.fs/` and `product-security/` are **tracked**.

## Interface contract
```ts
// server.ts — FROZEN. Amend only via AMENDMENTS.md + CONTRACT_VERSION bump broadcast.
import type { BbPluginApi } from "@bb/plugin-sdk";
import { createPluginContext } from "./lib/context";
import { registerRemoteServices } from "./lanes/remote/register";
import { registerSync } from "./lanes/sync/register";
import { registerFindings } from "./lanes/findings/register";
import { registerProductSecurity } from "./lanes/product-security/register";
import { registerBom } from "./lanes/bom/register";
import { registerFirmware } from "./lanes/firmware/register";
import { registerBench } from "./lanes/bench/register";
import { registerDocuments } from "./lanes/documents/register";
import { registerAgentic } from "./lanes/agentic/register";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const ctx = createPluginContext(bb);
  await registerRemoteServices(bb, ctx); // L1 — owns native settings + connections.status
  registerSync(bb, ctx);             // L2
  registerFindings(bb, ctx);         // L3
  registerProductSecurity(bb, ctx);  // L4
  registerBom(bb, ctx);              // L5
  registerFirmware(bb, ctx);         // L6
  registerBench(bb, ctx);            // L6
  registerDocuments(bb, ctx);        // L6
  registerAgentic(bb, ctx);          // L7
}
```
```tsx
// app.tsx — FROZEN.
import { definePluginApp } from "@bb/plugin-sdk/app";
import { createAppContext } from "./lib/app-context";
import { registerRemoteServicesApp } from "./lanes/remote/register.app";
import { registerSyncApp } from "./lanes/sync/register.app";
import { registerFindingsApp } from "./lanes/findings/register.app";
import { registerProductSecurityApp } from "./lanes/product-security/register.app";
import { registerBomApp } from "./lanes/bom/register.app";
import { registerFirmwareApp } from "./lanes/firmware/register.app";
import { registerBenchApp } from "./lanes/bench/register.app";
import { registerDocumentsApp } from "./lanes/documents/register.app";
import { registerAgenticApp } from "./lanes/agentic/register.app";

export default definePluginApp((app) => {
  const ctx = createAppContext();
  registerRemoteServicesApp(app, ctx);   // no-op stub — remote services are backend-only
  registerSyncApp(app, ctx);             // review/plan panel (/plugins/finite-state/sync)
  registerFindingsApp(app, ctx);
  registerProductSecurityApp(app, ctx);
  registerBomApp(app, ctx);
  registerFirmwareApp(app, ctx);         // fileOpener + firmware status chip
  registerBenchApp(app, ctx);
  registerDocumentsApp(app, ctx);
  registerAgenticApp(app, ctx);          // cross-cutting directives (::fs-plan) + shared wiring
});
```
```ts
// lib/context.ts — FROZEN.
import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { MIGRATIONS } from "./store/schema";

export const PLUGIN_ID = "finite-state" as const;

export interface PluginContext {
  readonly bb: BbPluginApi;
  readonly log: BbPluginApi["log"];
  /** Migrated, memoized shared plugin DB (<dataDir>/plugins/finite-state/data.db). */
  db(): Database.Database;
  /** Cross-lane memoized singletons — narrow remote services, watchers, limiters. */
  service<T>(key: string, factory: () => T): T;
}

export function createPluginContext(bb: BbPluginApi): PluginContext {
  const services = new Map<string, unknown>();
  let dbHandle: Database.Database | undefined;
  return {
    bb,
    log: bb.log,
    db() {
      if (!dbHandle) {
        dbHandle = bb.storage.database();
        bb.storage.migrate(dbHandle, MIGRATIONS);
      }
      return dbHandle;
    },
    service<T>(key, factory) {
      if (!services.has(key)) services.set(key, factory());
      return services.get(key) as T;
    },
  };
}
```

The per-product-version firmware sidecar is deliberately **not** part of this frozen context. Its path is worktree-scoped (`.fs-firmware/<pv_id>/manifest.sqlite`), while `bb.storage.database()` exposes only the plugin-global data DB. WP-47 opens and migrates sidecars from an explicitly validated worktree root through its own `openManifest(worktreeRoot, pvId)` service. Do not freeze a placeholder accessor here that a later lane would have to edit.
```ts
// lib/app-context.ts — FROZEN.
export const PLUGIN_ID = "finite-state" as const;
export interface AppContext { readonly pluginId: typeof PLUGIN_ID; }
export function createAppContext(): AppContext { return { pluginId: PLUGIN_ID }; }
```
```ts
// lanes/<name>/register.ts — the stub shape every lane starts from.
import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context";
export async function registerRemoteServices(_bb: BbPluginApi, _ctx: PluginContext): Promise<void> {
  // TODO(L1): direct clients, optional compute, settings/health. See WP-14.
}
```
```tsx
// lanes/<name>/register.app.tsx — the frontend stub shape.
import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context";
export function registerRemoteServicesApp(_app: PluginAppBuilder, _ctx: AppContext): void {
  // no-op — external services have no direct frontend registration.
}
```

**Amendment protocol:** a lane needing the root or ctx changed **stops and writes to `AMENDMENTS.md`** (interface, change, why the shape can't work, lanes affected). A human merges it, bumps `CONTRACT_VERSION` in `shared/contract.ts`, and broadcasts. Adding a *new lane* is the expected reason to amend a root; do not edit the root to work around a stub.

## Acceptance criteria
- [ ] `pnpm install` at repo root resolves the plugin via `pnpm-workspace.yaml`'s `plugins/*` glob with no manual registration (RECON §1.10).
- [ ] `pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state` is green from a cold clone.
- [ ] The manifest loads: `bb` key passes `.strict()`; `description` and `branding` present; `engines` outside `bb`; `themes[0].id === "fsds-dark"`. A test asserts the manifest parses against the SDK's `pluginPackageJsonSchema` shape.
- [ ] `server.ts` calls exactly the nine `registerXxx` functions in the order shown; `app.tsx` calls exactly the nine `registerXxxApp` functions.
- [ ] The backend root awaits `registerRemoteServices` before registering consumers, but contains no settings descriptors, client construction, health logic, or `bb.settings.define` call. WP-14 is the sole native-settings owner.
- [ ] Every stub `register.ts`/`register.app.tsx` typechecks against the frozen ctx and returns cleanly (no throws, no side effects).
- [ ] `.nvmrc` corrected to `22.19.0`; `FORK-DELTA.md` records this and no other out-of-directory change exists.
- [ ] Every third-party dependency in §3 is declared in `package.json`; no lane can build without them; `zod` is **not** re-versioned.
- [ ] `bb` is never referenced at module scope anywhere in the files you own (grep-clean).
- [ ] `.fs-sync/` and `.fs-firmware/` are gitignored; `.fs/` and `product-security/` are not.

## Test plan
`scaffold.test.ts`
- `manifest parses against the strict bb schema` — load package.json, assert required keys present.
- `manifest rejects an unknown bb key` (error path) — inject a stray `bb.foo`, assert the strict schema throws.
- `composition root registers all nine backend lanes` — spy the nine `registerXxx`, load `server.ts` under `createFakePluginHost`, assert each called once.
- `remote bootstrap resolves before consumer lanes` — hold the async stub, prove no later backend registration runs early, then release it; grep the root for zero `settings.define` calls.
- `frontend root registers all nine app lanes` — `installTestPluginRuntime()` + `loadPluginApp(() => import("../app"))`, assert nine `registerXxxApp` calls.
- `db() migrates once and memoizes` — call `ctx.db()` twice, assert one migrate call, same handle.
- `service() memoizes by key` (convergence) — factory runs once across two calls.

## Do not
- Do not implement any lane's logic — stubs only.
- Do not write real schema/contract/registry/forge content — those are WP-03/04/05/06; you ship compiling stubs.
- Do not add `custom_report_templates`, `AgentOS`, or any capability not in these specs.
- Do not use `bb.http` as the primary bridge or invent a theme-registration call — themes are manifest-only (RECON §1.3, §3 item 15).

## Open questions
- The exact `definePluginApp` / `PluginAppBuilder` type names are from RECON §1.3; confirm the import path (`@bb/plugin-sdk/app`) and builder identifier against `plugins/tasks/` before freezing. If they differ, this is a scaffold-time correction, not an amendment (the root has no dependents yet at WP-01).
- `bb.storage.database()` returning the dedicated `data.db` is per RECON §1.2; confirm the accessor name (`database()` vs `db()`).
