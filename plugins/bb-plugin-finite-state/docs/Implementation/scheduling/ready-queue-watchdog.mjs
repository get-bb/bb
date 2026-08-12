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

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "wp-coupling-manifest.json"), "utf8"),
);
const coordinator = process.env.BB_COORDINATOR_THREAD;
// cwd is the automations plugin data directory, which is writable and stable.
const stateFile = join(process.cwd(), "fs-ready-queue-watchdog-state.json");
const RENUDGE_MS = 30 * 60 * 1000;

const bb = (args) =>
  execFileSync(process.env.BB_CLI || "bb", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

const { tasks } = JSON.parse(bb(["tasks", "list", "--limit", "500", "--json"]));
const statusByKey = new Map(tasks.map((t) => [t.key, t.status]));
const wps = manifest.workPackages;
const statusOf = (w) => statusByKey.get(w.task) ?? "unknown";

const done = new Set(wps.filter((w) => statusOf(w) === "done").map((w) => w.wp));
const busyClusters = new Set(
  wps
    .filter((w) => ["in_progress", "in_review"].includes(statusOf(w)))
    .map((w) => w.clusterId),
);
const terminal = (s) => ["done", "canceled", "cancelled"].includes(s);
const lowestInCluster = (w) => {
  const clusterIncomplete = wps.filter(
    (x) => x.clusterId === w.clusterId && !terminal(statusOf(x)),
  );
  return w.sequence === Math.min(...clusterIncomplete.map((x) => x.sequence));
};

// Two tiers. "todo" on the board is the coordinator-declared ready queue
// (early WP tasks were never statused "done", so board-side dependency
// evaluation alone under-reports). "backlog" entries additionally require
// every manifest dependency to be board-done.
const ready = wps.filter((w) => {
  const s = statusOf(w);
  if (s === "todo") return !busyClusters.has(w.clusterId) && lowestInCluster(w);
  if (s === "backlog")
    return (
      !busyClusters.has(w.clusterId) &&
      w.dependencies.every((d) => done.has(d)) &&
      lowestInCluster(w)
    );
  return false;
});

const readyKeys = ready.map((w) => `${w.wp}:${w.task}`).sort();
let prev = { keys: [], lastNudge: 0 };
if (existsSync(stateFile)) {
  try {
    prev = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    /* corrupted state resets to defaults */
  }
}
const changed = JSON.stringify(readyKeys) !== JSON.stringify(prev.keys);
const renudge = Date.now() - (prev.lastNudge || 0) > RENUDGE_MS;

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
  writeFileSync(
    stateFile,
    JSON.stringify({ keys: readyKeys, lastNudge: Date.now() }),
  );
} else if (changed) {
  writeFileSync(
    stateFile,
    JSON.stringify({ keys: readyKeys, lastNudge: prev.lastNudge || 0 }),
  );
}

console.log(JSON.stringify({ wakeAgent: false }));
