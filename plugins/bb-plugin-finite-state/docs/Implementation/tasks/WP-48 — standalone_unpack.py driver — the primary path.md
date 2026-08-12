# WP-48 — standalone_unpack.py driver — the primary path

**Lane:** L6 Firmware · **Spec refs:** RECON §2.7 · AGENTS.md Forge facts · SPEC 05 A1–A3, A5.1, X16 corrected by RECON · bb Feature Designs Feature 1 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-47 · **Blocks:** WP-50, WP-51, WP-53
**Produces a FROZEN artifact:** no — produces CACHED mounts using WP-47's sidecar contract

## Files you own

    plugins/bb-plugin-finite-state/lanes/firmware/unpack/driver.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/snapshot-schema.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/ingest.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/progress.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/driver.test.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/snapshot-schema.test.ts
    plugins/bb-plugin-finite-state/lanes/firmware/unpack/ingest.test.ts

## Files you must not touch

server.ts, app.tsx, frozen contracts/store/context/remote-service files, lanes/firmware/register.ts, any STP source checkout, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

This is the primary materialization path. RECON overrides SPEC 05's older API-first design: per-file API materialization of a large rootfs is not viable because byte reads require org-admin, ranged reads cap at 128 KiB, full reads require save_to, and no tarball endpoint exists.

standalone_unpack.py runs the full FACT extractor without ArangoDB, RabbitMQ, object storage, or SCA, but it is not pip-installable. It requires the FACT-extractor Docker image localhost:5000/services-unpack:latest and the documented host wrapper or an equivalent Docker invocation. The driver must be honest about that prerequisite.

## What to build

1. Implement the default firmware materialize service for a local firmware image. Input is an explicit user/worktree file path, project-version ID, optional scan ID, and maximum depth 1–12.
2. Preflight the input: regular file, readable, within an allowed environment/worktree or explicitly selected through the UI, and SHA-256 computed before execution. Do not pass untrusted strings through a shell.
3. Launch the documented standalone unpack wrapper asynchronously with an argv array and AbortSignal. Never use exec, shell interpolation, or synchronous child_process. Capture bounded stdout/stderr and translate progress without leaking host paths.
4. Run into a unique staging directory under .fs-firmware/<pvId>/staging. A cancellation or crash keeps a small diagnostic record but never promotes a half-written rootfs.
5. Validate snapshot.json completely: input_file, input_sha256, file_tree entries, unpack_metadata, and errors. The reported input digest must match the digest computed in step 2.
6. Ingest extracted regular files through WP-47's blob store, verify each declared file_hash, create manifest rows for directories/files/symlinks, and preserve virtual paths. Do not trust the extractor merely because it exited zero.
7. Preserve unpack_metadata and every global/per-node error in the sidecar. A usable partial extraction may be promoted as partial with visible gaps; it must never be marked fully materialized or safe for Tier 1.
8. Promote staging atomically to the version root only after snapshot validation and coherent manifest ingestion. Update firmware_mounts with source standalone_unpack, input digest, file/error counts, and timestamp.
9. Publish firmware:progress hints containing pvId, phase, done, and total. Phases are hashing, unpacking, validating, ingesting, and complete. Signals are hints; status comes from RPC.
10. Make re-run idempotent for an unchanged digest. A changed image for the same pvId creates a new staging generation and marks the old mount stale until the new generation promotes.

## Interface contract

    export interface LocalUnpackRequest {
      pvId: string;
      firmwarePath: string;
      scanId?: string;
      maxDepth?: number;
      force?: boolean;
    }

    export interface Snapshot {
      inputFile: string;
      inputSha256: string;
      fileTree: Array<{
        filePath: string;
        fileHash: string | null;
        fileName: string;
        mimeType: string | null;
        fullType: string | null;
        fileSize: number | null;
      }>;
      unpackMetadata: Record<string, {
        tried: string[];
        triedVersion?: string;
        used?: string;
        usedVersion?: string;
        errorType?: string;
        errorMsg?: string;
      }>;
      errors: unknown[];
    }

    export interface LocalUnpackResult {
      mount: FirmwareMount;
      reused: boolean;
      snapshotPath: string;
      warnings: string[];
    }

    export function runStandaloneUnpack(
      deps: UnpackDeps,
      request: LocalUnpackRequest,
      signal: AbortSignal,
    ): Promise<LocalUnpackResult>;

The production UnpackRunner points to the documented wrapper and FACT Docker image. Its configured path/image is operational configuration, not a secret and not committed per-project.

## Acceptance criteria

- [ ] Local standalone unpack is the default materialization mode exposed to callers.
- [ ] The driver uses the FACT Docker/wrapper path and never presents the script as pip-installable.
- [ ] Input and every extracted regular file are digest-verified before promotion.
- [ ] snapshot.json errors and unpack_metadata survive into the sidecar and UI status.
- [ ] Partial extraction is visible as partial and is rejected by Tier-1 readiness.
- [ ] Cancellation or extractor failure never replaces a prior coherent mount.
- [ ] An unchanged input digest is idempotent and reuses blobs.
- [ ] Commands use argv arrays with no shell interpolation.
- [ ] Path traversal in a snapshot cannot escape the staging/rootfs boundary.

## Test plan

- driver.test.ts — exact argv, Docker/wrapper missing error, nonzero exit with bounded stderr, cancellation, timeout, and unchanged-digest reuse.
- snapshot-schema.test.ts — golden snapshot, missing field, wrong input digest, duplicate/unsafe paths, malformed errors, and unsupported max depth.
- ingest.test.ts — blob/hash verification, errors preserved, partial readiness, atomic generation promotion, and previous mount retained on the 500th-file hash failure.
- Integration fixture — run the configurable fake wrapper against a small nested archive and assert native files plus manifest match snapshot exactly. Real Docker is opt-in, not required in unit CI.

## Do not

- Do not make API per-file hydration the default.
- Do not pip install or vendor a reduced unpacker.
- Do not execute through a shell, log absolute input paths unnecessarily, or trust snapshot paths.
- Do not hide extractor errors or call a partial tree fully materialized.
- Do not overwrite the current generation in place while unpacking.

## Open questions

1. Decide how the plugin discovers the STP host wrapper in packaged deployments: configured executable path versus a bundled launcher targeting the pinned Docker image. Do not assume a developer checkout exists.
2. Snapshot file_tree may omit explicit directory/symlink rows for some plugins. Preserve verified behavior in fixtures and derive only the minimum directory parents needed to lay out files.
3. Define retention for failed staging diagnostics and old coherent generations; default to bounded, recoverable retention rather than automatic deletion.
