# WP-17 — `pull` + `status` for one OVERLAY entity (GATE)

**Lane:** L2 Sync · **Spec:** SPEC 01 §2, §3, §5 (`pull`, `status`) · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-06, WP-13, WP-15, WP-16 · **Blocks:** WP-18, **WP-22 (L3 lane start)**, **WP-31 (L4 lane start)**
**Produces a FROZEN artifact:** no — but the `EntityAdapter` seam in `engine/adapter.ts` is **change-controlled after this gate**: any post-gate change to its exported types gets an `AMENDMENTS.md` entry and a broadcast, exactly as if it were frozen.

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/register.ts`
`plugins/bb-plugin-finite-state/lanes/sync/rpc.ts`
`plugins/bb-plugin-finite-state/lanes/sync/cli.ts`
`plugins/bb-plugin-finite-state/lanes/sync/engine/adapter.ts`
`plugins/bb-plugin-finite-state/lanes/sync/engine/pull.ts`
`plugins/bb-plugin-finite-state/lanes/sync/engine/status.ts`
`plugins/bb-plugin-finite-state/lanes/sync/entities/vex-decision.ts`
`plugins/bb-plugin-finite-state/lanes/sync/plan/index.ts` *(NOT_IMPLEMENTED stub — WP-18 replaces)*
`plugins/bb-plugin-finite-state/lanes/sync/push/index.ts` *(NOT_IMPLEMENTED stub — WP-19 replaces)*
`plugins/bb-plugin-finite-state/lanes/sync/conflicts/index.ts` *(NOT_IMPLEMENTED stub — WP-20 replaces)*
`plugins/bb-plugin-finite-state/lanes/sync/engine/pull.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/engine/status.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/entities/vex-decision.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/register.test.ts`

## Files you must not touch
`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, any other lane's directory.

## Context
This is the gate that lets L3 and L4 start the next day. It proves the three-layer model end-to-end on the hardest entity class (OVERLAY, via `vexDecision`) against the direct-Platform mock, and — more importantly — it ships the **adapter seam** through which every other lane plugs its entities into the engine without editing L2. Each adapter factory closes over only its owning narrow client; the sync engine is transport-agnostic.

## What to build
1. **`engine/adapter.ts`** — the seam (interface contract below): `EntityAdapter`, plus `registerAdapter` / `registerResolver` / `registerPusher` / `registerCachePuller`. TSDoc every export — L3/L4 agents build from this file's docs alone.
2. **`engine/pull.ts`** — `pull(scope, kinds?)` per SPEC 01 §5: for each adapter, stream remote entities via `fetchRemote` → `replaceKind` in `base_snapshot` (one transaction per fetched page) → invoke registered cache pullers (CACHED tables belong to their surface lanes; L3 registers the findings puller in WP-22) → fast-forward the working tree only if clean, otherwise report divergence and leave it alone → record `sync_state` cursor → publish realtime progress on `fs-sync-pull` (`{scope, kind, page, of, phase: "fetch"|"write"|"done"}`).
3. **`engine/status.ts`** — three lists, always in this order: **local** (working vs base) · **upstream** (remote vs base, using the freshest pulled base) · **conflicts** (keys present in both — key-level at this WP; WP-20 refines to field-level) — plus **orphans** (overlay keys whose canonical key no longer exists in the pulled server key set; WP-23's ladder later replaces this exact-match check via the resolver seam).
4. **`entities/vex-decision.ts`** — the first adapter. Its factory receives a narrow `PlatformClient`; `fetchRemote` closes over it, pages findings directly, and projects each row to `{status, justification, response, reason}` keyed by the frozen stable-key codec. `readWorking` parses `.fs/triage/**/*.yaml`. Default resolution is exact until WP-23 installs the ladder.
5. **`rpc.ts`** — handlers for the sync methods in the frozen contract (`sync.pull`, `sync.status`; `sync.plan`/`sync.push` return `{ok:false, error:{code:"NOT_IMPLEMENTED"}}` until WP-18/19). Method names/shapes per `shared/contract.ts`; the frozen file wins on divergence.
6. **`cli.ts`** — `bb finite-state pull [surface]` and `bb finite-state status [surface]` (verb-first, SPEC 00 §9), `--json` capable. Registered through the plugin's single CLI registration (composition ctx provides the hook; do not call `bb.cli.register` a second time).
7. **`register.ts`** — complete wiring: adapters, RPC handlers, CLI verbs, background file-watcher hooks (none yet), all pointing at the modules above and at the three stubs.

## Interface contract
```ts
// lanes/sync/engine/adapter.ts — THE SEAM. Change-controlled after the gate.
import type { EntityKind } from "../../../lib/sync/registry";  // FROZEN (WP-05)
import type { EntitySerializer } from "../serialize/serializer";

export interface SyncScope { projectId: string; pvId: string | null; }
export interface ServerEntity { key: string; remoteId: string | null; payload: Record<string, unknown>; }
export interface WorkingEntity { key: string; payload: Record<string, unknown>; file: string; }

export interface EntityAdapter {
  kind: EntityKind;                       // must exist in frozen ENTITIES
  klass: "VERSIONED" | "OVERLAY";         // CACHED refreshes via registerCachePuller; ACTION-ONLY has no adapter
  serializer: EntitySerializer;
  fetchRemote(
    scope: SyncScope,
    onProgress: (p: { page: number; of: number | null }) => void,
  ): AsyncIterable<ServerEntity[]>;       // one array per page; pull writes a txn per page
  readWorking(worktreeRoot: string): Promise<WorkingEntity[]>;
}

/** key → cached rows; entity-specific. vexDecision default = exact canonical-key match; WP-23 replaces it. */
export type KeyResolver = (key: string, scope: SyncScope) => Promise<
  | { resolved: true; detail: unknown }
  | { resolved: false }>;

export type CachePuller = (scope: SyncScope,
  onProgress: (p: { page: number; of: number | null }) => void) => Promise<void>;

export function registerAdapter(a: EntityAdapter): void;             // throws on duplicate kind
export function registerResolver(kind: EntityKind, r: KeyResolver): void;   // replaces default
export function registerPusher(kind: EntityKind, p: unknown): void;  // typed fully in WP-19 (EntityPusher)
export function registerCachePuller(kind: EntityKind, fn: CachePuller): void;

// lanes/sync/engine/pull.ts
export function pull(deps: EngineDeps, scope: SyncScope, kinds?: EntityKind[]): Promise<PullReport>;
export interface PullReport { kinds: Record<string, { fetched: number; baseRows: number }>; workingFastForwarded: boolean; divergence: string[]; }

// lanes/sync/engine/status.ts
export interface StatusReport {
  local:    { kind: EntityKind; key: string; fields: string[] }[];
  upstream: { kind: EntityKind; key: string; fields: string[] }[];
  conflicts:{ kind: EntityKind; key: string }[];   // key-level here; field-level lands in WP-20
  orphans:  { kind: EntityKind; key: string; file: string }[];
}
export function status(deps: EngineDeps, scope: SyncScope, kinds?: EntityKind[]): Promise<StatusReport>;
```
RPC method names/shapes come from frozen `shared/contract.ts`; adapter factories receive only the WP-06 client their lane owns. The engine never imports `RemoteServices` or a transport. Frozen files win on divergence.

## Acceptance criteria — this is a gate; each item must hold for L3/L4 to start tomorrow
- [ ] `harness.runCli(["finite-state","pull","triage"])` against the **mock Platform service** populates `base_snapshot` with one `vexDecision` row per fixture finding that carries a VEX tuple, keys matching the frozen registry's canonical form.
- [ ] `status` on a fixture with (a) one local YAML edit, (b) one upstream mock edit, (c) one key edited on both sides returns exactly: 1 local, 1 upstream, 1 conflict, in that order, plus 0 orphans.
- [ ] An overlay key absent from the pulled server key set appears under `orphans` with its file path.
- [ ] **Seam proof:** a test registers an adapter for a second registry kind (e.g. `requirement`) *entirely from test code* — zero edits to any `lanes/sync/` file — and `pull` + `status` run through it green. This is the property that unblocks L3/L4.
- [ ] `sync.pull` / `sync.status` RPC handlers respond per contract; `sync.plan` / `sync.push` return `NOT_IMPLEMENTED` (not a crash).
- [ ] Realtime progress events published on `fs-sync-pull`; payloads are tiny hints, never data (AGENTS.md realtime rule).
- [ ] Pull is resumable and page-atomic: kill mid-pull → base is coherent (whole pages only), re-run completes from `sync_state` cursor.
- [ ] `engine/adapter.ts` exports are fully TSDoc'd, including a worked "register your entity" example in the file header.
- [ ] Composition roots untouched; typecheck/test/lint/build green.

## Test plan
- `pull.test.ts` — `populates base from mock fixtures`, `txn per page (kill between pages leaves whole pages)`, **`429 with Retry-After: pull backs off and completes` (mock fault injection)**, **`mid-pull connection reset: base coherent, resume completes` (mock fault injection)**, `dirty working tree is left alone and reported`.
- `status.test.ts` — `three lists in order`, `local/upstream/conflict triple fixture`, `orphan detection`, `clean tree ⇒ all empty`.
- `vex-decision.test.ts` — `tuple projection matches fixture bytes`, `readWorking parses .fs/triage YAML`, `malformed YAML → SerializeError surfaced, pull continues for other files` (**error path**).
- `register.test.ts` — `seam proof: foreign adapter registered from test code round-trips pull+status`, `duplicate kind registration throws`.

## Do not
- Implement `plan` or `push` beyond NOT_IMPLEMENTED stubs — that's WP-18/19; keep the gate small.
- Reach into `lanes/findings/` or write the `findings` CACHED table — L3 registers its own cache puller (WP-22).
- Implement the tier ladder — exact-key matching only; the resolver seam is where WP-23 plugs in.
- Call a live remote service anywhere; every remote-touching test uses its owning mock (AGENTS.md).
- Let a failed adapter abort the whole pull — isolate per-kind failures into the report.

## Open questions
1. `PlatformClient.getFindings` is the normalized async-page contract. Offset/cursor details stay inside its implementation; the adapter consumes pages only.
2. "Fast-forward the working tree if clean" for OVERLAY: v1 semantics = rewrite `sync.base` blocks in YAML only when file is git-clean. Confirm with tech lead whether git-cleanliness is per-file or per-directory (assumed per-file).
