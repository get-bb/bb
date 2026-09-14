import assert from "node:assert/strict";
import { DEMO_COMMITS } from "./demo-data.js";
import {
  ancestorsOf,
  childrenMapOf,
  computeLanes,
  depthFromRoots,
} from "./shared.js";
import * as compact from "./variant-compact.js";
import * as curve from "./variant-curve.js";
import * as dag from "./variant-dag.js";

const hashes = new Set(DEMO_COMMITS.map((c) => c.hash));
assert.ok(DEMO_COMMITS.length >= 12, "dataset size");

const branches = new Set(
  DEMO_COMMITS.flatMap((c) =>
    c.refs.filter((r) => r.kind === "branch").map((r) => r.name),
  ),
);
assert.ok(branches.size >= 3, `expected 3+ branches, got ${[...branches]}`);
assert.ok(
  DEMO_COMMITS.some((c) => c.refs.some((r) => r.kind === "tag")),
  "dataset has a tag",
);
assert.ok(
  DEMO_COMMITS.some((c) => c.refs.some((r) => r.kind === "remote")),
  "dataset has remote refs",
);
assert.ok(
  DEMO_COMMITS.some((c) => c.refs.some((r) => r.isHead)),
  "dataset marks HEAD",
);

const children = childrenMapOf(DEMO_COMMITS);
const forks = DEMO_COMMITS.filter(
  (c) => (children.get(c.hash) ?? []).length > 1,
);
assert.ok(forks.length >= 2, `expected 2+ forks, got ${forks.length}`);
const merges = DEMO_COMMITS.filter((c) => c.parents.length > 1);
assert.ok(merges.length >= 1, "expected at least one merge commit");
for (const commit of DEMO_COMMITS) {
  for (const parent of commit.parents) {
    assert.ok(hashes.has(parent), `known parent ${parent}`);
  }
}

const lanes = computeLanes(DEMO_COMMITS);
assert.equal(lanes.rows.length, DEMO_COMMITS.length);
const mergeRow = lanes.rows.find((r) => r.hash === merges[0].hash);
assert.equal(
  mergeRow.outOfDot.length,
  merges[0].parents.length,
  "merge forks lanes",
);

const chain = ancestorsOf(DEMO_COMMITS, merges[0].hash);
assert.ok(
  chain.has(DEMO_COMMITS[DEMO_COMMITS.length - 1].hash),
  "ancestry reaches root",
);

const depths = depthFromRoots(DEMO_COMMITS);
for (const commit of DEMO_COMMITS) {
  for (const parent of commit.parents) {
    assert.ok(
      depths.get(parent) < depths.get(commit.hash),
      `DAG depth ordering ${parent} -> ${commit.hash}`,
    );
  }
}

const compactLayout = compact.compute(DEMO_COMMITS);
assert.ok(compactLayout.graphWidth > 0);
assert.equal(compactLayout.rows.length, DEMO_COMMITS.length);

const curveLayout = curve.compute(DEMO_COMMITS);
const expectedEdges = DEMO_COMMITS.reduce(
  (sum, c) => sum + c.parents.length,
  0,
);
assert.equal(
  curveLayout.edges.length,
  expectedEdges,
  "one edge per parent link",
);

const dagLayout = dag.compute(DEMO_COMMITS);
assert.equal(dagLayout.nodes.length, DEMO_COMMITS.length);
assert.equal(dagLayout.edges.length, expectedEdges);
assert.ok(dagLayout.nodes.some((n) => n.isFork));
assert.ok(dagLayout.nodes.some((n) => n.isMerge));

console.log(
  `gallery selftest passed: ${DEMO_COMMITS.length} commits, ${branches.size} branches, ` +
    `${forks.length} forks, ${merges.length} merges, ${expectedEdges} DAG edges`,
);
