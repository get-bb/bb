# WP-88 — Device registry, claim/release arbitration & fs_hw_status

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.4, §4.4.1, §5, decision 9.5 · AMENDMENTS AMD-0010, AMD-0011 · **Effort:** 2.5 d · **Status:** unassigned
**Depends on:** WP-71 · **Blocks:** WP-89, WP-92, WP-93, WP-94, WP-96
**Produces a FROZEN artifact:** no — implements repositories and arbitration over the frozen AMD-0010 `bench_device` table (including the decision-9.5 claim-scope and transport fields)

## Files you own

    plugins/bb-plugin-finite-state/lanes/debug-bench/register.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/enumerate.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/families.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/store.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/claims.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/helpers.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/hw-status.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/app/device-panel.tsx
    plugins/bb-plugin-finite-state/lanes/debug-bench/registry/**/*.test.ts
    plugins/bb-plugin-finite-state/lanes/debug-bench/app/device-panel.test.tsx

The two registration files replace WP-71's debug-bench stubs: the backend wires frozen `benchDev.*` RPC seams to lane modules and exports the `fs_hw_status` service for WP-96 plus command handlers for WP-64; the app file registers the `/firmware/bench` tab with the live device panel.
Where WP-87 (`serial/**`, serial app files) and WP-89–94 (driver modules) do not exist yet, create only compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths; those WPs replace them in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, lib/agentic/registry.ts, lanes/authoring/**, lanes/bench/**, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

The registry is the arbitration layer everything at tier D stands on: debug probes, logic analyzers, power analyzers, scopes, and serial ports, each with make, model, connection, and claim state. **One claimant per device** — parallel agents must not fight over a JTAG probe — with claim/release as a protocol, stale-claim expiry so a dead thread cannot hold a probe forever, and `fs_hw_status` as the read tool that enumerates it all.

Decision 9.5 is the field that is cheap now and expensive to retrofit: instruments are local by default but the driver interface takes a **transport** (local USB, local network, or a bb host), and claim scope is **machine-wide now with the field supporting fleet-wide** — so the same probe script runs on a desk and, later, on the rack. Encode both; implement only the local half.

Enumeration is host-tooling-dependent and **degrades gracefully per family**: serial enumeration may work while Saleae detection does not, and each family reports available/unavailable-with-reason independently. Vendor helper libraries (`logic2-automation`, `dwfpy`, `ppk2-api`, `joulescope`, probe tools) are Python-side host prerequisites behind `needsConfiguration` — **installed on first use with explicit confirmation, never silently**. Tier D is diagnostic, never evidentiary; nothing this lane produces enters `verification_results`.

## What to build

1. Replace both registration stubs. Backend: `benchDev.*` device/claim RPC seams, the enumeration background rescan, exported `fs_hw_status` and CLI handler services. App: the bench tab route with the device panel and a slot for WP-87's console. Create placeholders for WP-87 and WP-89–94 at their exact future paths.
2. Family descriptors (`families.ts`): one per instrument family — kind (`probe|logic|power|scope|serial`), detection strategy, required helper, transport kinds supported. Enumeration iterates families independently; a family whose tooling is absent reports `unavailable` with the reason and the helper that would fix it, and never blocks another family.
3. Enumeration (`enumerate.ts`): per-family adapters producing candidate devices with make, model, connection string (`usb:…|lan:…|tty:…`), transport, and a stable identity — serial number where the family exposes one, else a normalized connection identity. Rescan is on-demand plus a slow background interval; results upsert, never blindly replace.
4. Store (`store.ts`): repository over the exact frozen AMD-0010 `bench_device` table. `device_id` is stable across rescans; `last_seen` advances on sighting; a device that disappears is marked stale and retained — an unplugged probe with an active claim is a state worth seeing, not a row to delete.
5. Claims (`claims.ts`): transactional single-claimant acquisition — claim sets `claimed_by` (thread/run id) and `claimed_at` only if currently free, in one SQLite transaction; a losing contender gets `DEVICE_CLAIMED` naming the holder. Release is idempotent and holder-checked. Claim scope is `machine` in v1; the scope field is stored and honored in queries so fleet-wide arbitration is additive later.
6. Stale-claim expiry: claims carry a refresh deadline (default 15 minutes); long-running holders (probe runs, serial sessions) refresh; an expired claim is released by the next arbitration touch, recorded with reason `expired`, and published. No claim outlives its holder silently.
7. Helper installs (`helpers.ts`): first use of a family whose helper is missing produces an install proposal (what, where from, why) that executes only on explicit human confirmation through the panel or CLI; the outcome is recorded. Absence keeps the family `unavailable` behind `needsConfiguration` — never a silent `pip install`.
8. `fs_hw_status` (read, registered by WP-96): enumerated instruments with kind, make, model, connection, transport, claim state and holder, family availability, and last-seen — bounded, paged, WP-57 budget rules. This is the "Observe" step of the debug loop; it must be cheap and honest.
9. Device panel: live list grouped by kind with claim state, stale markers, family-unavailable rows with their reason and install affordance, claim/release actions, rescan. Four designed states; theme tokens and Hugeicons; `benchDev:changed` `{deviceId}` hints after committed changes.

## Interface contract

    export type DeviceKind = "probe" | "logic" | "power" | "scope" | "serial";
    export type DeviceTransport = "local-usb" | "local-net" | "bb-host";
    export type ClaimScope = "machine" | "fleet";

    export interface BenchDeviceRecord {
      deviceId: string;
      kind: DeviceKind;
      make: string | null;
      model: string | null;
      connection: string;                  // usb:...|lan:...|tty:...
      transport: DeviceTransport;
      claimedBy: string | null;            // thread/run id, null when free
      claimedAt: string | null;
      claimScope: ClaimScope;              // "machine" in v1; field per decision 9.5
      lastSeen: string;
      stale: boolean;
    }

    export function enumerateDevices(ctx: BenchContext): Promise<{ families: FamilyStatus[]; devices: BenchDeviceRecord[] }>;
    export function claimDevice(db: Database.Database, deviceId: string, holder: string): ClaimResult;
    export function refreshClaim(db: Database.Database, deviceId: string, holder: string): void;
    export function releaseDevice(db: Database.Database, deviceId: string, holder: string): void;
    export function getHwStatus(ctx: BenchContext, q: PageQuery): Promise<Page<HwStatusEntry>>;

    -- Frozen AMD-0010 relational contract; do not migrate a duplicate
    -- (§5 bench_device plus the decision-9.5 fields AMD-0010 folds in):
    bench_device(device_id, kind, make, model, connection, transport,
                 claimed_by, claimed_at, claim_scope, last_seen)

Driver WPs (89–94) receive a claimed `BenchDeviceRecord` and its transport; they never enumerate or claim for themselves, and they never see a raw connection string that bypassed arbitration.

## Acceptance criteria

- [ ] Two concurrent claim attempts on one device yield exactly one holder, proven with real SQLite transactions; the loser's error names the holder.
- [ ] Release is idempotent and rejected for a non-holder; an expired claim frees on the next arbitration touch with reason `expired`.
- [ ] A family with missing tooling reports `unavailable` with reason while other families enumerate normally; nothing throws.
- [ ] Helper installation runs only after explicit confirmation and is recorded; there is no code path that installs silently.
- [ ] Device identity is stable across rescans; disappeared devices mark stale and retain claim history rather than vanishing.
- [ ] `fs_hw_status` output is bounded and paged and includes claim holders and family availability.
- [ ] Transport and claim-scope fields round-trip through store, RPC, and `fs_hw_status` even though only `local-*`/`machine` are exercised in v1.
- [ ] CI (no hardware, no helpers) passes: enumeration returns empty families with reasons, and hardware-dependent tests skip cleanly.
- [ ] Nothing from this lane writes to `verification_results` or any attestation path; device panel has all four designed states, tokens, and Hugeicons.

## Test plan

Fake family adapters: scripted enumeration fixtures per family (present, absent-tooling, flaky) so no test needs hardware.

- claims.test.ts — concurrent claim race (two writers, real SQLite, one winner), non-holder release rejected (**error path**), idempotent release, expiry frees and records, refresh extends.
- enumerate.test.ts — per-family isolation when one adapter throws (**error path**), identity stability across rescans, stale marking and recovery on reappearance.
- store.test.ts — upsert semantics, last_seen advancement, transport/claim-scope round-trip, paged queries.
- helpers.test.ts — missing helper produces a proposal, unconfirmed proposal installs nothing (**safety error path**), confirmed install recorded, failure recorded with family left `unavailable`.
- hw-status.test.ts — bounded paged output, claim holders and family reasons present, budget clamp on a 200-device fixture.
- device-panel.test.tsx — grouping, stale and unavailable rendering with install affordance, claim/release flow, four states.

## Do not

- Do not allow more than one claimant per device, a driver-side claim bypass, or caller-supplied connection strings into driver WPs.
- Do not install helper libraries, drivers, or udev rules without an explicit recorded confirmation.
- Do not delete disappeared devices or expired-claim history; mark and retain.
- Do not hardcode local-USB assumptions into interfaces — transport and claim scope are fields, per decision 9.5.
- Do not let anything here become verification evidence; tier D is diagnostic only.
- Do not register agent tools, mentions, directives, or CLI; WP-96/WP-64 consume the exported services.

## Open questions

1. Claim refresh mechanics: explicit `refreshClaim` from holders is the v1 shape, but thread-liveness-based expiry (is the claiming thread still running?) would be more honest — depends on what the SDK exposes about thread state; investigate before WP-89 builds long GDB sessions on top.
2. Which enumeration backends are first-class in v1 per family — e.g. probe detection via `probe-rs list` vs vendor tools (J-Link, OpenOCD config probing) — needs an owner pick per family; the descriptor table makes each choice cheap to change.
3. Whether the serial family's port enumeration lives here (registry owns all enumeration) or delegates to WP-87's helper process. Working assumption: here, via the same Python helper, so the registry is the single source of device identity — confirm with the WP-87 owner.
