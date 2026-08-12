# WP-51 — Firmware UX — pull job, status chip, binary opener, version diff

**Lane:** L6 Firmware · **Spec refs:** SPEC 05 A1, A4–A5 · SPEC 00 §7, §10 · RECON §1.2, §1.3, §2.6–2.7 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-48, WP-49, WP-07 · **Blocks:** WP-61, WP-64, WP-67
**Produces a FROZEN artifact:** no — consumes firmware services and frozen RPC contracts

## Files you own

    plugins/bb-plugin-finite-state/lanes/firmware/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/app/status-chip.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/app/materialize-dialog.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/app/binary-opener.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/app/version-diff.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/diff.ts
    plugins/bb-plugin-finite-state/lanes/firmware/status.ts
    plugins/bb-plugin-finite-state/lanes/firmware/app/**/*.test.tsx
    plugins/bb-plugin-finite-state/lanes/firmware/diff.test.ts

## Files you must not touch

app.tsx, server.ts, frozen contracts/store/context/remote-service files, lanes/firmware/register.ts, package.json, pnpm-lock.yaml, another lane, or the root .gitignore.

## Context

Firmware is shown through bb's native file tree, not a replacement browser. This WP supplies the materialization job UX, readiness/status, a safe binary opener, and manifest-to-manifest version diff. Local image plus standalone unpack is the primary call to action. API metadata/per-file access is visibly a fallback.

The frontend uses RPC and HTTP only. It cannot inspect filesystem paths through bb.sdk. Realtime progress is a nudge; a reconnect refetches authoritative status.

## What to build

1. Replace the firmware frontend registration stub. Register the binary fileOpener and the agreed status-chip/sidebar surface; do not create a redundant firmware nav panel unless the frozen app contract already declares one.
2. Build a materialize dialog that defaults to Local image. It selects an input through the host's safe file workflow and runs WP-48. API fallback is a secondary option with admin/range/no-bulk limitations in copy.
3. Model statuses: not_materialized, hashing, unpacking, validating, ingesting, ready, ready_with_gaps, metadata_only, stale, and error. Display file/error counts, source, input digest, and current firmware digest when available.
4. Subscribe to firmware:progress and firmware:changed as hints. Filter by pvId and refetch status. On reconnect, status must recover without replaying missed messages.
5. Reveal ready rootfs in the native file tree. Never expose absolute rootfs paths in UI or agent messages.
6. Register a binary opener for ELF, extensionless executable, and firmware binary types using manifest MIME/full type rather than extension alone. Show architecture, size, SHA-256, mode/owner, setuid/setgid, cached security features, and a 256-byte hex preview. Never render raw binary as text.
7. If bytes are absent in API metadata-only mode, offer Hydrate this file. Handle admin 403 with the exact elevated-permission/local-unpack recovery.
8. Implement manifest version diff: added, removed, changed hash, and unchanged. Include size and cached security-feature deltas where available. Virtualize unbounded results and offer filters by operation/type/security regression.
9. Implement backend status/diff/CLI service outputs consumed by WP-64. Diff reads sidecars only and works offline.
10. Design loading skeleton, empty next step, retryable error with stale data, and unconfigured states for every component.

## Interface contract

    export interface FirmwareStatusView {
      pvId: string;
      source: "standalone_unpack" | "api" | null;
      state:
        | "not_materialized" | "hashing" | "unpacking" | "validating" | "ingesting"
        | "ready" | "ready_with_gaps" | "metadata_only" | "stale" | "error";
      files: number;
      materializedFiles: number;
      errors: number;
      inputSha256: string | null;
      artifactHash: string | null;
      message?: string;
    }

    export interface FirmwareDiffItem {
      path: string;
      operation: "added" | "removed" | "changed";
      beforeHash: string | null;
      afterHash: string | null;
      beforeSize: number | null;
      afterSize: number | null;
      securityRegressions: string[];
    }

    export interface FirmwareDiffResult {
      fromPvId: string;
      toPvId: string;
      items: FirmwareDiffItem[];
      total: number;
      unchanged: number;
      cursor?: string;
    }

    export function getFirmwareStatus(deps: FirmwareUiDeps, pvId: string): Promise<FirmwareStatusView>;
    export function diffFirmware(deps: FirmwareUiDeps, fromPvId: string, toPvId: string, cursor?: string): FirmwareDiffResult;

    bb finite-state firmware pull <pv-id> --image <firmware-file> [--max-depth 12]
    bb finite-state firmware pull <pv-id> --source api [--scan <scan-id>]
    bb finite-state firmware status <pv-id> [--json]
    bb finite-state firmware hydrate <pv-id> <path>...
    bb finite-state firmware diff <from-pv-id> <to-pv-id> [--json]

BinaryOpener accepts a workspace file identity and self-fetches metadata. It never accepts caller-supplied analysis fields.

## Acceptance criteria

- [ ] Local standalone unpack is the default materialize action and API is clearly labeled fallback.
- [ ] Status survives reconnect and comes from authoritative RPC, not signal history.
- [ ] Ready-with-gaps, metadata-only, and stale are not styled or worded as complete.
- [ ] Binary files open in a metadata card with bounded hex preview, never raw text.
- [ ] A byte 403 shows the org-admin requirement and local-unpack path.
- [ ] Version diff is offline, paged/virtualized, and reports security-feature regressions with labels.
- [ ] Absolute cache paths never reach frontend-visible data.
- [ ] All four UI states, Hugeicons, bb tokens, and shared UI rules are satisfied.

## Test plan

- status-chip.test.tsx — complete state matrix, progress hint/refetch, reconnect, stale data, and wrong-pv signal ignored.
- materialize-dialog.test.tsx — local default, API warning, cancellation, extractor prerequisite error, and double-submit prevention.
- binary-opener.test.tsx — ELF metadata, extensionless match, bounded preview, missing bytes hydrate action, 403 recovery, and unknown MIME falls back safely.
- diff.test.ts — added/removed/changed/unchanged, stable paging, hash equality, size delta, security regression, and corrupt sidecar returns one-side unavailable without crashing.
- Performance — 30,000-node manifests diff within the agreed budget and mounted UI rows remain bounded.

## Do not

- Do not build a custom firmware tree.
- Do not call bb.sdk from the frontend, render absolute paths, or treat realtime as a data stream.
- Do not make Hydrate all through the API available.
- Do not dump binary bytes into a text editor or request more than 128 KiB for preview.
- Do not use a ready/green visual for a partial or metadata-only mount.

## Open questions

1. Confirm the exact host slot for a persistent firmware status chip; use a sidebar/header action already declared by WP-03 rather than amending app.tsx.
2. Security features may be absent for locally unpacked files until Tier 0 analysis runs. Render Unknown and do not infer from MIME.
3. The safe file-selection interaction for an input outside the worktree depends on the host contract. Do not accept a raw arbitrary browser path.
