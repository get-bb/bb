# Vendored API references

These files are the implementation-time reference set for the Finite State bb plugin's direct remote clients. Six upstream API references are copied byte-for-byte from `finite-state-forge` at commit `5083a9d745e6d0e22166d2850e7e43fc3987c350` on 2026-08-12 so an implementation agent does not need a sibling checkout. The compute-only manifest is a self-contained reviewed extraction from that same commit; it records checksums for every source file used and explicitly marks the missing firmware-root method non-freezeable.

They are reference inputs, not generated plugin source. Do not edit a vendored file in place. Refresh it from its source, update the provenance and checksum below, then run the client contract tests.

## Authority order

1. A verified deployed route handler or generated customer API contract for the target environment.
2. The vendored OpenAPI snapshot for paths it actually documents.
3. The endpoint audit and API-gap notes for observed drift, missing OpenAPI coverage, and handler-only behavior.
4. Forge wrappers as behavioral examples only. They are not the plugin's transport contract.

For Assurance Studio specifically, the OpenAPI generator is materially incomplete. When the AS snapshot and the pinned route-handler audit disagree, the handler-backed audit wins. Never invent a route to fill a gap.

## Files

| File                                                          | Original source                                                                    | SHA-256                                                            | Purpose                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `finite-state-api-v0.3.0.openapi.yaml`                        | `.claude/skills/finite-state-api/openapi.yaml`                                     | `49eb706db94caf7a124a438722912e19b95932ed73677cedf2e4b3186a5523c5` | Complete customer API OpenAPI 3.0.3 snapshot                                                                    |
| `finite-state-api-v0.3.0.reference.md`                        | `.claude/skills/finite-state-api/SKILL.md`                                         | `362778457ba6902a32dcccf13ac1e472bb60c706a6c01d986c40ef09486cbdb1` | Human-readable endpoints, auth, filters, quirks, and examples                                                   |
| `finite-state-api-v0.3.0.endpoint-audit.md`                   | `docs/2026-06-17-fs-api-v0.3.0-endpoint-audit.md`                                  | `95498ab52f5242edf77c70241ba66f1f2e7b3669476877d2cfa2981496de0e57` | Spec-to-source drift audit and implementation corrections                                                       |
| `assurance-studio-openapi-2026-05-12.json`                    | `docs/as-reference/as-openapi-2026-05-12.json`                                     | `8b684395f3bc7545c41c24ebe3ac1a18e0e15a20c606198f7ba20b40c246a251` | AS OpenAPI 3.0.3 snapshot                                                                                       |
| `assurance-studio-openapi-notes.md`                           | `docs/as-reference/README.md`                                                      | `375f0378f6440f95fc9f4454f28569cdec9d3d64e54a3f0fa6bc29081159c324` | Snapshot provenance and incompleteness warning                                                                  |
| `assurance-studio-api-gaps.md`                                | `docs/as-api-gaps-for-forge.md`                                                    | `eca05c1016635bbfe3d1e3c77a47d1e4873d32fba49d9eeed6add74e9de9106f` | Handler-backed gaps and required workarounds                                                                    |
| `assurance-studio-fs-links-live-2026-08-14.md`                | FS-198 sanitized production read capture                                           | `980d9b87ca7bc2ed675f20a66502dd18a9e9567a96d270b9926eda7797c88a01` | API-key reachability, exact link shape, ambiguous reverse cardinality, and timestamp-offset validation          |
| `assurance-studio-tara-vocabulary-live-2026-08-14.md`         | FS-207 sanitized 20-project production TARA capture                                | `e4aa95585a8d5a65819fb98b090acd97b8a750eb156b5f19c3ddf3633cc3dec0` | Connected TARA vocabulary floors, nullability, scalar shapes, and bounded-open evidence                         |
| `assurance-studio-remote-projection-enum-audit-2026-08-14.md` | FS-207 executable projection, live-corpus reconciliation, and vendored-enum audit  | `45bd88509ab6e064c43ebedc18fecaacc1ded0d5a03f8ae8a15ad38296b701a4` | Grep-level disposition list for every AS remote-projection enum and per-kind page envelope                      |
| `platform-components-sweep6-2026-08-13.md`                    | FS-192 sanitized production read capture                                           | `d6d890936f369367a9c877b821c5c4d0a9290bc001077bbe6e4db2bcb51851a0` | Tenant-global component-list behavior, file-path identity shape, and documented project/version filter mapping  |
| `forge-compute-manifest-5083a9d7.json`                        | reviewed subset of the six Forge source/test files checksummed inside the manifest | `0a997e1a4d728a3dfe717e727042550b2b39437e9aac0300248ee9de9b5c5f21` | Closed compute/job MCP allowlist, exact request/response normalization, and non-freezeable root-preparation gap |

## Client ownership

| Remote system             | Authentication                                                                    | Plugin client           | Required for                                                                |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Finite State customer API | `X-Authorization` raw token                                                       | `PlatformClient`        | Projects, findings, VEX, SBOM, components, firmware, public STP relays      |
| Assurance Studio API      | `X-API-Key`                                                                       | `AssuranceStudioClient` | Architecture, threats, risks, mitigations, requirements, verification model |
| Forge runtime             | MCP transport bearer when remote; no extra bearer for explicitly configured stdio | `ForgeComputeClient`    | Optional QEMU verification, autonomous pen tests, Forge-owned job telemetry |

The frontend never calls any of these systems. Direct means the bb plugin backend calls the upstream REST API; panels and directives still read bounded data through typed `bb.rpc` from SQLite or tracked files.

## Plugin normalization corrections (FS-89)

- Platform single-finding VEX PUT and bulk clear are 204/empty operations and normalize to `Promise<void>`. The OpenAPI request schema has no `dryRun`; local preview/planning never reaches transport. Empty optional VEX fields normalize to omission.
- Remote paging is always `{continuation?,pageSize?}` in and `{items,total,next}` out. The adapter-owned continuation is opaque and binds its page size; Platform offsets, AS page numbers, and Forge registry positions stay inside their adapters.
- The Forge manifest closes MCP invocation to its four non-null `mcpTool` entries. Its job `tool` response field and `list_jobs.tool` request field are declared `string`, so normalized telemetry preserves registry values outside that invocation allowlist.
- Contract tests parse the OpenAPI/manifest structures and exercise the production normalization helpers; Forge wrappers remain behavioral examples only.

## Refresh procedure

1. Record the source Forge commit and confirm its working tree is clean.
2. Copy the six upstream reference files from the paths above without transforming them. Re-review the compute manifest against each checksummed Forge source file; never add a method by name alone.
3. Recompute SHA-256 values and update this file plus every source-file checksum inside the compute manifest.
4. Diff operation ids, paths, required fields, enums, security schemes, and response media types.
5. Update the direct-client closed route map and mock routes deliberately. A new OpenAPI path does not become callable automatically.
6. Run the platform, AS, and optional Forge-compute contract suites plus the offline network allowlist test.
