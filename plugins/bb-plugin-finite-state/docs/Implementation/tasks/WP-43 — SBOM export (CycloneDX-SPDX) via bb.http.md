# WP-43 — SBOM export (CycloneDX/SPDX) via bb.http

**Lane:** L5 Bill of Materials · **Spec refs:** SPEC 04 §2.4, §5.5–5.6, §7.3, §7.7 · SPEC 00 §5, §9–10 · RECON §1.2, §2.2, §2.5 · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-41 · **Blocks:** WP-64, WP-67
**Produces a FROZEN artifact:** no — implements a binary route and CLI handler already wired by WP-41

## Files you own

    plugins/bb-plugin-finite-state/lanes/bom/sbom/export.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/export-http.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/export-cli.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/export.test.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/export-http.test.ts
    plugins/bb-plugin-finite-state/lanes/bom/sbom/export-cli.test.ts

## Files you must not touch

server.ts, app.tsx, lanes/bom/register.ts, shared/contract.ts, lib/remote/types.ts, lib/store/schema.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

SBOM export is Platform-generated. The plugin must not reserialize cached component rows and accidentally lose relationships, metadata, or VEX decisions. The frozen `PlatformClient.downloadSbom` returns a `RemoteArtifact`; the plugin backend streams those bytes directly to the caller. RPC is JSON-only and is not a file transport, so this capability belongs on a local-auth bb.http route with a CLI twin.

This WP concerns software BOM export only. CycloneDX HBOM export is separate and remains schema-validation-gated in WP-46.

## What to build

1. Implement an export service that validates project version, format, and includeVex, then calls the exact frozen `PlatformClient.downloadSbom` method directly. Accepted formats are the variants actually supported by the reviewed Platform contract.
2. Adapt the returned `RemoteArtifact` to the local HTTP stream, preserving media type, size when known, and byte order without loading the complete artifact into memory. No upstream filesystem path is representable at this boundary.
3. Implement GET sbom/export with local authentication, query parameters projectVersionId, format, and includeVex. Return a sanitized Content-Disposition filename and nosniff headers.
4. Propagate typed Platform failures as safe HTTP responses. Never include credentials, an absolute path, a raw upstream exception, or file contents in an error body.
5. Support cancellation: client disconnect aborts the upstream/export stream and closes all request-owned resources. Delete only plugin-created partial output after completion or failure; never delete a user-selected destination.
6. Export the CLI command handler consumed by WP-64 for bom sbom export. Do not call bb.cli.register in this lane. With -o, stream atomically to a caller-selected file after validating it is within the CLI's permitted output boundary. Without -o, refuse binary output to an interactive terminal and explain how to provide a path. --json reports metadata, never embeds the SBOM bytes.
7. Preserve platform output byte-for-byte. includeVex defaults true, but the user can disable it explicitly.

## Interface contract

    export type SbomExportFormat = "cyclonedx-json" | "spdx";

    export interface SbomExportRequest {
      projectVersionId: string;
      format: SbomExportFormat;
      includeVex: boolean;
    }

    export interface SbomExportArtifact {
      filename: string;
      contentType: string;
      bytes: number | null;
      stream: NodeJS.ReadableStream;
      dispose(): Promise<void>;
    }

    export function createSbomExport(
      deps: ExportDeps,
      request: SbomExportRequest,
      signal: AbortSignal,
    ): Promise<SbomExportArtifact>;

    GET /api/v1/plugins/finite-state/http/sbom/export
      ?projectVersionId=<id>&format=cyclonedx-json|spdx&includeVex=true|false

    bb finite-state bom sbom export
      --version <project-version-id>
      --format cyclonedx|spdx
      [--include-vex|--no-include-vex]
      -o <file>

The route uses bb.http auth local. It is not mirrored as an RPC returning base64 or a server path.

## Acceptance criteria

- [ ] CycloneDX JSON and SPDX fixture exports are byte-identical to the mock platform artifacts.
- [ ] includeVex defaults true and is passed through exactly.
- [ ] A large fixture is streamed with bounded memory and correct content type/length when known.
- [ ] Content-Disposition cannot be injected by a malicious project/version string.
- [ ] The frontend receives neither an upstream path nor an absolute local path.
- [ ] CLI -o writes atomically and --json returns only export metadata.
- [ ] A disconnected client closes resources and cleans only request-owned temporary files.
- [ ] No cached-row SBOM serializer is introduced.

## Test plan

- export.test.ts — both formats, includeVex true/false, unsupported format typed error, and the direct Platform artifact streams without any path representation.
- export-http.test.ts — local auth, headers, byte identity, filename sanitization, large-stream backpressure, and a mid-stream connection reset cleans its request temp file.
- export-cli.test.ts — atomic -o write, existing destination policy, TTY refusal, and upstream 429 exhaustion returns a recovery-oriented error without a partial output.
- Mock fault path — a Platform artifact stream that resets mid-body fails closed, aborts the response, and removes only plugin-owned partial output.

## Do not

- Do not return base64, byte arrays, or filesystem paths over RPC.
- Do not generate CycloneDX/SPDX from sbom_components.
- Do not buffer the complete artifact in the renderer or plugin process.
- Do not add a raw request or route around `PlatformClient` for binary data.
- Do not weaken local authentication or reflect raw query values into headers.
- Do not register a second bb finite-state CLI; WP-64 owns the single command tree.

## Open questions

1. Confirm the exact SPDX media type and extension exposed by the frozen client fixture; the platform bytes and filename convention win.
2. WP-14's frozen `RemoteArtifact` is the sole upstream boundary; keep any local stream adapter request-owned and path-free.
3. If the upstream supports additional SPDX encodings, add them only through a contract amendment rather than accepting an ambiguous spdx string.
