# WP-47 — Firmware cache layout, manifest.sqlite & content addressing

**Lane:** L6 Firmware · **Spec refs:** SPEC 05 A1–A2.1, A5.3–A5.6 · SPEC 01 §2 · RECON §1.2, §2.7 · AGENTS.md firmware rules · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-04 · **Blocks:** WP-48, WP-49, WP-50, WP-51
**Produces a FROZEN artifact:** no — owns the per-version sidecar schema but consumes the frozen shared firmware_mounts registry and PluginContext boundary

## Files you own

    plugins/bb-plugin-finite-state/lanes/firmware/register.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/layout.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/manifest-schema.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/manifest.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/blob-store.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/mount-registry.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/path-safety.ts
    plugins/bb-plugin-finite-state/lanes/firmware/cache/**/*.test.ts

The registration file replaces WP-01's firmware backend stub and wires frozen firmware RPC/background services to lane-local modules. It exports CLI and action service functions for WP-64 and WP-60; it does not register either surface itself.
Where WP-48–51 modules do not exist yet, create only compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths; those WPs replace them in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, another lane, or the worktree .gitignore unless an approved WP-01 amendment explicitly delegates it.

## Context

The firmware mount is CACHED disk state, never git content. Local standalone unpack is the primary producer in WP-48; the API path in WP-49 can create metadata-only or partially hydrated mounts. Both must converge on one self-describing manifest so the native file tree, agent tools, version diff, and bench readiness use the same truth.

The canonical mount root is .fs-firmware/<pvId>/rootfs. The sidecar is .fs-firmware/<pvId>/manifest.sqlite. Blobs are SHA-256 addressed. To make the product's cross-version deduplication claim true, use a workspace-level .fs-firmware/blobs/<sha256> store and hardlink into version roots; a per-version compatibility link may exist, but bytes have one canonical blob path.

Firmware paths are attacker-controlled. Every path operation must be segment-safe, rooted, and symlink-aware.

## What to build

1. Replace the firmware backend registration stub and wire frozen firmware RPC/background seams to lane modules. Registration is reload-safe and uses ctx.service for shared handles. Export command handlers for WP-64 and the materialization action service for WP-60; do not call bb.cli.register or bb.agents.registerTool here.
2. Define layout helpers for mount root, rootfs, sidecar, global blobs, staging, and trash/recovery. Validate pvId before using it in a path.
3. Create a real per-pv SQLite sidecar with fs_meta and fs_node. Migrations are append-only TypeScript strings local to this lane. fs_meta records pv_id, scan_id, input_sha256, source, artifact_hash, fully_materialized, materialized_at, node_count, hydrated_count, admin_bytes_ok, and unpack_errors JSON.
4. fs_node records normalized absolute virtual path, node kind, file hash, size, MIME/full type, mode/uid/gid/setuid/setgid, symlink target, materialized, and per-node errors. Add indices by hash and materialized state.
5. Implement transactional manifest ingestion and page/batch upsert. A failed batch leaves the previous valid manifest state. Directory rows and symlinks never claim file bytes.
6. Implement a blob store that writes to a staging file, hashes while streaming, compares expected hash, fsyncs, and atomically promotes to .fs-firmware/blobs/<sha256>. Existing valid blobs are reused.
7. Link regular-file blobs into rootfs. Refuse paths containing NUL, traversal, absolute host prefixes, or symlink-parent escapes. Preserve firmware symlinks only when their target remains representable inside the virtual root; otherwise record an error and do not create an escaping link.
8. Update the frozen shared firmware_mounts row only after a coherent sidecar/rootfs commit. Its root_path points to the version rootfs and source is standalone_unpack or api.
9. Expose readiness queries: missing, metadata_only, partial, fully_materialized, stale, or invalid. Fully materialized requires every regular file row to have verified bytes; placeholders never count.
10. Verify .fs-firmware is ignored before creating a mount. If not ignored, fail with FIRMWARE_CACHE_NOT_IGNORED rather than polluting diffs.

## Interface contract

    export type MountSource = "standalone_unpack" | "api";
    export type MountReadiness =
      | "missing" | "metadata_only" | "partial"
      | "fully_materialized" | "stale" | "invalid";

    export interface FirmwareNode {
      path: string;
      kind: "file" | "directory" | "symlink";
      fileHash: string | null;
      size: number | null;
      mimeType: string | null;
      fullType: string | null;
      unixMode: number | null;
      symlinkTarget: string | null;
      materialized: boolean;
      errors: string[];
    }

    export interface FirmwareMount {
      pvId: string;
      source: MountSource;
      rootfsPath: string;
      manifestPath: string;
      inputSha256: string | null;
      artifactHash: string | null;
      readiness: MountReadiness;
      nodeCount: number;
      hydratedCount: number;
      errors: string[];
    }

    export function openManifest(worktreeRoot: string, pvId: string): FirmwareManifest;
    export function putBlob(
      worktreeRoot: string,
      source: NodeJS.ReadableStream,
      expectedSha256: string,
    ): Promise<{ path: string; reused: boolean }>;
    export function linkNode(mount: FirmwareMount, node: FirmwareNode, blobPath: string): Promise<void>;
    export function getMountReadiness(manifest: FirmwareManifest): MountReadiness;

    CREATE TABLE IF NOT EXISTS fs_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS fs_node (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      file_hash TEXT,
      size INTEGER,
      mime_type TEXT,
      full_type TEXT,
      unix_mode INTEGER,
      unix_uid INTEGER,
      unix_gid INTEGER,
      is_setuid INTEGER NOT NULL DEFAULT 0,
      is_setgid INTEGER NOT NULL DEFAULT 0,
      symlink_target TEXT,
      materialized INTEGER NOT NULL DEFAULT 0,
      errors TEXT
    );

    CREATE INDEX IF NOT EXISTS fs_node_hash ON fs_node(file_hash);
    CREATE INDEX IF NOT EXISTS fs_node_materialized ON fs_node(materialized);

The frozen `PluginContext` intentionally has no sidecar accessor. `bb.storage.database()` is the plugin-global DB; this lane owns `openManifest(worktreeRoot,pvId)` because the firmware sidecar is worktree-scoped. Resolve and validate the worktree root from the invoking RPC/CLI/action context; never guess it from process cwd.

## Acceptance criteria

- [ ] A mount is self-describing from rootfs plus manifest.sqlite and registered in firmware_mounts.
- [ ] Identical hashes across two versions reuse one canonical blob inode where hardlinks are supported.
- [ ] Blob promotion is atomic and rejects a hash mismatch without exposing corrupt bytes.
- [ ] Fully materialized is impossible while any regular file lacks verified bytes.
- [ ] Unpack and per-node errors remain queryable and affect readiness.
- [ ] Traversal and escaping symlink fixtures cannot write or link outside .fs-firmware/<pvId>.
- [ ] .fs-firmware ignore is verified before materialization.
- [ ] Real SQLite is used and sidecar migrations are idempotent.
- [ ] The active worktree root is supplied explicitly by a verified SDK execution context and validated before any path is opened.

## Test plan

- manifest.test.ts — empty/idempotent migrations, batch commit/rollback, readiness truth table, and corrupt SQLite opens as MOUNT_INVALID without deleting recovery data.
- blob-store.test.ts — streaming hash, atomic promotion, reuse, wrong expected hash, interrupted stream cleanup, and cross-version inode reuse where supported.
- path-safety.test.ts — traversal, NUL, absolute host path, Unicode normalization collision, symlink-parent escape, and safe internal symlink.
- mount-registry.test.ts — shared row advances only after coherent commit and stale/error counts are accurate.
- Integration — create a 10,000-node ignored mount and confirm git/bb diff sees no firmware files; failure to confirm ignore aborts before writing.

## Do not

- Do not put firmware bytes, sidecars, or placeholders in git.
- Do not treat metadata placeholders as hydrated files.
- Do not trust archive paths, hand-roll string prefix containment, or follow firmware symlinks during writes.
- Do not delete a corrupt or partial mount automatically; retain it for diagnosis/recovery.
- Do not create a second shared plugin schema for per-pv nodes.
- Do not register CLI commands, agent tools, mentions, or directives; their central WPs consume this lane's exported services.

## Open questions

1. Confirm the exact SDK execution-context field that supplies the active worktree root for RPC, CLI, and agent-action calls. If the current fork exposes no safe root, file an amendment rather than using process cwd.
2. Hardlinks may be unavailable on a remote/filesystem boundary. The fallback is a verified copy with reused=false; surface the lost deduplication rather than silently claiming it.
3. The exact artifact-hash algorithm needed by Forge is addressed in WP-50; input_sha256 and per-file hashes alone must not be mislabeled as that artifact hash.
