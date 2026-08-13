# Finite State contract amendments

Frozen contracts may change only through an amendment entry approved by the contract owner and one affected-lane reviewer. Pre-freeze architecture corrections retain their accepted `A-*` identifiers; post-freeze contract changes use `AMD-*`. CI, not an implementation lane, updates baseline hashes after approval.

Non-semantic pre-freeze corrections such as a missing dependency declaration, scaffold expectation, or documentation typo use one affected reviewer and do not require a global amendment broadcast. Semantic contract changes and every post-freeze statement change still require the full protocol below.

Each amendment must record:

- identifier and status;
- old and new artifact hashes;
- reason and migration plan;
- affected work packages and gates;
- approver/reviewer identities;
- broadcast and merge commits.

No amendment is implied by an implementation task, code comment, or local workaround.

## Structured entry format

The accept command recognizes only an unfenced level-three `A-*` or `AMD-*`
heading with all three exact fields below: a `Status` field exactly equal to
`approved` or `approved and merged`, an `Artifacts` list, and `Contract
version` (a number or `n/a`). Fenced examples are
documentation only and are never approval evidence.

```md
### AMD-0010 — Example only; this fenced text cannot authorize a change

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 2
```

## Approved amendments

### D-1/D-2 — Consolidated pre-freeze scope, publication, and boundary correction

- Status: approved and merged
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
  - `plugins/bb-plugin-finite-state/lib/store/schema.ts`
  - `plugins/bb-plugin-finite-state/lib/sync/registry.ts`
  - `plugins/bb-plugin-finite-state/lib/remote/types.ts`
- Contract version: 1
- Prior artifact hashes: pre-release candidates only; no registered/frozen store release exists
- New artifact hashes:
  - `shared/contract.ts`: `84bee6cab373316b2c4e47707c1c80b7a54a007d9ae2bf46862faad9cba8e905`
  - `lib/store/schema.ts`: `0494b18f8258ffbf6e66dd8c44bbfef99d6fe7f1c8d7853221d8ad0346e7cbef`
  - `lib/sync/registry.ts`: `e8b7390fa22546db0c727cbfbd7aac4155e00657459bec690f7106d9a3142a53`
  - `lib/remote/types.ts`: `933bf1672ff816879cd246d1e3e9a562c9e1da7bedf16e326d5f75fd12f8ba08`
- Reason: replace global/ambiguous storage keys with explicit project/product-version scope, publish only complete pull generations, bind writes to generation/revision/content fences, normalize paging/remote boundaries, and match pinned bb RPC naming/authorization limits
- Migration: rewrite the positional v1 base statements in place, including original primary keys, unique constraints, foreign keys, and indexes. Do not append D-1 repair migrations. Remove `CREATE TABLE IF NOT EXISTS` so an unexpected preexisting schema fails loudly.
- Pre-release safety proof: on 2026-08-12 a read-only search of `/Users/matt/.bb`, `/Users/matt/Documents/Projects`, and `/Users/matt/Library/Application Support` for finite-state `data.db`/SQLite files returned zero persistent instances. The plugin is unregistered and unreleased, so no developer database can contain a shipped positional statement.
- Cutoff: this in-place rewrite authority ends when the frozen v1 candidate merges/registers. After that point every shipped statement is immutable and changes append through `AMD-*` with a migration plan.
- Affected WPs and gates: Specs 00/01/05; HANDOFF; WP-03–06, WP-16–19, WP-45, WP-56; shared contract, registry, remote boundary, shared store, dependency/frozen guards; G0–G6. WP-02 is held until the consolidated migration candidate merges.
- Contract owner: Matt Wyckhouse; explicit approval recorded at https://github.com/mattwyckhouse/bb/pull/6#issuecomment-5270159899
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_runs4sfrby`
- Consolidation task/branch: FS-89 / PR #6, approved head `ab074586bed60af4ff58a794f0aa4a4b7fe231c2`
- Merge and broadcast commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Result: the four artifacts above are the authoritative frozen product contract activated by FS-23.

### A-000 — Direct APIs and optional Forge compute

- Status: approved and merged
- Prior artifact hashes: pre-freeze; no contract baseline existed
- New artifact hashes: `BASELINE.json` records the approved spec and vendored-input hashes
- Reason: replace Forge-as-data-gateway with direct typed Platform and Assurance Studio REST while retaining only unique Forge compute
- Migration: update the handoff, ADR, Product Specs, remote contracts, mocks, registry ownership, and all affected WPs before implementation dispatch
- Affected WPs and gates: WP-01, WP-03–06, WP-10–19, WP-22, WP-29, WP-40, WP-43, WP-50, WP-64; G0–G6
- Contract owner: Matt Wyckhouse (product-owner approval in the coordinating thread)
- Affected-lane reviewer: independent agent thread `thr_ib9at8u34a`
- Approved specification commit: `3e37cae40405f6857d6ff1f6f628baff134d8436`
- Merge commit: `b18f9878bc6c0b183603885687178480df56b309`
- Broadcast commit: `4f5431306245d2aef2abaa6aac342d947c780bdf` (initial target-repository corpus import)
- Result: Platform and Assurance Studio are direct typed REST data planes. Forge is nullable and restricted to the checksummed compute manifest. `prepareFirmwareRoot` is deliberately unresolved and must be removed or proven before WP-06 freezes.

### A-001 — Declare the repo-pinned Zod runtime dependency

- Status: approved and merged
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `191f9e51eb84fa5e049a1cad9c4c719660a56cc2386dc8a2d00ad3f887ca545d`
  - `pnpm-lock.yaml`: `b99026a911e4d6cfff34c5a1acabd179f0d2923111f32a01c5f9d67928b26b7e`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `729a4ef78484d219bb510dfa3a4c1726d02e7328203c916de8ffdd3a75c5784c`
  - `pnpm-lock.yaml`: `dbeb4f897f85ff24d3129ce038814fd53818d1995ba36b948101559c91028d5c`
- Reason: WP-03 requires a runtime Zod import, but the plugin package cannot resolve Zod under an isolated Node 22.19 workspace install unless it declares the dependency directly. The repository override already pins Zod to 4.3.6.
- Migration: declare `zod` `^4.3.6` in the plugin runtime dependencies and add only that dependency to the finite-state lockfile importer, reusing the existing `zod@4.3.6` package resolution. No source contract, composition root, or product behavior changes.
- Affected WPs and gates: WP-03 (FS-17) and WP-09 dependency-freeze checks; Node 22.19 frozen install and the scoped finite-state typecheck/test/lint/build gate
- Contract owner: Matt Wyckhouse (absorbed into the explicit FS-89 approval)
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_runs4sfrby`
- Implementation base commit: `ba28401a45b31dd1e907a043138207505fb01a4f`
- Merge commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Broadcast commit: `1062b0c799a8a538da8131d298175a9e47ed2a38`
- Result: the plugin resolves the repo-pinned Zod 4.3.6 runtime directly, while the lockfile retains every pre-existing importer and package resolution unchanged.

### A-005 — Declare the established shared UI and Hugeicons dependencies

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `729a4ef78484d219bb510dfa3a4c1726d02e7328203c916de8ffdd3a75c5784c`
  - `pnpm-lock.yaml`: `dbeb4f897f85ff24d3129ce038814fd53818d1995ba36b948101559c91028d5c`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `422191d82ff75b7e1b0dca78a5b4a5598433b79d327c2e04d2f3028ad5d7b108`
  - `pnpm-lock.yaml`: `43d1a3c77970f882ba086044a7be1b0e2af2424d609ed396735019c85374e301`
- Reason: FS-46 requires `@bb/shared-ui` and Hugeicons UI. All three are established repository dependencies: `@bb/shared-ui` `workspace:*` is declared by all 13 other bundled plugins, while `@hugeicons/react` `^1.1.6` and `@hugeicons/core-free-icons` `^4.1.3` are already resolved via `plugins/secrets`.
- Migration: dependency declaration only, with existing package resolutions reused. No source contract, composition root, or product behavior changes.
- Affected WPs and gates: WP-32 (FS-46) and the dependency-freeze tripwire
- Contract owner: FS-46's own requirement text — “Use Hugeicons/shared-ui/theme tokens and all four states” — is the owner-intent anchor; the product owner was notified with veto opportunity before merge via the supervisor oversight thread
- Affected-lane reviewer: independent Claude Opus 5 exact-head audit in `thr_hnfg34qshf` at reviewed head `227281569277b8bcd58efaf084e783db41a7f139`

### AMD-0003 — Make standalone firmware materialization safely reachable

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 2
- Prior artifact hashes:
  - `shared/contract.ts`: `84bee6cab373316b2c4e47707c1c80b7a54a007d9ae2bf46862faad9cba8e905`
- New artifact hashes:
  - `shared/contract.ts`: `7a09956e16923fe4c12421b5c234c5d238dc73d0a95f8277930cf827e284484f`
- Reason: WP-51 must make WP-48 standalone unpack reachable as the default firmware materialization action. The frozen `firmwareMaterializeStart` input correctly accepts only an opaque `inputId`, but no frozen RPC, HTTP operation, or frontend host SDK surface can safely select a firmware file and issue that id through `getStandaloneUnpackInputRegistry().issue(...)`. The frontend cannot inspect host paths through `bb.sdk`, a browser-supplied path is untrusted, and `fileOpener` file identity has no authenticated transport to the backend issuer. Separately, `configureStandaloneUnpackRuntime(...)` requires a wrapper `executablePath` and FACT image, while the sole frozen `REMOTE_SETTING_DESCRIPTORS` has neither field and the repository contains no production wrapper to configure implicitly. Hardcoding a machine path or silently assuming an image would make the primary action unreachable or dishonest.
- Considered issuance options:
  1. A plugin-owned issuer RPC is the approved primary path. Add `firmwareInputIssue` with strict input `{ projectId: identifier, projectVersionId: projectVersionIdSchema (non-null), environmentId: identifier, firmwarePath: relativeArtifact }` and output `{ projectId, projectVersionId, inputId: identifier, fileName: string, expiresAt: timestamp }`. The handler must resolve the named environment through `bb.sdk`, verify its project, canonicalize both the environment worktree and selected file, require the canonical selected file to remain beneath the canonical worktree with a separator-aware containment check, and only then require a readable regular file and call `getStandaloneUnpackInputRegistry().issue(...)`. Merely selecting an in-worktree symlink is insufficient: a symlink whose canonical target leaves the worktree must be rejected. The issued capability has a fixed ten-minute lifetime; the registry must reject an issuer-supplied expiry beyond `now + 10 minutes` so no alternate caller can bypass that ceiling. Neither input nor output permits an absolute host path. The dialog can therefore issue its own opaque token for a confined workspace file identity and submit the existing `firmwareMaterializeStart` action. An image outside the worktree remains unsupported until a separate, owner-approved host contract exists; the UI must say so rather than accepting a raw path.
  2. A new host-safe file-selection SDK surface was considered and rejected by the product owner because factory work must not modify bb (the governing ADR remains binding).
  3. A CLI issuance path for `bb finite-state firmware pull <pv-id> --image <firmware-file>` is complementary. It may satisfy headless/agent use when the invoking environment and runtime are safely co-located, but it does not replace the dialog's issuer RPC.
- Authorization: classify `firmwareInputIssue` as `action`. Issuance grants a project/version/environment/path-scoped, ten-minute, one-time local capability and therefore is not a read, but it does not itself materialize bytes or mutate the firmware cache; `firmwareMaterializeStart` remains the state-changing action. Classifying issuance as `human-only` would make the primary UI unreachable because the frozen human-only capability mint is intentionally unavailable. Do **not** add `firmwareInputIssue` to `AGENT_ACTION_RPC_METHODS`: agents must use the confined CLI issuance path rather than minting a browser-action capability by guessing workspace-relative paths. Local RPC origin checks, canonical environment/project/path confinement, regular-file verification, the registry-enforced TTL ceiling, environment binding, scope binding, and one-time consumption are the authorization controls. Add the method to the frozen wire-name and classification maps, update the pinned `contract.test.ts` version/name/count/classification assertions, and increment `CONTRACT_VERSION` from 1 to 2 in the approved implementation.
- Owner decision: approve the plugin-owned issuer RPC above; reject bb host-SDK modification; approve the standalone runtime settings below. Matt Wyckhouse's decision was relayed through supervisor `thr_rxxqm3px8s` and recorded on FS-65 by coordinator `thr_hg37weivk7` on 2026-08-13.
- Approved non-frozen companion settings: `lib/remote/config.ts` is the sole settings owner but is not a registered frozen artifact, so it is intentionally not listed in `Artifacts` and does not participate in the amendment accept command's exact changed-artifact equality check. In the same implementation, add `standaloneUnpackExecutablePath: { type: "string", label: "Standalone unpack wrapper", default: "" }` and `standaloneUnpackImage: { type: "string", label: "FACT extractor image", default: "localhost:5000/services-unpack:latest" }` to `REMOTE_SETTING_DESCRIPTORS`; add the corresponding required fields to `RemoteSettingValues`; parse the wrapper to `string | null` and the image to a non-empty explicit string in `RemoteConfig`; and expose change detection so the production firmware registration reconfigures the existing runtime without defining a second settings owner. The empty wrapper default is the intentional unconfigured sentinel and must surface `UNPACK_CONFIGURATION_REQUIRED`; the canonical image default remains visible in the dialog/settings UI. Update the CLI guide and generated plugin-command skill surfaces for these user-facing knobs.
- Migration: after independent affected-lane review, add `firmwareInputIssue` exactly as specified, increment `CONTRACT_VERSION` to 2, update the frozen `shared/contract.ts` baseline through the amendment accept flow, and wire the existing registry/runtime from `lanes/firmware/register.ts`. Extend the non-frozen remote settings owner with the two approved descriptors and propagate explicit values to firmware registration. Bind every issued record to `environmentId` in addition to project/version/path so it cannot cross environments that share project coordinates. Add focused action-classification/agent-denial, TTL-ceiling, environment/project/path mismatch, canonical symlink escape, regular-file, one-time-use, settings-change, and path-redaction tests. Update the pinned contract version and 65-to-66 wire-name/count assertions. Preserve the existing `firmwareMaterializeStart` opaque-id action and never add raw browser paths to it.
- Implementable before approval: firmware API fallback materialization and selected-file hydration; authoritative status/list/tree/file reads; sidecar-only offline version diff; progress/reconnect refetch UI; binary metadata/hex-preview UI; and removal of WP-49's temporary untyped API bridge.
- Blocked pending amendment merge: confined workspace-image token issuance, production `configureStandaloneUnpackRuntime(...)`, and a truthful end-to-end Local image submit from the materialize dialog. Images outside the worktree remain blocked by the existing host contract even after this amendment and must render an explicit unsupported/recovery state. These pieces do not block the API fallback or read-only firmware UX.
- Affected WPs and gates: WP-07, WP-09, WP-48, WP-49, WP-50, WP-51, WP-61, WP-64, WP-67; firmware materialization UI/CLI, remote settings, shared RPC authorization and contract tests, frozen guards; G0–G6
- Contract owner: Matt Wyckhouse; approved decision relayed through supervisor `thr_rxxqm3px8s` and recorded on FS-65 by coordinator `thr_hg37weivk7` on 2026-08-13
- Approval provenance: owner Matt Wyckhouse, relayed via supervisor `thr_rxxqm3px8s`, scope-match verified by coordinator `thr_hg37weivk7` at approved proposal head `9f81f270f` on 2026-08-13
- Affected-lane reviewer: independent exact-head audit in `thr_82qsv2zmgw`; APPROVE at `9f81f270f`
- Amendment merge commit: `d57683094b380f099fa5a91bd04f443d558724c1`
- Contract implementation commit: `aa0e6aa328fcb90404d0565e15f1de9d5e3c7758`; broadcast in the implementation PR
- Evidence: FS-65 scope audit at base `afb16ac928e053187b5bfe85ace2e8b7887ed751`; `shared/contract.ts` exposes `firmwareMaterializeStart.inputId` but no issuer; `lanes/firmware/register.ts` contains the unconfigured registry/runtime seams and currently trusts the issuer to enforce canonical worktree containment and a bounded expiry; `PluginAppBuilder` exposes no file picker and the backend SDK exposes only `hosts.pickFolder`; non-frozen `lib/remote/config.ts` is the sole settings descriptor owner and has no standalone unpack fields; no standalone wrapper exists in this repository; owner scope decision recorded on FS-65 on 2026-08-13; independent review constraint `mem_i30_pg8cd4c` documents the canonical-symlink escape and unbounded-expiry chain corrected by this proposal.

### AMD-0004 — Add a verified Assurance Studio verification-result write

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/remote/types.ts`
- Contract version: n/a
- Prior artifact hashes:
  - `lib/remote/types.ts`: `933bf1672ff816879cd246d1e3e9a562c9e1da7bedf16e326d5f75fd12f8ba08`
- New artifact hashes: pending an approved implementation
- Reason: WP-53 can keep its WP-52 checkpoint current locally, but the frozen `AssuranceStudioClient` has no handler-verified method for writing a verification result. `updateEntity(...)` is an intentionally generic entity mutation and is not evidence that the upstream verification-result route, request body, digest binding, or response has been verified. WP-53 therefore has no authorized upstream write and correctly provides no raw fallback.
- Proposed contract: after grounding the operation in an authoritative Assurance Studio handler, add `createVerificationResult(input, ctx)` to `AssuranceStudioClient`. Its strict input is `{ projectId, checkId, runId, resultId, firmwareDigest, outcome, summary, executedAt, jobId }`, where `firmwareDigest` is lowercase SHA-256, `outcome` is `pass | fail | error`, and `jobId` is nullable; its output is `{ resultId, created }`. The client implementation must bind the result to the named verification check and prepared digest, use `runId + resultId` as the retry/idempotency identity, validate the handler response, and reject unsupported or ambiguous upstream shapes. Artifacts and attestations remain local until separately verified upstream contracts exist. The generic CRUD methods are not a substitute.
- Migration: verify and record the exact upstream route and handler schema; add the narrow types and client member; add its route-map entry and strict request/response parser; extend the mock only from the same verified handler; add retry/idempotency, check mismatch, digest mismatch, invalid response, and unsupported-route tests; then let WP-53 call only this member after the local transactional checkpoint succeeds. Preserve local evidence as authoritative whenever the method is unavailable or rejects the write.
- Affected WPs and gates: WP-03, WP-05, WP-09, WP-52, WP-53, WP-55, WP-60; frozen remote contract, Assurance Studio client/routes/mock, bench evidence checkpoint, G0–G6
- Contract owner: Matt Wyckhouse; owner approval relayed via supervisor `thr_rxxqm3px8s` and recorded by coordinator `thr_hg37weivk7` on FS-67 on 2026-08-13
- Approval provenance: owner Matt Wyckhouse via supervisor `thr_rxxqm3px8s`; coordinator `thr_hg37weivk7`; approved proposal head `e5edf2c09e23dda952e8e8c0a148a9f82a4971c9`
- Affected-lane reviewer: independent exact-head amendment audit in `thr_fm4ejd6kju`; APPROVE-AMENDMENT at `e5edf2c09e23dda952e8e8c0a148a9f82a4971c9`, recorded on FS-67 on 2026-08-13
- Broadcast and merge commits: pending
- Evidence: FS-67 review at WP-53 head `7520ccb8b` confirmed that `AssuranceStudioClient` exposes verification reads and `runVerificationChecks(...)`, but no verified verification-result write. WP-53 intentionally retains local evidence and supplies no raw API fallback.

### AMD-0005 — Expose a prepared-root Forge process lifecycle seam

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/remote/types.ts`
- Contract version: n/a
- Prior artifact hashes:
  - `lib/remote/types.ts`: `933bf1672ff816879cd246d1e3e9a562c9e1da7bedf16e326d5f75fd12f8ba08`
- New artifact hashes: pending an approved implementation
- Reason: the frozen `RemoteServices` contract exposes only an already-connected `ForgeComputeClient`. The configured implementation has no lifecycle adapter that can install WP-50's sealed prepared-root environment before the target Forge process starts, and `penTestRun(...)` deliberately fails unsupported because its required firmware root cannot be established safely. Mapping the prepared root after connection, attaching an arbitrary process, or passing a lazy/API placeholder would violate WP-50/WP-53 digest and host guarantees.
- Proposed contract: add `ForgePreparedRootLaunch`, `ForgeProcessLifecycle`, and `forgeProcessLifecycle: ForgeProcessLifecycle | null` on `RemoteServices`. `ForgePreparedRootLaunch` is the strict input `{ hostId, projectVersionId, firmwareDigest, rootfsPath, environment }`; `firmwareDigest` is lowercase SHA-256 and `environment` is a readonly string map read directly from the sealed WP-50 object. `ForgeProcessLifecycle.startWithPreparedRoot(input, ctx)` returns `{ started: true }` only after it has server-initiated the configured Forge process on the selected enrolled host with that exact environment present before process start. It must reject remote transports, host mismatches, already-running unowned processes, absent restart ownership, and any launch that cannot preserve the prepared digest/root binding. This is a process-lifecycle seam, not a new Forge action: Tier 1 continues to invoke only `verifyDynamic(...)` and `penTestRun(...)` after launch.
- Migration: implement a bb-host-backed lifecycle owner for the configured stdio Forge mode; bind it to the selected host and explicit command; start or verified-restart the owned process with the prepared environment; establish the compute client only after successful launch; revalidate WP-50 prepared bytes immediately before lifecycle dispatch; and add remote/persistent fail-closed, host mismatch, environment-before-start, reconnect, and firmware-mutation tests. Leave `forgeProcessLifecycle` null for HTTP/SSE or any configuration without verified process ownership. WP-53 must continue rejecting Tier 1 before creating a run or thread while this member is null.
- Affected WPs and gates: WP-03, WP-09, WP-50, WP-53, WP-54, WP-60; frozen remote contract, Forge client/transport registration, host execution, prepared firmware handshake, G0–G6
- Contract owner: Matt Wyckhouse; owner approval relayed via supervisor `thr_rxxqm3px8s` and recorded by coordinator `thr_hg37weivk7` on FS-67 on 2026-08-13
- Approval provenance: owner Matt Wyckhouse via supervisor `thr_rxxqm3px8s`; coordinator `thr_hg37weivk7`; approved proposal head `e5edf2c09e23dda952e8e8c0a148a9f82a4971c9`
- Affected-lane reviewer: independent exact-head amendment audit in `thr_fm4ejd6kju`; APPROVE-AMENDMENT at `e5edf2c09e23dda952e8e8c0a148a9f82a4971c9`, recorded on FS-67 on 2026-08-13
- Broadcast and merge commits: pending
- Evidence: FS-67 review at WP-53 head `7520ccb8b` reproduced the default `FIRMWARE_REGISTRATION_UNAVAILABLE` path. Repair head `b0c76335d` fails before run/thread creation, while the configured client remains unable to launch Tier 1 until a lifecycle contract is approved and implemented.

### AMD-0016 — Represent local semantic deletion results truthfully

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 4
- Prior artifact hashes:
  - `shared/contract.ts`: `7a09956e16923fe4c12421b5c234c5d238dc73d0a95f8277930cf827e284484f`
- New artifact hashes: recorded by the frozen accept flow for the merged contract
- Reason: WP-35's frozen `taraCommandApply` input includes a semantic `delete` operation, but its output reuses `localWriteResultSchema`, whose `afterSha256` is required to be a SHA-256 string. A successful file deletion has no post-write file and therefore no truthful content hash. Returning the deleted file's prior hash or the hash of fabricated empty bytes would misstate the worktree and make undo/concurrency evidence ambiguous. The WP-35 interface correctly specifies `afterSha256: string | null`, paired with `beforeSha256: string | null` (`before` null means create; `after` null means delete).
- Owner decision — Option A, uniform nullable: change `localWriteResultSchema.afterSha256` from `sha256Schema` to `sha256Schema.nullable()`. `beforeSha256 === null` means creation and `afterSha256 === null` means deletion. `taraCommandApply` returns null only after its CAS rename-aside deletion commits successfully. Option B's TARA-specific duplicate result schema is rejected.
- Binding validity condition: the shared result refines the digest pair so `beforeSha256` and `afterSha256` can never both be null. A local-write result with neither prior nor resulting bytes is semantically invalid.
- Binding surface condition: the pinned contract test must prove that today only `taraCommandApply` accepts a null `afterSha256`. `triageDecisionWrite`, `triageDecisionUndo`, and `requirementsWrite` retain non-deleting output refinements and continue rejecting a null after-hash, even though their shared inferred result type is widened. Adding another deletion-capable local-write surface requires an explicit contract-test allowlist change.
- Contract and test migration: increment `CONTRACT_VERSION` to 4; version 3 was taken by WP-71 concurrently, so AMD-0016 lands as 4. Implement the uniform nullable base plus both refinements; update `shared/contract.test.ts` pinned version and output assertions; prove create/update results remain valid, the never-both-null rule applies to every local-write surface, and a TARA delete accepts exactly null rather than a placeholder digest. Run the amendment accept flow to update the frozen artifact baseline and broadcast the contract-version change to every RPC producer and consumer. No wire method name, input shape, method classification, human-only gate, or push path changes.
- Implementation: WP-35 removes its frozen-handler and UI fail-closed guards only with this approved contract implementation. Create/update authoring, read-time working overlay, validation, plan generation, and review navigation remain unchanged.
- Affected WPs and gates: WP-09, WP-15, WP-18, WP-20, WP-27, WP-35, WP-36; frozen shared RPC contract, local-write consumers, contract-version/baseline guards, G0–G6
- Contract owner: Matt Wyckhouse; Option A approved with the binding validity and surface conditions above, relayed through supervisor thread `thr_rxxqm3px8s` on 2026-08-13 and recorded on FS-49 by coordinator `thr_hg37weivk7`
- Approval provenance: owner Matt Wyckhouse via supervisor `thr_rxxqm3px8s`; scope and binding conditions relayed by coordinator `thr_hg37weivk7` on 2026-08-13
- Affected-lane reviewer: pending independent exact-head amendment audit
- Broadcast and merge commits: pending
- Evidence: FS-49 at integration head `037831bf2` confirmed `taraCommandSchema` includes `operation: "delete"`, while `taraCommandApply.output` is `localWriteResultSchema` and the schema requires non-null `afterSha256`. The task's published `EditResult` contract requires nullable before/after digests, and the coordinator explicitly rejected old-file and empty-file synthetic hashes in task comment `01KZX45244TNG1KN12NQFST3DD`.

### AMD-0017 — Publish discovered KiCad project compatibility

- Status: approved
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
  - `plugins/bb-plugin-finite-state/lib/store/schema.ts`
- Contract version: 5
- Prior artifact hashes:
  - `shared/contract.ts`: `6ca3b51571514cbe63ba8ad358476d317130d06e05bbe8755e9acc7b1c9e6ea9`
  - `lib/store/schema.ts`: `2e83339eaf9fd86efb0e9ab08162eb24dba5645022e6a0fe86fe779656e6c569`
- New artifact hashes: recorded by the frozen accept flow for the approved implementation
- Reason: WP-72 computes KiCad project-format compatibility during discovery, but the frozen strict `hardwareProjectSchema` and `hw_project` table cannot carry that result. Consequently the WP-72 acceptance criterion that a KiCad 5 fixture records `supported: false` is unsatisfiable through the registered product RPC even though lane-local discovery computes it. The required field makes the product response truthful and prevents compatibility from being hidden behind omission or a default.
- Owner decision — Option A: add `supported: boolean` as a required `hardwareProjectSchema` field. Every discovered project explicitly states `true` or `false`; the field means KiCad project-format compatibility as computed at discovery time by `lanes/hardware/discovery.ts` `readKicadVersion(...)`: recognized generator versions follow the existing major-version threshold, legacy numeric file-format versions follow the existing year threshold, and an unrecognized version is unsupported. This is project-source compatibility, not the separately detected `kicad-cli` installation/capability state.
- Migration: increment `CONTRACT_VERSION` from 4 to 5 at merge serialization; append the two positional statements below to add `hw_project.supported INTEGER NOT NULL` with a migration-only default and immediately backfill by discriminating version shape before comparison; make every discovery upsert bind an explicit `0` or `1`; map storage back to the required boolean in `hardware.projects.list`; and update the pinned contract-version test. The WP-72 product-path registration test refreshes a KiCad 5 project and asserts `supported: false` through the registered `hardwareProjectsList` RPC. A separate populated pre-migration database test seeds an eight-digit KiCad 5-era version and proves the migration itself backfills `supported = 0` without discovery refresh. No RPC method name, input, classification, agent-tool allowlist, or other entity contract changes.
- Approved migration SQL: the contents of these two SQL statements are byte-identical to the appended `schema.ts` migration strings:

```sql
ALTER TABLE hw_project ADD COLUMN supported INTEGER NOT NULL DEFAULT 0 CHECK (supported IN (0,1))
```

```sql
UPDATE hw_project
    SET supported = CASE
      WHEN kicad_version IS NULL THEN 0
      WHEN length(kicad_version) = 8 AND kicad_version NOT LIKE '%.%'
        THEN CASE WHEN CAST(substr(kicad_version, 1, 4) AS INTEGER) >= 2021 THEN 1 ELSE 0 END
      WHEN CAST(kicad_version AS INTEGER) >= 6 THEN 1
      ELSE 0
    END
```

- Affected WPs and gates: WP-09, WP-72, WP-73, WP-74, WP-76, WP-77; shared hardware project response, hardware discovery storage, registered RPC product path, frozen baseline, Node 22.19 typecheck/test/lint/build gates
- Contract owner: Matt Wyckhouse; Option A approved around 10:03 ET via supervisor and recorded on FS-107 by coordinator `thr_hg37weivk7` in task comment `01KZXQ105XDHR3H30AFANM6KMQ` on 2026-08-13
- Approval provenance: owner ruling above; exact entry and diff posted on FS-107 in comment `01KZXRAD369CW7ZN9E27QP4Q7G`; conditional signature with the required shape-first backfill correction relayed by supervisor and recorded by the coordinator on 2026-08-13; corrected SQL recorded in task comment `01KZXRSGRHQ2E3VC1DS5SYWVVM`
- Affected-lane reviewer: pending independent exact-head repair audit
- Broadcast and merge commits: pending
- Evidence: WP-72 acceptance criterion “KiCad 5 project recorded with `supported: false`”; independent PR #83 review finding M-6; current `discovery.ts` `readKicadVersion(...)` compatibility computation; frozen strict `hardwareProjectSchema` and `hw_project` storage lack the field before this amendment

## Approved amendments — SPEC 07 / SPEC 08 intake

*Drafted 2026-08-12 as AMD-0001…0006. Approved 2026-08-13 by the product
owner (Matt), relayed via supervisor thread `thr_rxxqm3px8s`, under two
binding conditions: (1) the batch was renumbered to AMD-0010…0015 because
the identifiers AMD-0002 and AMD-0003 were already claimed by in-flight
amendments (duplicate-finding-ID dedup on PR #42; FS-65 firmware issuer-RPC
proposal); supervisor guidance of 2026-08-13 subsequently confirmed AMD-0004
and AMD-0005 are also claimed (WP-53's proposal PR #57 — AS
verification-result write; Forge process lifecycle seam), so the whole
AMD-0001…0005 range is off limits and AMD-0010…0015 is the confirmed range;
(2) the schema amendment AMD-0010 carries an explicit acceptance
criterion that the `verification_results` create-copy-swap rebuild migration
is tested against a populated database. WP-71 is the single implementation
task for AMD-0010 through AMD-0013 and AMD-0015; AMD-0014 is a
dependency-batch change. Artifact hashes are recorded by the accept tooling
(`check-frozen-artifacts.mjs --accept`) when WP-71 lands each change. Source
specs: `docs/Product Specs/SPEC 07` and `SPEC 08`.*

### AMD-0010 — Hardware and grounding tables; `hardware` verification matrix column

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0001
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/store/schema.ts`
- Contract version: n/a
- Prior artifact hashes:
  - `lib/store/schema.ts`: `0494b18f8258ffbf6e66dd8c44bbfef99d6fe7f1c8d7853221d8ad0346e7cbef`
- New artifact hashes:
  - `lib/store/schema.ts`: `2e83339eaf9fd86efb0e9ab08162eb24dba5645022e6a0fe86fe779656e6c569`
- Note: schema.ts is not the wire contract; the contract-version gate applies only to `shared/contract.ts` (see AMD-0011)
- Change: append tables `hw_project`, `hw_artifact`, `hw_symbol`, `hw_net`,
  `hw_violation` (SPEC 07 §5) and `ground_source`, `ground_chunk`,
  `bench_device`, `probe_run`, `build_run` (SPEC 08 §5, including the
  `license`/`redistributable` columns from §4.2.1 and the claim-scope field
  from decision 9.5). Extend the verification matrix column vocabulary from
  `('static','emulation','hil','manual')` to include `'hardware'`
  (SPEC 07 §7.2; schema.ts lines ~621–656).
- Migration note: the new tables are ordinary append-only statements. The
  `matrix_col`/`tier` CHECK constraints are inside already-applied positional
  statements and are immutable post-freeze, so the vocabulary change appends a
  table-rebuild migration (create-copy-swap) for `verification_results` and
  the matrix definition table. SPEC 08's `catalog.db` (`cat_*` tables) is
  deliberately **out of scope**: it is a read-only sidecar artifact outside
  `bb.storage.migrate` (SPEC 08 §5.1) and never enters this schema.
- Acceptance criterion (owner condition, binding): the `verification_results`
  create-copy-swap rebuild migration must be tested against a **populated**
  database — rows in every pre-existing `matrix_col`/`tier` value, foreign-key
  references intact, and row counts and cell contents proven identical across
  the swap — not just against an empty schema. WP-71 does not merge without
  this test.
- Reason: SPEC 07 makes DRC/ERC results verification evidence and both specs
  cache derived hardware/grounding state; none of it is expressible in the
  frozen v1 schema.
- Affected WPs and gates: WP-71 (implementation); consumers WP-72…WP-98;
  WP-39 (matrix rendering) must not start before this lands.

### AMD-0011 — RPC contract surfaces for hardware, grounding, authoring, and bench devices

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0002 (that identifier is claimed by the duplicate-finding-ID dedup amendment on PR #42)
- Artifacts:
  - `plugins/bb-plugin-finite-state/shared/contract.ts`
- Contract version: 3
- Prior artifact hashes:
  - `shared/contract.ts`: `7a09956e16923fe4c12421b5c234c5d238dc73d0a95f8277930cf827e284484f`
- New artifact hashes:
  - `shared/contract.ts`: `a986fb84bea527c124381403dd208a5fe5e4408156e8f6e4c50071afe5e77418`
- Contract-version sequencing: AMD-0003 landed contract version 2 on integration
  before WP-71's acceptance; AMD-0011 takes 3.
- `projectKey` exemption: the owner keeps `projectKey` as the KiCad
  project-relative hardware-domain key, not a project-scope alias, for exactly
  `hardwareSymbolsList`, `hardwareNetsList`, `hardwareViolationsList`,
  `hardwareSheetsList`, `hardwarePartGet`, `hardwareArtifactsStatus`,
  `hardwareExtractStart`, and `groundingSourcesList`. The rejected-alias guard
  exempts only those eight methods. A `hardwareProjectKey` rename is deferred
  and may ride a future contract amendment if this ambiguity proves costly.
- Change: add namespaced method groups — `hardware.*` (projects, sheets,
  symbols, nets, violations, artifact status, extract job control),
  `grounding.*` (sources, federated query with plane labels, catalog
  coverage), `authoring.*` (citation files, quarantine queue, gate pipeline
  status), `benchDev.*` (device registry, claim/release, serial session
  metadata, probe/build run history). Extend tier/matrix enums with
  `hardware` in lockstep with AMD-0010. Streams (SVG/GLB bytes, serial
  live tail, gerber downloads) stay on `bb.http`/realtime per SPEC 00 §5,
  not RPC.
- Reason: both new nav surfaces are frontend panels; the frontend's only
  data path is the frozen typed RPC contract.
- Affected WPs and gates: WP-71 (implementation); consumers WP-74…WP-96.

### AMD-0012 — Sync-registry entities for hardware links, citations, and the authoring gate

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0003 (that identifier is claimed by the FS-65 firmware issuer-RPC proposal)
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/sync/registry.ts`
- Contract version: n/a
- Prior artifact hashes:
  - `lib/sync/registry.ts`: `e8b7390fa22546db0c727cbfbd7aac4155e00657459bec690f7106d9a3142a53`
- New artifact hashes:
  - `lib/sync/registry.ts`: `2059a09c3d6d090505195b69ca56bef6585c8e6c5d25dbbed3735582516b3e86`
- Change: register `hardwareLink` (OVERLAY, server `none`, localOnly, dir
  `product-security/links`, keyed by reference designator; SPEC 07 §6),
  `citationFile` (OVERLAY, server `none`, localOnly, dir
  `.fs/authoring/citations`, keyed by source file path; SPEC 08 §4.3),
  `authoringGate` (VERSIONED-local, dir `.fs/workflows`; SPEC 08 §9.4), and
  CACHED registrations for the AMD-0010 tables. All three YAML entities are
  local-only in v1 — nothing here gains a push path, so the plan/push engine
  and the no-agent-push boundary are unchanged.
- Reason: SPEC 01's registry is the single authority for entity classes;
  unregistered YAML dirs are invisible to `status`/drift handling.
- Affected WPs and gates: WP-71 (implementation); consumers WP-78, WP-79,
  WP-85, WP-95.

### AMD-0013 — ACTION-tool allowlist grows from three to eight; `destructive` primitive

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0004
- Artifacts:
  - `plugins/bb-plugin-finite-state/lib/agentic/registry.ts`
  - `plugins/bb-plugin-finite-state/AGENTS.md` (the exact-count language)
  - `docs/Implementation/AGENTS.md` (same rule, §5 of non-negotiables)
- Contract version: n/a
- Note: the agentic registry is the compile-time authority, not a wire
  contract
- Change: extend the closed `ActionToolName` union with `fs_hw_extract`
  (SPEC 07 §8), `fs_build`, `fs_flash`, `fs_serial`, `fs_probe` (SPEC 08 §6).
  Add a `destructive: true` capability flag per SPEC 08 decision 9.3:
  destructive tools require an explicit human instruction **in the current
  turn** — intent inherited from an approved plan does not count — enforced
  by one mechanism and one test, not convention. `fs_flash` is the first
  `destructive` tool; `fs_serial` send (not read) sits behind confirmation.
- Safety argument: all five new tools invoke local subprocesses or local
  hardware. None mutates Platform or Assurance Studio. The model-mutation
  boundary (no push tool, human-only VEX/HBOM/lifecycle actions) is intact
  and unchanged. The allowlist guard's value — nobody adds a server-touching
  tool by accident — is preserved because the union stays closed and the
  guard test enumerates all eight by name.
- Reason: SPEC 06 §5.3 requires a recorded human decision to extend the
  ACTION class; SPEC 07 adds one tool and SPEC 08 adds four, which materially
  changes the safety posture and must not happen tool-by-tool.
- Affected WPs and gates: WP-71 (implementation); WP-60 (allowlist guard)
  must consume the amended union; consumers WP-81, WP-86…WP-96.

### AMD-0014 — Dependency batch for the hardware and authoring lanes

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0005
- Artifacts:
  - `plugins/bb-plugin-finite-state/package.json`
- Guard-scope normalization: `pnpm-lock.yaml` changes mechanically with this
  dependency batch, but the frozen accept guard tracks dependency changes only
  through the plugin `package.json` dependency baseline. The lockfile is not a
  baseline target and therefore is not listed under Artifacts.
- Contract version: n/a
- Prior artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `422191d82ff75b7e1b0dca78a5b4a5598433b79d327c2e04d2f3028ad5d7b108`
  - `pnpm-lock.yaml`: `43d1a3c77970f882ba086044a7be1b0e2af2424d609ed396735019c85374e301`
- New artifact hashes:
  - `plugins/bb-plugin-finite-state/package.json`: `fa7e65d79a96e0db7922f4a794837bb421e5e5c5975fb1850a53ee60d266fdea`
  - `pnpm-lock.yaml`: `037bbc846051d8e287656133d383b86a602b2d33698209957e350fdd2f3122ab`
- Change: declare `kicadts` (KiCad S-expression parser, pure TS — used with
  no KiCad install) and `@google/model-viewer` (GLB rendering, SPEC 07 §3
  Tab 2). `@xyflow/react` is already declared via the canvas lane. Python-side
  tooling (probe runtime, PyVISA, vendor instrument SDKs) and `kicad-cli` are
  runtime host prerequisites detected via `needsConfiguration`, not npm
  dependencies, and are out of scope here.
- Reason: dependency freeze (WP-09) requires new packages to land as a
  reviewed batch.
- Affected WPs and gates: WP-72, WP-73, WP-74, WP-76; dependency-freeze
  tripwire.

### AMD-0015 — Composition-root registration for the L9/L10 lanes

- Status: approved
- Approved: 2026-08-13, product owner (Matt) via supervisor thread `thr_rxxqm3px8s`; renumbered from AMD-0006
- Artifacts:
  - `plugins/bb-plugin-finite-state/server.ts`
  - `plugins/bb-plugin-finite-state/app.tsx`
- Contract version: n/a
- Prior artifact hashes:
  - `server.ts`: `510c19ab0ef428a52a0d23c4225c9ded3f2a64d3518dcfe158900c05e849941c`
  - `app.tsx`: `f7e8aa6d22be0b432ad3b631864f2f381deaf768ca0cc9d1cb85558cb1f8a6d0`
- New artifact hashes:
  - `server.ts`: `0f2a1047ba074533deb0e1520f690093f88f631eefdb841387ba2b70856bd145`
  - `app.tsx`: `e3b929346acf5a29d635e002baf6cf9e238c5dcdbd181649b3a3407e3b0efee9`
- Note: accepting this amendment is a baseline hash update for the
  composition-root guard
- Change: add the one-time registration calls for the new lanes —
  `registerHardware(bb, ctx)`, `registerGrounding(bb, ctx)`,
  `registerAuthoring(bb, ctx)`, `registerDebugBench(bb, ctx)` and their
  `app.tsx` counterparts — each pointing at a compiling stub in its lane
  directory, exactly as WP-01 did for the original nine lanes. After this
  lands, the roots are frozen again and no L9/L10 package touches them.
- Reason: the anti-collision design requires every lane's wiring to pre-exist
  in the roots; SPEC 07/08 add lanes that WP-01 could not anticipate. One
  root edit now, under amendment, preserves the "no lane ever edits a
  composition root" rule for the whole L9/L10 build.
- Affected WPs and gates: WP-71 (implementation); the WP-09 composition-root
  guard baseline; every L9/L10 package consumes the stubs.
