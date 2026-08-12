# WP-54 — Bench timeline panel, run detail & live log tail

**Lane:** L6 Bench · **Spec refs:** SPEC 05 B8–B9, X14.3–X14.6 · SPEC 00 §5, §7, §10 · RECON §1.2–1.3, §1.8 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-52, WP-53, WP-07 · **Blocks:** WP-55, WP-61, WP-67
**Produces a FROZEN artifact:** no — consumes frozen RPC/HTTP contracts and WP-52 repositories

## Files you own

    plugins/bb-plugin-finite-state/lanes/bench/register.app.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/bench-panel.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/run-timeline.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/run-launcher.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/run-detail.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/log-tail.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/artifact-list.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/host-enrollment.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/bench-run-card.tsx
    plugins/bb-plugin-finite-state/lanes/bench/app/verdict-card.tsx  # compiling placeholder → WP-55
    plugins/bb-plugin-finite-state/lanes/bench/app/**/*.test.tsx

Create verdict-card.tsx as a compiling placeholder that WP-55 replaces in place. Do not implement verdict logic here.

## Files you must not touch

app.tsx, server.ts, shared/contract.ts, frozen store/context/remote-service files, lanes/bench/register.ts, package.json, pnpm-lock.yaml, or another lane.

## Context

The bench panel indexes long-lived run threads and their evidence. The native bb thread terminal is the primary live execution log. The detail pane provides a bounded cached tail, artifact links, configuration, results, and verdict; it is not a second terminal implementation.

RPC carries JSON pages. bb.http streams large logs, artifacts, and attestation envelopes. Realtime signals are tiny hints and may be missed.

## What to build

1. Replace the bench frontend registration stub with one Bench nav panel and the existing threadPanelAction if declared by the frozen app contract.
2. Build a newest-first virtualized timeline with status label/icon, tier, kind, trigger, duration, verdict summary, thread link, firmware digest prefix, and signed/unsigned label. Filters are tier, status, trigger, version, and failing only.
3. Implement a Run launcher for Tier 0/1. It selects version, tier, host, optional requirement/target, and all Tier-1 deployment-context fields. Show firmware preflight and prerequisites before confirmation.
4. Implement host enrollment UI around the human RPC from WP-53. Display join code and expiry, instructions to run host-daemon on the target, and refresh enrolled host status. Do not imply a process is enrolled until bb lists the host.
5. Implement bench/<runId> as timeline plus detail. Sections are config, requirement/check results, live log link/tail, artifacts, attestation, and WP-55 verdict.
6. Link directly to the native run thread. The thread panel action self-fetches from runId and remains useful after reload.
7. Implement cursor-paged log tail RPC for bounded lines. On bench:log, refetch after the last sequence. Detect gaps/out-of-order hints and request from the last committed cursor. Offer a bb.http download for complete/large logs.
8. Stream artifacts through local-auth HTTP routes. Render only safe logical names and verified hashes; unknown/expired artifacts show a recovery state. Never turn an upstream path into a client URL.
9. BenchRunCard accepts id only and self-fetches for later directive reuse.
10. Implement loading skeleton, empty with Run Tier 0 action, error with stale timeline plus retry, and unconfigured host/Forge states.

## Interface contract

    export interface BenchRunCardProps {
      id: string;
    }

    export interface BenchTimelineQuery {
      pvId?: string;
      tier?: BenchTier;
      status?: BenchRunStatus;
      trigger?: string;
      failingOnly?: boolean;
      cursor?: string;
      limit?: number;
    }

    export interface BenchLogPage {
      runId: string;
      items: Array<{ seq: number; at: string; stream: "stdout" | "stderr" | "event"; text: string }>;
      total: number;
      cursor?: string;
      complete: boolean;
    }

    export interface BenchArtifactLink {
      runId: string;
      name: string;
      kind: string;
      sha256: string | null;
      bytes: number | null;
      downloadPath: string;
    }

    GET /api/v1/plugins/finite-state/http/bench/runs/<run-id>/log
    GET /api/v1/plugins/finite-state/http/bench/runs/<run-id>/artifacts/<artifact-name>
    GET /api/v1/plugins/finite-state/http/bench/runs/<run-id>/attestation

All directive-like components fetch by validated IDs. Signal payloads never supply row/log content.

## Acceptance criteria

- [ ] Timeline and logs are virtualized/paged and remain bounded for large histories.
- [ ] Each run links to its actual bb thread; no custom terminal is built.
- [ ] Host enrollment uses the WP-53 human flow and explicitly requires host-daemon.
- [ ] Run launcher prevents Tier-1 start until firmware and host prerequisites pass.
- [ ] Log hints can be missed, duplicated, or reordered without losing/duplicating displayed lines.
- [ ] Large logs/artifacts use bb.http; RPC returns only pages/metadata.
- [ ] BenchRunCard accepts only id and self-fetches.
- [ ] Absolute/upstream paths never appear in browser data.
- [ ] Four states, Hugeicons, bb tokens, shared UI, and accessible status labels are complete.

## Test plan

- run-timeline.test.tsx — virtualization, filters, stable paging, thread link, unsigned badge, and late status refetch.
- run-launcher.test.tsx — Tier 0, Tier 1 deployment context, missing firmware/host prerequisites, confirmation, and double-submit guard.
- host-enrollment.test.tsx — join code/expiry, daemon instruction, expired code, and host not considered ready until list confirms.
- log-tail.test.tsx — pagination, duplicate/out-of-order/missed signals, reconnect, bounded DOM, full-log download, and RPC failure retains prior tail.
- artifact-list.test.tsx — safe names, hash display, expired locator, HTTP error, and malicious path never becomes href.
- run-detail.test.tsx — all sections, unknown run, stale cache, and self-fetching card.

## Do not

- Do not build a terminal emulator or stream logs through realtime payloads.
- Do not put artifact/log bytes or entire evidence payloads in RPC.
- Do not expose a join code after expiry or claim bb.hosts enrolled the target.
- Do not render status by color alone or use emoji/Lucide/literal colors.
- Do not calculate a safe-to-OTA verdict in UI code; WP-55 owns one pure evaluator.

## Open questions

1. The exact thread navigation helper and threadPanelAction params must follow the frozen app contract.
2. Full-log storage may be a host-thread artifact rather than a Forge path. The HTTP adapter should support the approved logical locator from WP-52.
3. Confirm the canonical display labels for first-class `kind` and `trigger` values; preserve unknown upstream values visibly instead of collapsing them into a misleading known label.
