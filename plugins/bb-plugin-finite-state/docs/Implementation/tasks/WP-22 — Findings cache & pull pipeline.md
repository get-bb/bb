# WP-22 — Findings cache & pull pipeline

**Lane:** L3 Findings & VEX triage · **Spec refs:** SPEC 02 §1–§4, §6.7, §8 · SPEC 01 §5 · RECON §2.2–§2.6 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-13, WP-04, WP-05 · **Blocks:** WP-23, WP-24, WP-27, WP-28, WP-30
**Produces a FROZEN artifact:** no — consume the frozen store schema, Platform interface, sync registry, and RPC contract without editing them.

## Files you own
```
plugins/bb-plugin-finite-state/lanes/findings/register.ts
plugins/bb-plugin-finite-state/lanes/findings/cache/{pull,query,activity,comments,types}.ts
plugins/bb-plugin-finite-state/lanes/findings/rpc.ts
plugins/bb-plugin-finite-state/lanes/findings/cache/*.test.ts
plugins/bb-plugin-finite-state/lanes/findings/{stable-key,overlay,policy,bulk,drift}/index.ts  # compiling stubs; replaced by WP-23/27–30
```

## Files you must not touch
`server.ts`, `app.tsx`, `shared/contract.ts`, `lib/store/schema.ts`, `lib/sync/registry.ts`, `lib/remote/types.ts`, `test/mock-remote/fixtures/**`, `package.json`, `pnpm-lock.yaml`, or another lane. Do not add columns or migrations when the frozen schema differs; file `AMENDMENTS.md` and stop.

## Context
The findings panel and every triage operation read a regenerable SQLite cache; no remote service is called from a render path. A finding UUID is only a Platform handle for one product version and is **ephemeral**. Preserve every returned row, including legitimate duplicates, and cache the component identity inputs needed by WP-23's stable-key ladder. WP-05 already freezes the canonical stable-key encoder, so this puller records the row's exact key without implementing resolution or promotion policy. YAML decisions are not stored here.

## What to build
1. Replace the findings backend stub with complete lane-local wiring for the cache puller and read RPCs. Import compiling module stubs for WP-23 and WP-27–30 now so this file never needs another lane to edit it.
2. Register a findings `CachePuller` whose factory receives only `PlatformClient`. Page `getFindings` through the frozen normalized async-page interface, resume from `sync_state`, and write one SQLite transaction per complete page.
3. Normalize each direct `PlatformClient` page only at this boundary. Preserve `uuid`, product/project ids, CVE or other finding id, type, component purl/name/group/version, scores, dataset/risk band/CWE and policy fields, KEV flags, reachability evidence, location, the current VEX tuple, version-specific comment summary, deletion flag, and `pulled_at`. Populate non-null `stable_key` only through WP-05's frozen `findingStableKey`: purl tier when purl exists, otherwise exact folded NVG. Normalize CWE membership into `finding_cwes`; do not reproduce the key codec, choose the any-version tier, or invent a risk band.
4. Replace the selected product version's cache atomically without deduplicating stable identities. A successful final page removes rows no longer returned; an interrupted pull leaves the last complete generation readable and resumable.
5. Expose cursor-paged cache queries and facet counts through the frozen RPC contract. Enforce `limit <= 200`, deterministic sort with a unique tiebreaker, and parameterized SQL for every filter.
6. Publish tiny progress hints on global realtime topic `fs-findings-pull`: `{pvId,page,of,phase:"fetch"|"write"|"done"|"error"}`. The frontend refetches; events never contain findings.
7. Return staleness metadata on every read. On upstream failure, retain and serve old rows with an error/stale banner contract rather than clearing the table.
8. Hydrate `finding_activity` and full comments on detail demand through the verified narrow `PlatformClient` methods, transactionally cache normalized paged audit events/comments, and serve the prior cache offline. Activity records carry actor/time/source/old/new tuples. Comment writes remain human RPC passthrough actions: after success refresh that finding's cached comments; on an ambiguous failure, do not retry automatically.
9. Support the four UI states in RPC output: loading/progress, empty, recoverable error with stale data, and unconfigured. Missing required Platform configuration may use `bb.status.needsConfiguration()`; configured-but-unreachable Platform returns a scoped `unreachable` connection state and retained stale cache instead of masquerading as missing configuration.

## Interface contract
```ts
export interface FindingsFilter {
  pvId: string;
  severity?: string[];
  reachability?: "reachable" | "unreachable" | "unknown";
  kev?: "kev" | "vc-kev" | "none";
  epssGte?: number;
  component?: string;
  cve?: string;
  triage?: string[];
  findingType?: string[];
  hasLocalChange?: boolean;
  cursor?: string;
  limit?: number; // default 100, maximum 200
}
export interface FindingsPage {
  items: CachedFinding[];
  total: number;
  nextCursor: string | null;
  facets: Record<string, Record<string, number>>;
  cache: { pulledAt: string | null; stale: boolean };
}
export async function pullFindings(
  deps: FindingsDeps,
  scope: { projectId: string; pvId: string },
  onProgress: (p: { page: number; of: number | null; phase: string }) => void,
): Promise<{ fetched: number; pages: number; pulledAt: string }>;
export function queryFindings(db: Db, filter: FindingsFilter): FindingsPage;
```
RPC method names and response envelopes come from frozen `shared/contract.ts`; adapt this internal shape rather than changing the contract.

## Acceptance criteria
- [ ] Pulling the 4,000-row seed version persists exactly 4,000 rows, including deliberate duplicates, and records one `pulled_at` generation.
- [ ] Every cached row has the WP-05 canonical exact stable key; no local codec, resolution ladder, or UUID fallback exists in this lane.
- [ ] No authored field or YAML decision is written to SQLite by the puller.
- [ ] A repeated identical pull is deterministic and does not grow the cache.
- [ ] Cursor paging has no gaps or duplicates under equal risk/severity values and rejects limits over 200.
- [ ] The filters required by SPEC 02 compile to parameterized indexed queries; representative queries over 4,000 rows complete under 50 ms in the test environment.
- [ ] Cache reads make zero remote calls and return staleness metadata.
- [ ] Detail audit/comments read from the cache offline; online hydration preserves attribution/paging, and comment mutations update the cache only after confirmed server success.
- [ ] Progress events are hints under 1 KiB and a final `done` causes one refetch.
- [ ] Typecheck, test, lint, and build gates pass without frozen-file changes.

## Test plan
`findings-cache-pull.test.ts`
- `pulls all pages and preserves duplicate rows`.
- `uses frozen purl or exact-NVG encoder and never UUID or any-version identity`.
- `second pull replaces generation without growth`.
- `429 Retry-After resumes and completes`.
- **Error path:** `connection reset between pages leaves the prior complete generation readable; retry resumes without half-page rows`.
- `missing Platform configuration reports needsConfiguration and does not erase cache`; configured-but-unreachable Platform reports `unreachable` and retains cache.

`findings-query.test.ts`
- `cursor order is stable`, `all filter combinations are parameterized`, `stale cache is returned with banner metadata`, and `limit 201 is rejected`.

`findings-activity-comments.test.ts`
- `activity hydration preserves actor/time/old/new and pages from SQLite`.
- `comments remain version-specific and cache refresh follows confirmed create/update/delete`.
- **Fault path:** connection reset during comment create is not retried; cache remains unchanged and the UI receives refresh-before-retry guidance.

## Do not
- Do not key authored behavior on finding UUIDs or add a uniqueness constraint on business identity.
- Do not parse YAML on each query; WP-27 supplies `overlay_index`.
- Do not call Platform—or any remote service—from frontend code or an RPC render loop.
- Do not implement stable-key resolution, overlay writes, policy, push, or drift beyond compiling stubs.
- Do not expose an agent push path.

## Open questions
1. The frozen schema is authoritative if its cache column names differ from SPEC 02's illustrative SQL; document a projection map in `types.ts` rather than migrating it.
2. `PlatformClient.getFindings` exposes normalized async pages; keep raw offset/cursor behavior inside the remote client, not `pull.ts`.
