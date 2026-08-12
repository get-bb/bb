# WP-50 — Optional Forge compute root preparation & ordering constraint

**Lane:** L6 Firmware · **Spec refs:** RECON §2.6–2.7 · SPEC 05 A3, A5.5, B7 · AGENTS.md firmware rules · **Effort:** 1.5 d · **Status:** unassigned
**Depends on:** WP-48 · **Blocks:** WP-53
**Produces a FROZEN artifact:** no — exports a bench preflight service consumed by WP-53

## Files you own

    plugins/bb-plugin-finite-state/lanes/firmware/forge/handshake.ts
    plugins/bb-plugin-finite-state/lanes/firmware/forge/artifact-hash.ts
    plugins/bb-plugin-finite-state/lanes/firmware/forge/readiness.ts
    plugins/bb-plugin-finite-state/lanes/firmware/forge/handshake.test.ts
    plugins/bb-plugin-finite-state/lanes/firmware/forge/artifact-hash.test.ts

## Files you must not touch

server.ts, app.tsx, frozen contracts/store/context/remote-service files, lanes/firmware/register.ts, Forge Python source, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

Forge's resolve_firmware_root reads FORGE_QEMU_FIRMWARE_<pv_id> and has no fetch fallback. It expects an unpacked rootfs directory. verify_dynamic and pen-test staging read directly from that path. Therefore dispatch before complete materialization is a correctness failure, not a performance tradeoff.

There is no verified runtime register_firmware_root tool. For a bench thread that starts its own Forge process, pass the environment at process start. For a persistent demo-appliance Forge, update the process environment and restart/reconnect before the run. Setting process.env after a child is already running is not registration and must never be presented as such.

## What to build

1. Implement prepareFirmwareForBench as the only path WP-53 may use to obtain a firmware root.
2. Load the sidecar and fail if the mount is missing, stale, metadata-only, partial, invalid, or has any regular file without verified bytes. Unpack errors that imply missing bytes fail with MOUNT_INCOMPLETE and list bounded examples.
3. Resolve the real rootfs path, then re-check every regular-file hash from disk without following escaping symlinks. Detect mutation after manifest creation.
4. Compute the exact artifact hash used by Forge's _firmware_artifact_hash. Ground the TypeScript port against a golden fixture produced by Forge. If the algorithm cannot be confirmed from source/fixture, stop; do not substitute input image SHA or a Merkle guess.
5. Return a sealed plugin-side preparation record with pvId, rootfs, artifact hash, manifest generation, and file count. At pinned Forge commit `5083a9d7`, no runtime root-registration method exists: same-host stdio may pass the returned environment only when starting/restarting the plugin-owned Forge process, while remote/persistent adapters return explicit unsupported. `ForgeComputeClient.prepareFirmwareRoot` remains non-freezeable until that lifecycle is proven or a later reviewed method is checksummed.
6. A local compute adapter may start Forge with `FORGE_QEMU_FIRMWARE_<pv_id>=rootfs`; a persistent adapter may use a verified narrow runtime registration. Remote compute returns an explicit unsupported reason until secure transfer/root registration exists.
7. For host/thread dispatch, pass only the sealed preparation to the server-side compute adapter. The target must already run bb host-daemon. Never expose the absolute path through RPC.
8. Immediately before dispatch, re-read manifest generation and root artifact hash. Reject a changed generation with FIRMWARE_CHANGED_DURING_PREPARE.
9. Store the prepared artifact hash on the created verification run. All results and attestations inherit that digest; no later current digest may be substituted.

## Interface contract

    export interface PreparedFirmware {
      pvId: string;
      rootfsPath: string;
      artifactHash: string;
      manifestGeneration: string;
      fileCount: number;
      environment: Readonly<Record<string, string>>;
      preparedAt: string;
    }

    export function firmwareEnvKey(pvId: string): string;

    export function prepareFirmwareForBench(
      deps: FirmwareHandshakeDeps,
      pvId: string,
      signal: AbortSignal,
    ): Promise<PreparedFirmware>;

    export function assertPreparationCurrent(
      deps: FirmwareHandshakeDeps,
      prepared: PreparedFirmware,
    ): Promise<void>;

    export interface BenchProcessLaunch {
      hostId: string;
      environment: Readonly<Record<string, string>>;
      command: readonly string[];
    }

The environment map is server/host-side only. RPC may return digest/readiness, never rootfsPath or host environment.

## Acceptance criteria

- [ ] Tier-1 preparation fails before Forge dispatch for every state except fully_materialized.
- [ ] Every regular file is hash-verified and no escaping symlink is followed.
- [ ] The artifact hash matches Forge's own golden fixture byte-for-byte.
- [ ] The run captures the prepared digest and never substitutes the current digest later.
- [ ] Host-thread launch receives the environment before the Forge process starts.
- [ ] Persistent Forge is restarted/reconnected or implementation stops for amendment; setting process.env alone is not accepted.
- [ ] A manifest/root mutation between prepare and dispatch is detected.
- [ ] No fictional runtime registration tool is called.

## Test plan

- readiness.test.ts — missing, metadata-only, partial, stale, invalid, unpack-gap, and fully-materialized states.
- artifact-hash.test.ts — Forge-produced golden tree, file mutation, path ordering, symlink behavior, empty file, and unreadable file.
- handshake.test.ts — exact environment key/value passed before spawn, environment omitted from RPC/logs, generation race rejected, and persistent client without restart seam returns FIRMWARE_REGISTRATION_UNAVAILABLE.
- Fault path — corrupt one file after prepare and before dispatch; assert zero verify_dynamic/pen_test_run calls and a digest mismatch error.

## Do not

- Do not dispatch against placeholders, partial trees, metadata-only mounts, or unverified hashes.
- Do not use input_sha256 as the Forge artifact hash unless Forge's algorithm proves they are identical for that case.
- Do not expose absolute root paths or environment values to the renderer.
- Do not mutate an already-running child process environment and call it registered.
- Do not invent register_firmware_root.

## Open questions

1. Confirm the exact Forge _firmware_artifact_hash algorithm and pin a cross-language fixture before implementation begins.
2. Confirm whether WP-14's client owns a restartable stdio process or connects to a persistent HTTP Forge. The latter requires an approved lifecycle/configuration mechanism for the demo appliance.
3. Define which unpack errors are completeness-blocking versus warnings. Default to blocking when the snapshot says expected content was not extracted.
