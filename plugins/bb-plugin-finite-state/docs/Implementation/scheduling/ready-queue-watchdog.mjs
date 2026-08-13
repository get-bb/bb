#!/usr/bin/env node
// Ready-queue watchdog (advisory only).
//
// Computes dependency-ready, cluster-free work packages from
// wp-coupling-manifest.json plus live Tasks state, and queues a nudge to the
// coordinator thread when undispatched candidates exist. It never dispatches,
// never selects presets, and never changes the lane cap — COORDINATOR-RUNBOOK
// §2–§4 remain the coordinator's job. Run by the "fs-ready-queue-watchdog"
// script automation with BB_PROJECT_ID and BB_COORDINATOR_THREAD injected.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two tiers. "todo" on the board is the coordinator-declared ready queue
 * (early WP tasks were never statused "done", so board-side dependency
 * evaluation alone under-reports). "backlog" entries additionally require
 * every manifest dependency to be satisfied.
 *
 * A dependency absent from the manifest is treated as satisfied: the manifest
 * deliberately omits completed L0 packages (WP01, WP03–WP07) while still
 * referencing them as dependencies, so requiring board-done for them would
 * permanently hide every package gated on one.
 *
 * Packages named in `dispatchPolicy.prohibitedWorkPackages` or the distinct
 * temporary `stoppedWorkPackages` policy are never surfaced. Each temporary
 * stop carries a versioned reason and explicit resume condition in the
 * manifest. `exclude` adds config-side keys on top, as belt-and-braces.
 */
export function computeReady(
  manifest,
  statusByKey,
  { exclude = new Set() } = {},
) {
  const wps = manifest.workPackages;
  const prohibited = new Set([
    ...(manifest.dispatchPolicy?.prohibitedWorkPackages ?? []),
    ...(manifest.dispatchPolicy?.stoppedWorkPackages ?? []),
    ...exclude,
  ]);
  const statusOf = (w) => statusByKey.get(w.task) ?? "unknown";
  const terminal = (s) => ["done", "canceled", "cancelled"].includes(s);

  const knownInManifest = new Set(wps.map((w) => w.wp));
  const done = new Set(
    wps.filter((w) => statusOf(w) === "done").map((w) => w.wp),
  );
  const satisfied = (d) => !knownInManifest.has(d) || done.has(d);

  const busyClusters = new Set(
    wps
      .filter((w) => ["in_progress", "in_review"].includes(statusOf(w)))
      .map((w) => w.clusterId),
  );

  const lowestInCluster = (w) => {
    const clusterIncomplete = wps.filter(
      (x) => x.clusterId === w.clusterId && !terminal(statusOf(x)),
    );
    // A candidate is itself non-terminal, so the set is never empty here;
    // the guard keeps a future caller from marking a finished cluster ready.
    if (clusterIncomplete.length === 0) return false;
    return w.sequence === Math.min(...clusterIncomplete.map((x) => x.sequence));
  };

  return wps.filter((w) => {
    if (prohibited.has(w.wp)) return false;
    if (busyClusters.has(w.clusterId)) return false;
    const s = statusOf(w);
    if (s === "todo") return lowestInCluster(w);
    if (s === "backlog")
      return w.dependencies.every(satisfied) && lowestInCluster(w);
    return false;
  });
}

/**
 * Frozen-board stall detection (2026-08-13 outage lesson: the coordinator's
 * shell died at 06:31 with lanes mid-flight; finished work froze at
 * in_progress, which made the ready set legitimately empty, so the
 * ready-queue nudge — correctly — never fired and nobody noticed for an
 * hour). A dead coordinator is indistinguishable from a busy one by ready
 * math alone, so this watches for the opposite signal: tasks are in flight
 * but NOTHING on the board has transitioned for `stallMs`.
 *
 * Advisory and rate-limited like the ready nudge. Long-running lanes can
 * legitimately hold a status for a while, hence the generous default; the
 * escalation asks for a liveness check, it does not claim an outage.
 */
export function detectStall(statusByKey, prev, now, { stallMs } = {}) {
  const threshold = stallMs ?? 90 * 60 * 1000;
  const fingerprint = [...statusByKey.entries()]
    .map(([key, status]) => `${key}:${status}`)
    .sort()
    .join("|");
  const inFlight = [...statusByKey.values()].filter((s) =>
    ["in_progress", "in_review"].includes(s),
  ).length;
  const since =
    fingerprint === prev.fingerprint && prev.fingerprintSince
      ? prev.fingerprintSince
      : now;
  return {
    fingerprint,
    since,
    inFlight,
    stalled: inFlight > 0 && now - since >= threshold,
  };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(here, "wp-coupling-manifest.json"), "utf8"),
  );
  const coordinator = process.env.BB_COORDINATOR_THREAD;
  // Default cwd is the automations plugin data directory (stable, writable);
  // FS_WATCHDOG_STATE_DIR pins the dedup state location explicitly.
  const stateDir = process.env.FS_WATCHDOG_STATE_DIR || process.cwd();
  const stateFile = join(stateDir, "fs-ready-queue-watchdog-state.json");
  const RENUDGE_MS = 30 * 60 * 1000;

  // Manifest prohibitions are handled inside computeReady; the env var is a
  // config-side belt-and-braces layer on top.
  const exclude = new Set(
    (process.env.FS_WATCHDOG_EXCLUDE?.split(",") ?? [])
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const bb = (args) =>
    execFileSync(process.env.BB_CLI || "bb", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });

  const { tasks } = JSON.parse(
    bb(["tasks", "list", "--limit", "500", "--json"]),
  );
  const statusByKey = new Map(tasks.map((t) => [t.key, t.status]));

  const ready = computeReady(manifest, statusByKey, { exclude });

  const readyKeys = ready.map((w) => `${w.wp}:${w.task}`).sort();
  let prev = { keys: [], lastNudge: 0 };
  if (existsSync(stateFile)) {
    try {
      prev = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      /* corrupted state resets to defaults */
    }
  }
  const now = Date.now();
  const changed = JSON.stringify(readyKeys) !== JSON.stringify(prev.keys);
  const renudge = now - (prev.lastNudge || 0) > RENUDGE_MS;

  let lastNudge = prev.lastNudge || 0;
  if (readyKeys.length > 0 && coordinator && (changed || renudge)) {
    const lines = ready
      .map(
        (w) =>
          `- ${w.task} (${w.wp}, ${w.clusterId} seq ${w.sequence}, preset ${w.preset})`,
      )
      .join("\n");
    bb([
      "thread",
      "tell",
      coordinator,
      "--mode",
      "queue",
      `Ready-queue watchdog: ${ready.length} dependency-ready, cluster-free work package(s) awaiting dispatch:\n${lines}\n\nApply COORDINATOR-RUNBOOK §2–§4 (validator, cap check, preset) before dispatching. Automated advisory; no reply needed.`,
    ]);
    lastNudge = now;
  }

  // Frozen-board escalation: in-flight tasks with zero board transitions for
  // the stall window means the coordinator may be dead mid-flow (the ready
  // set is typically empty in exactly that failure, so the nudge above
  // cannot fire). Escalate to the supervisor thread, which can investigate;
  // the coordinator gets a copy in queue mode in case it is merely asleep.
  const stall = detectStall(statusByKey, prev, now, {
    stallMs: Number(process.env.FS_WATCHDOG_STALL_MS) || undefined,
  });
  let lastStallNudge = prev.lastStallNudge || 0;
  if (stall.stalled && now - lastStallNudge > RENUDGE_MS) {
    const supervisor = process.env.BB_SUPERVISOR_THREAD;
    const minutes = Math.round((now - stall.since) / 60000);
    const message = `Watchdog stall escalation: ${stall.inFlight} task(s) are in_progress/in_review but no board status has changed in ${minutes} minutes. Verify the coordinator thread is alive and processing (its shell can die while the thread still shows active — see the 2026-08-13 06:31 outage). Automated advisory.`;
    for (const target of [supervisor, coordinator].filter(Boolean)) {
      try {
        bb(["thread", "tell", target, "--mode", "queue", message]);
      } catch {
        /* one dead recipient must not block the other */
      }
    }
    lastStallNudge = now;
  }

  writeFileSync(
    stateFile,
    JSON.stringify({
      keys: readyKeys,
      lastNudge,
      fingerprint: stall.fingerprint,
      fingerprintSince: stall.since,
      lastStallNudge,
    }),
  );

  console.log(
    JSON.stringify({
      wakeAgent: false,
      ready: readyKeys.length,
      inFlight: stall.inFlight,
      stalled: stall.stalled,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
