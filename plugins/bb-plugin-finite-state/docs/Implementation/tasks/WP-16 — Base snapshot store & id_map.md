# WP-16 — Base snapshot store & id_map

**Lane:** L2 Sync · **Spec:** SPEC 01 §3, §9 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-04, WP-15 · **Blocks:** WP-17
**Produces a FROZEN artifact:** no

## Files you own
`plugins/bb-plugin-finite-state/lanes/sync/store/base-snapshot.ts`
`plugins/bb-plugin-finite-state/lanes/sync/store/id-map.ts`
`plugins/bb-plugin-finite-state/lanes/sync/store/idmap-mirror.ts`
`plugins/bb-plugin-finite-state/lanes/sync/store/base-snapshot.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/store/id-map.test.ts`
`plugins/bb-plugin-finite-state/lanes/sync/store/idmap-mirror.test.ts`

## Files you must not touch
`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, any other lane's directory.

## Context
Base is the load-bearing layer of the three-layer sync model (SPEC 01 §3): without a pristine snapshot at last pull there is no three-way diff, only last-write-wins. This WP is the data-access layer over the **frozen** `base_snapshot` and `id_map` tables (WP-04 owns the DDL — you write zero `CREATE TABLE` statements). Everything downstream — pull (WP-17), plan (WP-18), per-entity base advance during push (WP-19) — calls through these two stores.

## What to build
1. **`base-snapshot.ts`** — typed CRUD over `base_snapshot` (`entity_kind, entity_key, remote_id, payload, content_hash, pulled_at`; PK `(entity_kind, entity_key)`). `putMany` is one SQLite transaction; `advance` updates a single entity's base atomically (used after each successful push item — SPEC 01 §5 "per-entity base update"). `content_hash` is always computed via WP-15 `contentHash` on the semantic payload — never accepted from the caller unverified.
2. **`id-map.ts`** — typed CRUD over `id_map` (`entity_kind, entity_key, remote_id`). `learn()` records the UUID returned on create (SPEC 01 §4 rule 2); `resolve()` is what serializers' `idToSlug`/slug→UUID inversion is built from.
3. **`idmap-mirror.ts`** — write `.fs-sync/idmap.json` (gitignored machinery root, SPEC 00 §5 dot-root rule), a human-inspectable mirror of `id_map` (SPEC 01 §9). Deterministic ordering (kind, then key); atomic write (temp file + rename).
4. Use the real plugin database handle (`bb.storage.database()` passed in via ctx). WAL and busy_timeout come from the SDK defaults — do not reconfigure.

## Interface contract
```ts
// lanes/sync/store/base-snapshot.ts
import type Database from "better-sqlite3";
import type { EntityKind } from "../../../lib/sync/registry"; // FROZEN

export interface BaseRow {
  entityKind: EntityKind;
  entityKey: string;               // slug or canonical stable-key string — never a server uuid
  remoteId: string | null;         // null until created in the owning remote service
  payload: Record<string, unknown>; // semantic payload (already stripped, WP-15)
  contentHash: string;
  pulledAt: string;                // ISO8601
}
export class BaseSnapshotStore {
  constructor(db: Database.Database);
  get(kind: EntityKind, key: string): BaseRow | null;
  listKind(kind: EntityKind): BaseRow[];
  putMany(rows: BaseRow[]): void;                       // single transaction; all-or-nothing
  advance(kind: EntityKind, key: string, next: { payload: Record<string, unknown>; remoteId: string | null; pulledAt: string }): void;
  deleteKey(kind: EntityKind, key: string): void;
  replaceKind(kind: EntityKind, rows: BaseRow[]): void; // pull's "rewrite base/" — txn: delete kind + insert
}

// lanes/sync/store/id-map.ts
export interface IdMapEntry { entityKind: EntityKind; entityKey: string; remoteId: string; }
export class IdMapStore {
  constructor(db: Database.Database);
  resolve(kind: EntityKind, key: string): string | null;
  reverse(kind: EntityKind, remoteId: string): string | null;
  learn(entry: IdMapEntry): void;                       // upsert
  dump(): IdMapEntry[];                                 // ordered (kind, key)
}

// lanes/sync/store/idmap-mirror.ts
export function writeIdmapMirror(worktreeRoot: string, entries: IdMapEntry[]): void; // .fs-sync/idmap.json, atomic
```

## Acceptance criteria
- [ ] `putMany` with a row violating the PK mid-batch rolls back the entire batch (transaction proven by test).
- [ ] `advance` changes exactly one row and recomputed `content_hash` matches WP-15 `contentHash` of the payload.
- [ ] `replaceKind` leaves other kinds untouched (proven with two kinds seeded).
- [ ] `idmap.json` output is byte-deterministic for the same entries and written atomically (no partial file observable).
- [ ] Uses the real SQLite handle from the test harness (`createFakePluginHost`) — **sqlite is never mocked** (AGENTS.md).
- [ ] No DDL anywhere in this WP; typecheck/test/lint/build green.

## Test plan
- `base-snapshot.test.ts` — `putMany is atomic on constraint violation` (**error path**), `advance updates one row only`, `replaceKind scoped to kind`, `get returns typed payload round-tripped through JSON`.
- `id-map.test.ts` — `learn upserts`, `resolve/reverse invert`, `dump ordered deterministically`.
- `idmap-mirror.test.ts` — `atomic write leaves no temp file`, `deterministic bytes`, `unwritable directory surfaces a typed error, not a crash` (**error path**).
- Mock fault injection: N/A — no Forge surface in this WP (AGENTS.md rule); error paths above stand in.

## Do not
- Create or alter tables — `lib/store/schema.ts` is frozen (WP-04). If a column you need is missing, file an amendment.
- Store working-tree state here. Base holds *last-pulled server truth only*; working state lives in YAML.
- Write `idmap.json` anywhere but under `.fs-sync/` (it is machinery, not evidence — dot-root rule, SPEC 00 §5).
- Cache the `bb` handle or the DB in module state — constructor injection only (AGENTS.md backend rules).

## Open questions
1. Does the frozen schema give `base_snapshot.payload` a JSON check constraint or plain TEXT? Assumed plain TEXT with JSON serialization owned here. Verify on first read of `lib/store/schema.ts`.
