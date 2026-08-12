# WP-49 — API per-file fallback & admin-gate handling

**Lane:** L6 Firmware · **Spec refs:** SPEC 05 A2.2, A5.1–A5.3 · Direct APIs ADR · Platform API reference · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-47, WP-13 · **Blocks:** WP-51, WP-60
**Produces a FROZEN artifact:** no — consumes frozen `PlatformClient` and the firmware sidecar

## Files you own

    plugins/bb-plugin-finite-state/lanes/firmware/api/fallback.ts
    plugins/bb-plugin-finite-state/lanes/firmware/api/enumerate.ts
    plugins/bb-plugin-finite-state/lanes/firmware/api/hydrate.ts
    plugins/bb-plugin-finite-state/lanes/firmware/api/admin-gate.ts
    plugins/bb-plugin-finite-state/lanes/firmware/api/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, frozen contracts/store/context/remote-service files, lanes/firmware/register.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, any Platform/STP/Forge source, or another lane.

## Context

The direct Platform API path covers firmware already scanned upstream and individual requested bytes. It is not a practical whole-rootfs download strategy without a bulk export route. The frozen methods are `browseFirmwareFilesystem` and `getFirmwareFile`; range caps at 128 KiB, full mode streams a `RemoteArtifact`, and bytes require org-admin `VIEW_ANY_PROJECT_FILE`. Forge is not in this path.

These limits must be visible in behavior and copy. A non-admin tenant can still get a useful metadata-only mount, but must use WP-48 with a local image for a complete rootfs.

## What to build

1. Implement explicit API fallback materialization. Callers must choose source api; no automatic fallback from a failed local unpack without explaining the changed provenance.
2. Enumerate metadata by recursively crawling `PlatformClient.browseFirmwareFilesystem` with depth no greater than 8. Bound concurrency through the Platform limiter. Detect repeated/cyclic paths and response truncation.
3. Populate the WP-47 manifest with source api and metadata-only nodes. Do not create zero-byte regular files that native tools could mistake for content; create directories, and expose non-materialized files through manifest/UI affordances until bytes exist.
4. Hydrate only requested file paths or a bounded explicit set. Resolve path to file_hash from the manifest. For a 256-byte/diagnostic preview, range mode is allowed with max_bytes no greater than 131072.
5. For actual file materialization, stream the full-mode `RemoteArtifact` into request-owned staging, then hash-verify and promote through WP-47. No `save_to` or upstream-local path crosses the frozen client boundary. Never use a preview as content.
6. Detect the verified admin 403, set admin_bytes_ok false, leave metadata readable, and return FIRMWARE_ADMIN_BYTES_REQUIRED with the local-unpack recovery. Do not retry a permission failure.
7. Respect 429 Retry-After behavior supplied by WP-14 and make a crawl/hydration resumable. Progress signals contain counts only. Cancellation stops scheduling new work and preserves verified blobs.
8. Refuse an unbounded full-rootfs per-file request with API_FULL_MATERIALIZATION_UNSUPPORTED. Direct callers to local standalone unpack. A future tarball endpoint requires a separately verified contract and amendment.
9. Record scan id and stale state. Capture an artifact hash only when the reviewed direct Platform response exposes one; otherwise leave it null and use scan-id comparison. Forge is not the metadata source.

## Interface contract

    export interface ApiFallbackRequest {
      pvId: string;
      scanId?: string;
      mode: "metadata" | "files";
      paths?: string[];
    }

    export interface FirmwarePreviewRequest {
      pvId: string;
      path: string;
      offset?: number;
      maxBytes?: number;
    }

    export interface FirmwarePreview {
      path: string;
      fileHash: string;
      offset: number;
      bytesReturned: number;
      hex: string;
      truncated: boolean;
    }

    export function materializeFromApi(
      deps: ApiFirmwareDeps,
      request: ApiFallbackRequest,
      signal: AbortSignal,
    ): Promise<FirmwareMount>;

    export function previewFirmwareFile(
      deps: ApiFirmwareDeps,
      request: FirmwarePreviewRequest,
      signal: AbortSignal,
    ): Promise<FirmwarePreview>;

    export const API_RANGE_MAX_BYTES = 131072;

The lane adapter calls the exact frozen `PlatformClient` methods. Do not add a fictional search/export route or a generic request locally.

## Acceptance criteria

- [ ] API mode is explicitly labeled fallback and never selected as the default full-rootfs path.
- [ ] Enumeration uses only verified browse operations with depth 1–8 and is resumable.
- [ ] Non-materialized files cannot be mistaken for empty real files by native Read/Grep.
- [ ] Range requests reject maxBytes above 128 KiB.
- [ ] Full hydration streams a `RemoteArtifact`, verifies the file hash, then atomically promotes.
- [ ] A 403 produces a metadata-only mount, admin_bytes_ok false, and a local-unpack recovery message.
- [ ] An unbounded/full-rootfs API request is rejected before scheduling thousands of file calls.
- [ ] No tarball/search endpoint or artifact hash is invented.
- [ ] 429 and cancellation preserve completed metadata/blobs for resume.

## Test plan

- enumerate.test.ts — recursive depth clamp, truncation detection, duplicate directory loop, cancellation/resume, and malformed tree node.
- hydrate.test.ts — full uses save_to, 128 KiB range boundary, preview does not mark materialized, hash mismatch, and requested-path-not-found.
- admin-gate.test.ts — mock 403 sets metadata-only status and is not retried; metadata remains queryable.
- Fault injection — repeated 429 honors client exhaustion and returns resumable state; connection reset after one saved blob leaves that blob valid and later resume skips it.
- Guard test — a request equivalent to hydrate_all returns API_FULL_MATERIALIZATION_UNSUPPORTED with zero get_firmware_file calls.

## Do not

- Do not offer or implement full rootfs hydration through N per-file API calls.
- Do not call non-existent filesystem/export or filesystem/search routes.
- Do not exceed 128 KiB in range mode or buffer a full artifact into RPC/memory.
- Do not retry 403, hide the org-admin requirement, or label a metadata-only tree complete.
- Do not write placeholders that look like valid zero-byte files.

## Open questions

1. Recursive browse may be too chatty for extreme trees. This is an accepted fallback limitation until a verified bulk endpoint exists.
2. Decide a conservative maximum explicit paths per action. The initial recommendation is 100, with directories expanded only after showing the resulting count.
3. If a future reviewed Platform response includes an artifact hash, add it through a frozen-client amendment and test it; scan id remains the current fallback.
