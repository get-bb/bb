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
Base is the load-bearing layer of the three-layer sync model (SPEC 01 §3): without a pristine accepted snapshot there is no three-way diff, only last-write-wins. This WP is the data-access layer over the **frozen** project/version/generation-aware `base_snapshot`, `id_map`, `sync_state`, and `pull_generation` tables (WP-04 owns the DDL — you write zero `CREATE TABLE` statements). Everything downstream — staged pull/publication (WP-17), plan fences (WP-18), and exact per-entity base advance (WP-19) — calls through these stores.

## What to build
1. **`base-snapshot.ts`** — typed CRUD over `base_snapshot` (`project_id, project_version_id, entity_kind, generation_id, entity_key, remote_id, payload, content_hash, pulled_at`). `putStagingPage` is one transaction and never rewrites accepted rows. `advanceAccepted` checks accepted generation, current `base_revision`, and the item's expected content hash; it updates one exact entity and increments that project/version/kind revision in the same transaction. `content_hash` is always computed via WP-15 `contentHash`.
2. **`id-map.ts`** — typed CRUD over the same explicit project/version/generation key. `learnAccepted()` records the UUID returned on create; accepted resolve/reverse joins `sync_state`, cannot see staging, and reverse uniqueness includes project/version/generation.
3. **`idmap-mirror.ts`** — write `.fs-sync/idmap.json`, a human-inspectable mirror of one explicit project/version's accepted id maps. Include generation ids and base revisions; order deterministically and write atomically.
4. Use the real plugin database handle (`bb.storage.database()` passed in via ctx). WAL and busy_timeout come from the SDK defaults — do not reconfigure.

## Interface contract
```ts
// lanes/sync/store/base-snapshot.ts
import type Database from "better-sqlite3";
import type { EntityKind } from "../../../lib/sync/registry"; // FROZEN

export interface BaseRow {
  projectId: string;
  projectVersionId: string;         // storage-normalized; project level = PROJECT_LEVEL_VERSION_ID
  entityKind: EntityKind;
  generationId: string;
  entityKey: string;               // slug or canonical stable-key string — never a server uuid
  remoteId: string | null;         // null until created in the owning remote service
  payload: Record<string, unknown>; // semantic payload (already stripped, WP-15)
  contentHash: string;
  pulledAt: string;                // ISO8601
}
export class BaseSnapshotStore {
  constructor(db: Database.Database);
  getAccepted(projectId: string, projectVersionId: string, kind: EntityKind, key: string): BaseRow | null;
  listAccepted(projectId: string, projectVersionId: string, kind: EntityKind): BaseRow[];
  putStagingPage(projectId: string, projectVersionId: string, kind: EntityKind, generationId: string, rows: BaseRow[]): void;
  advanceAccepted(projectId: string, projectVersionId: string, kind: EntityKind, key: string, expected: {
    generationId: string; baseRevision: number; contentHash: string | null;
  }, next: { payload: Record<string, unknown>; remoteId: string | null; pulledAt: string }): number;
  deleteAccepted(projectId: string, projectVersionId: string, kind: EntityKind, key: string, expected: {
    generationId: string; baseRevision: number; contentHash: string;
  }): number;
}

// lanes/sync/store/id-map.ts
export interface IdMapEntry {
  projectId: string; projectVersionId: string; entityKind: EntityKind;
  generationId: string; entityKey: string; remoteId: string;
}
export class IdMapStore {
  constructor(db: Database.Database);
  resolveAccepted(projectId: string, projectVersionId: string, kind: EntityKind, key: string): string | null;
  reverseAccepted(projectId: string, projectVersionId: string, kind: EntityKind, remoteId: string): string | null;
  learnAccepted(entry: IdMapEntry, expected: { generationId: string; baseRevision: number }): number;
  dumpAccepted(projectId: string, projectVersionId: string): IdMapEntry[];
}

// lanes/sync/store/idmap-mirror.ts
export function writeIdmapMirror(worktreeRoot: string, value: {
  projectId: string; projectVersionId: string;
  acceptedGenerationIds: Readonly<Record<string, string>>;
  baseRevisions: Readonly<Record<string, number>>; entries: IdMapEntry[];
}): void;
```

## Acceptance criteria
- [ ] A staging-page constraint failure rolls back that page and leaves every accepted reader on the prior generation.
- [ ] `advanceAccepted` changes exactly one project/version/kind/key, checks its expected hash, recomputes `content_hash`, and increments only the matching revision transactionally.
- [ ] Base and id-map accepted reads observe the same pointer and never staging rows.
- [ ] Project-level null maps only through `PROJECT_LEVEL_VERSION_ID`; literal `"@project"` is rejected externally and never sent upstream.
- [ ] `idmap.json` output is byte-deterministic for the same entries and written atomically (no partial file observable).
- [ ] Uses the real SQLite handle from the test harness (`createFakePluginHost`) — **sqlite is never mocked** (AGENTS.md).
- [ ] No DDL anywhere in this WP; typecheck/test/lint/build green.

## Test plan
- `base-snapshot.test.ts` — `staging page atomic`, `accepted ignores staging`, `advance updates one scope row/revision`, `hash or revision mismatch rolls back`, `same key in two projects/versions remains distinct`.
- `id-map.test.ts` — `accepted learn/resolve/reverse`, `staging invisible`, `same remote id in two projects/versions does not collide`, `dump ordered`.
- `idmap-mirror.test.ts` — `atomic write leaves no temp file`, `deterministic bytes`, `unwritable directory surfaces a typed error, not a crash` (**error path**).
- Mock fault injection: N/A — no Forge surface in this WP (AGENTS.md rule); error paths above stand in.

## Do not
- Create or alter tables — `lib/store/schema.ts` is frozen (WP-04). If a column you need is missing, file an amendment.
- Store working-tree state here. Base holds *last-pulled server truth only*; working state lives in YAML.
- Write `idmap.json` anywhere but under `.fs-sync/` (it is machinery, not evidence — dot-root rule, SPEC 00 §5).
- Cache the `bb` handle or the DB in module state — constructor injection only (AGENTS.md backend rules).

## Open questions
1. `base_snapshot.payload` remains plain TEXT with validated canonical JSON owned here; do not add a second representation.
