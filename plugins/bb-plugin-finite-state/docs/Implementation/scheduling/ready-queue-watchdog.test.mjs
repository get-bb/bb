import test from "node:test";
import assert from "node:assert/strict";
import { computeReady } from "./ready-queue-watchdog.mjs";

const wp = (over) => ({
  wp: "WP99",
  task: "FS-99",
  lane: "L9",
  clusterId: "C-TEST",
  ownerKey: "owner-test",
  executionMode: "sequential",
  sequence: 1,
  riskTier: "standard",
  preset: "fs-standard",
  dependencies: [],
  reason: "test",
  ...over,
});

const manifest = (workPackages) => ({ schemaVersion: 1, workPackages });
const statuses = (obj) => new Map(Object.entries(obj));
const readyWps = (m, s, opts) => computeReady(m, s, opts).map((w) => w.wp);

test("backlog WP whose only dependency is omitted from the manifest is ready", () => {
  // WP01/WP03–WP07 are deliberately absent from the manifest but referenced
  // as dependencies; they must count as satisfied.
  const m = manifest([
    wp({ wp: "WP47", task: "FS-61", clusterId: "C-A", dependencies: ["WP04"] }),
  ]);
  assert.deepEqual(readyWps(m, statuses({ "FS-61": "backlog" })), ["WP47"]);
});

test("backlog WP with a manifest-known dependency waits for board done", () => {
  const m = manifest([
    wp({ wp: "WP11", task: "FS-25", clusterId: "C-A", dependencies: ["WP10"] }),
    wp({ wp: "WP10", task: "FS-24", clusterId: "C-B" }),
  ]);
  assert.deepEqual(
    readyWps(m, statuses({ "FS-25": "backlog", "FS-24": "in_review" })),
    [],
  );
  assert.deepEqual(
    readyWps(m, statuses({ "FS-25": "backlog", "FS-24": "done" })),
    ["WP11"],
  );
});

test("a busy cluster blocks every tier", () => {
  const m = manifest([
    wp({ wp: "WP15", task: "FS-29", clusterId: "C-A", sequence: 1 }),
    wp({ wp: "WP16", task: "FS-30", clusterId: "C-A", sequence: 2 }),
  ]);
  assert.deepEqual(
    readyWps(m, statuses({ "FS-29": "in_progress", "FS-30": "todo" })),
    [],
  );
});

test("only the lowest incomplete sequence in a cluster is ready", () => {
  const m = manifest([
    wp({ wp: "WP15", task: "FS-29", clusterId: "C-A", sequence: 1 }),
    wp({ wp: "WP16", task: "FS-30", clusterId: "C-A", sequence: 2 }),
  ]);
  assert.deepEqual(
    readyWps(m, statuses({ "FS-29": "todo", "FS-30": "todo" })),
    ["WP15"],
  );
  // A canceled predecessor unblocks the successor.
  assert.deepEqual(
    readyWps(m, statuses({ "FS-29": "canceled", "FS-30": "todo" })),
    ["WP16"],
  );
});

test("todo tier surfaces without board-done dependencies", () => {
  const m = manifest([
    wp({
      wp: "WP14",
      task: "FS-28",
      clusterId: "C-A",
      dependencies: ["WP03", "WP06"],
    }),
    wp({ wp: "WP06", task: "FS-20", clusterId: "C-B" }),
  ]);
  // Coordinator declared FS-28 ready while its manifest-known dependency
  // WP06 is still in review — the todo tier trusts the declaration.
  assert.deepEqual(
    readyWps(m, statuses({ "FS-28": "todo", "FS-20": "in_review" })),
    ["WP14"],
  );
});

test("excluded WPs are never surfaced", () => {
  const m = manifest([
    wp({ wp: "WP02", task: "FS-16", clusterId: "C-A", dependencies: ["WP01"] }),
  ]);
  assert.deepEqual(
    readyWps(m, statuses({ "FS-16": "backlog" }), {
      exclude: new Set(["WP02"]),
    }),
    [],
  );
});

test("manifest-prohibited WPs are never surfaced, with no config needed", () => {
  const m = {
    ...manifest([
      wp({
        wp: "WP02",
        task: "FS-16",
        clusterId: "C-A",
        dependencies: ["WP01"],
      }),
      wp({ wp: "WP47", task: "FS-61", clusterId: "C-B" }),
    ]),
    dispatchPolicy: { prohibitedWorkPackages: ["WP02"] },
  };
  // WP02 is otherwise fully ready (backlog, omitted dep, free cluster) —
  // the versioned prohibition alone must hide it.
  assert.deepEqual(
    readyWps(m, statuses({ "FS-16": "backlog", "FS-61": "backlog" })),
    ["WP47"],
  );
});

test("temporarily stopped WPs are never surfaced from either ready tier", () => {
  const m = {
    ...manifest([
      wp({ wp: "WP32", task: "FS-46", clusterId: "C-A" }),
      wp({ wp: "WP56", task: "FS-70", clusterId: "C-B" }),
      wp({ wp: "WP47", task: "FS-61", clusterId: "C-C" }),
    ]),
    dispatchPolicy: { stoppedWorkPackages: ["WP32", "WP56"] },
  };
  assert.deepEqual(
    readyWps(
      m,
      statuses({
        "FS-46": "todo",
        "FS-70": "backlog",
        "FS-61": "backlog",
      }),
    ),
    ["WP47"],
  );
});

test("the shipped manifest prohibits WP02", async () => {
  const { readFileSync } = await import("node:fs");
  const shipped = JSON.parse(
    readFileSync(
      new URL("./wp-coupling-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(
    shipped.dispatchPolicy.prohibitedWorkPackages.includes("WP02"),
    "WP02 dispatch is prohibited by ADR — bb Is Not Modified",
  );
  assert.match(
    shipped.dispatchPolicy.prohibitedWorkPackageReasons.WP02,
    /ADR — bb Is Not Modified/u,
  );
});

test("the shipped manifest temporarily stops WP32 and WP56 with resume conditions", async () => {
  const { readFileSync } = await import("node:fs");
  const shipped = JSON.parse(
    readFileSync(
      new URL("./wp-coupling-manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(shipped.dispatchPolicy.stoppedWorkPackages, [
    "WP32",
    "WP56",
  ]);
  for (const wp of shipped.dispatchPolicy.stoppedWorkPackages) {
    const detail = shipped.dispatchPolicy.stoppedWorkPackageReasons[wp];
    assert.ok(detail.reason.length > 0, `${wp} needs a reason`);
    assert.ok(
      detail.resumeCondition.length > 0,
      `${wp} needs a resume condition`,
    );
  }
});

test("a fully terminal cluster yields nothing (no Infinity path)", () => {
  const m = manifest([
    wp({ wp: "WP15", task: "FS-29", clusterId: "C-A", sequence: 1 }),
    wp({ wp: "WP16", task: "FS-30", clusterId: "C-A", sequence: 2 }),
  ]);
  assert.deepEqual(
    readyWps(m, statuses({ "FS-29": "done", "FS-30": "done" })),
    [],
  );
});

test("unknown task keys are not ready", () => {
  const m = manifest([wp({ wp: "WP50", task: "FS-404", clusterId: "C-A" })]);
  assert.deepEqual(readyWps(m, statuses({})), []);
});
