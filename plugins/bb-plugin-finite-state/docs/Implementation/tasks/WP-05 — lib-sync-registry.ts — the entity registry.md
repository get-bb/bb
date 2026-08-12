# WP-05 — `lib/sync/registry.ts` — the entity registry

**Lane:** L0 Foundation · **Spec refs:** SPEC 01 §2, §4 · SPEC 02 §4 · SPEC 03 §5 · SPEC 04 §4 · SPEC 05 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-03, WP-04 · **Blocks:** WP-15, WP-17, WP-23, WP-36, WP-44
**Produces a FROZEN artifact:** **yes** — `lib/sync/registry.ts` freezes on merge

## Files you own
`plugins/bb-plugin-finite-state/lib/sync/registry.ts` *(FROZEN)*
`plugins/bb-plugin-finite-state/lib/sync/registry.test.ts`

## Files you must not touch
Both composition roots; `shared/contract.ts`; `lib/store/schema.ts`; `lib/remote/types.ts`; fixtures; `package.json`; `pnpm-lock.yaml`; every lane.

## Context
The registry makes entity classification a compile-time decision instead of a runtime guess. It tells serializers and sync adapters which records are VERSIONED, CACHED, OVERLAY, or ACTION-ONLY; where local state lives; and how stable business keys are encoded. Local-only is an explicit `localOnly:true` capability on a `server:"none"` VERSIONED or OVERLAY entry, never a fifth entity class. A missing entry forces a later lane to invent a parallel sync path, so this file is intentionally complete and frozen.

## What to build
1. Define the four entity classes and discriminated entry shapes. VERSIONED and OVERLAY entries declare their system of record explicitly as `server:"platform"|"assurance-studio"|"none"`; either named remote owner may participate in three-way sync/push through its narrow client. A `server:"none"` VERSIONED artifact remains authored, git-tracked, diffable, and reportable in a local semantic plan. `localOnly:true` is reserved for a `server:"none"` VERSIONED or OVERLAY entry that must never enter a semantic plan or remote push. CACHED entries name a frozen SQLite table or view. ACTION-ONLY entries persist nothing. Optional Forge Compute is an execution dependency, not a CRUD owner, and never appears in this registry's `server` union.
2. Register the v1 model inventory in the interface contract below. Table names must exist in WP-04. Inline overlays declare their parent; file entries use worktree-relative POSIX paths only.
3. Implement pure keys: `slugKey`, `reqIdKey`, `hbomIdKey`, `checkCodeKey`, `componentSlugKey`, and `routeSignatureKey`. Normalize Unicode to NFC, trim outer whitespace, reject empty/control/path-separator input, and preserve display case except where a key contract explicitly case-folds.
4. Implement the finding stable-key ladder's canonical encoders only: exact purl, exact case-folded `(name,group,version)`, and any-version `(name,group)`. WP-23 owns resolution/promotion policy. The canonical serialized key includes CVE but never project scope or finding UUID. Every scoped RPC and SQLite record carries `projectId` and `productVersionId` separately from this stable business key.
5. Export `EntityKind = keyof typeof ENTITIES`, typed predicates, and `entryFor(kind)`. Unknown runtime strings return a typed error rather than falling through.
6. Validate at module/test time: unique local destinations, all CACHED tables/views exist in the frozen storage-name union, inline parents exist, and ACTION-ONLY/`localOnly:true`/`server:"none"` entries cannot be selected for remote push. `hbomPart` is the deliberate single aggregate file `product-security/hbom/hbom.yaml`, not one file per part; it is not `localOnly` and is therefore visible to local plan/status. `hbomDoc` is a filtered read over the frozen `hbom_docs` view, not a second ledger.

## Interface contract
```ts
// lib/sync/registry.ts — FROZEN after WP-05.
export type EntityClass = "VERSIONED" | "CACHED" | "OVERLAY" | "ACTION-ONLY";
type KeyFn = (value: Readonly<Record<string, unknown>>) => string;
type RemoteTarget = "platform" | "assurance-studio" | "none";
type FileEntry = { readonly class: "VERSIONED" | "OVERLAY"; readonly server: RemoteTarget; readonly localOnly?: boolean; readonly dir: string; readonly key: KeyFn; readonly aggregate?: false };
type AggregateFileEntry = { readonly class: "VERSIONED"; readonly server: "none"; readonly localOnly?: false; readonly file: string; readonly key: KeyFn; readonly aggregate: true };
type InlineEntry = { readonly class: "OVERLAY"; readonly server: RemoteTarget; readonly localOnly?: boolean; readonly inline: string; readonly key: KeyFn };
type CacheEntry = { readonly class: "CACHED"; readonly table: CacheStorageName; readonly storageKind?: "table" | "view" };
type ActionEntry = { readonly class: "ACTION-ONLY" };
type LocalFileEntry = { readonly class: "VERSIONED" | "OVERLAY"; readonly server: "none"; readonly localOnly: true; readonly file: string };

export const ENTITIES = {
  component:   { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/components", key: slugKey },
  zone:        { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/zones", key: slugKey },
  dataflow:    { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/dataflows", key: slugKey },
  asset:       { class: "VERSIONED", server: "assurance-studio", dir: "product-security/architecture/assets", key: slugKey },
  threat:      { class: "VERSIONED", server: "assurance-studio", dir: "product-security/threats", key: slugKey },
  mitigation:  { class: "VERSIONED", server: "assurance-studio", dir: "product-security/mitigations", key: slugKey },
  requirement: { class: "VERSIONED", server: "assurance-studio", dir: "product-security/requirements", key: reqIdKey },
  hbomPart:    { class: "VERSIONED", server: "none", file: "product-security/hbom/hbom.yaml", key: hbomIdKey, aggregate: true },

  vexDecision:  { class: "OVERLAY", server: "platform", dir: ".fs/triage", key: findingStableKey },
  reqCheckMap:  { class: "OVERLAY", server: "assurance-studio", inline: "requirement", key: reqIdKey },
  checkParams:  { class: "OVERLAY", server: "assurance-studio", dir: ".fs/verification/checks", key: checkCodeKey },
  attackPath:   { class: "OVERLAY", server: "assurance-studio", dir: ".fs/attack-paths", key: routeSignatureKey },
  sbomLink:     { class: "OVERLAY", server: "assurance-studio", dir: ".fs/links", key: componentSlugKey },
  firmwareLink: { class: "OVERLAY", server: "none", localOnly: true, dir: ".fs/links", key: componentSlugKey },
  canvasLayout: { class: "VERSIONED", server: "none", localOnly: true, file: "product-security/layout/canvas.json" },

  finding:            { class: "CACHED", table: "findings" },
  sbomComponent:      { class: "CACHED", table: "sbom_components" },
  standardClause:     { class: "CACHED", table: "standards_clauses" },
  attackPathBody:     { class: "CACHED", table: "attack_paths" },
  verificationRun:    { class: "CACHED", table: "verification_runs" },
  verificationResult: { class: "CACHED", table: "verification_results" },
  firmwareMount:      { class: "CACHED", table: "firmware_mounts" },
  document:           { class: "CACHED", table: "document" },
  hbomDoc:            { class: "CACHED", table: "hbom_docs", storageKind: "view" },

  reviewTransition:     { class: "ACTION-ONLY" },
  verificationDispatch: { class: "ACTION-ONLY" },
  benchDispatch:        { class: "ACTION-ONLY" },
  firmwareMaterialize:  { class: "ACTION-ONLY" },
} as const satisfies Readonly<Record<string, FileEntry | AggregateFileEntry | InlineEntry | CacheEntry | ActionEntry | LocalFileEntry>>;

export type EntityKind = keyof typeof ENTITIES;
export type SemanticPlanEntityKind = { [K in EntityKind]: typeof ENTITIES[K] extends { localOnly: true } ? never : typeof ENTITIES[K]["class"] extends "VERSIONED" | "OVERLAY" ? K : never }[EntityKind];
export type RemotePushableEntityKind = { [K in EntityKind]: typeof ENTITIES[K] extends { server: "platform" | "assurance-studio" } ? K : never }[EntityKind];

export interface EntityScope { projectId: string; productVersionId: string; }
export interface FindingIdentity {
  cve: string; purl?: string | null;
  name: string; group?: string | null; version?: string | null;
}
export type FindingKeyTier = "purl" | "name-group-version" | "name-group-any-version";
export function findingStableKey(value: Readonly<FindingIdentity>, tier?: FindingKeyTier): string;
export function parseFindingStableKey(key: string): Readonly<{ cve: string; tier: FindingKeyTier; component: string }>;
export function entryFor(kind: string): (typeof ENTITIES)[EntityKind]; // throws UnknownEntityKindError
export function isSemanticPlanEntity(kind: EntityKind): kind is SemanticPlanEntityKind;
export function isRemotePushable(kind: EntityKind): kind is RemotePushableEntityKind;
```

If the WP-04 frozen schema uses a different table identifier, stop and file an amendment rather than aliasing it. If product review decides risks need an authored `risk` or `riskTreatment` entry, that is also a pre-freeze decision or post-freeze amendment; do not silently add it from supporting research.

## Acceptance criteria
- [ ] Every inventory entry above exists with its exact class and path/table semantics.
- [ ] Every VERSIONED/OVERLAY remote entry names `platform` or `assurance-studio` explicitly; `vexDecision` is Platform-owned, no `"as"` alias remains, and Forge Compute cannot be represented as a CRUD target.
- [ ] Every CACHED table/view resolves to storage declared by WP-04; `hbomDoc` points to the filtered `hbom_docs` view and never creates a second ledger.
- [ ] `hbomPart` is the aggregate `product-security/hbom/hbom.yaml` with `server:"none"`; it is locally diffable and visible to local plan/status, but `isRemotePushable("hbomPart") === false` and no plan item can invent an AS push target.
- [ ] Stable finding keys never contain a finding UUID and distinguish purl, exact fallback, and any-version tiers.
- [ ] Keys are deterministic across object key order and reject empty, control-character, or path-traversal identities.
- [ ] `isSemanticPlanEntity()` identifies authored non-local-only classes; `isRemotePushable()` additionally excludes CACHED, ACTION-ONLY, `localOnly:true`, and all `server:"none"` entries at compile time and runtime.
- [ ] No two file entries accidentally claim the same single-file destination; deliberate shared directories (`.fs/links`) remain distinguished by kind/key.
- [ ] Registry tests cover every entry; typecheck/test/lint/build is green before freeze.

## Test plan — `entity-registry-freeze`
- `inventory is byte-for-byte complete` — snapshot the ordered keys/classes/destinations.
- `finding key tier vectors` — purl, no-purl exact, missing-version any-version, Unicode and case-folding.
- `UUID changes do not change finding key` — two otherwise equal identities produce one key.
- `invalid key input fails closed` (**error path**) — empty CVE, slash, NUL, malformed serialized key.
- `cached tables are in schema union` — compile-time and runtime proof.
- `HBOM aggregate is locally planned, never remotely pushed` — one file holds multiple part keys, local plan/status can report changes, remote pusher selection rejects `hbomPart`, and `hbomDoc` reads the view.
- `unknown entity kind throws UnknownEntityKindError` (**error path**).

## Do not
- Do not implement WP-23's match/promotion algorithm here.
- Do not add backend UUIDs to stable keys.
- Do not classify canvas layout or firmware links as pushable.
- Do not invent an Assurance Studio target for HBOM; `server:"none"` is a deliberate product contract, not a TODO to route through `as_raw_api`.
- Do not work around a frozen-schema mismatch with casts or shadow registries.
- Do not edit after freeze without the amendment protocol.

## Open questions
1. Risks and risk treatments remain absent from the v1 registry. Adding either is a pre-freeze product decision or a post-freeze amendment; do not silently add it from supporting research.
2. Key encoding is settled: `fs1` followed by dot-delimited base64url encodings of NFC UTF-8 segments. Base64url segments never contain dots; project and product-version scope stay outside the stable entity key.
