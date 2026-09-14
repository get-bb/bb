import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const galleryDir = path.dirname(fileURLToPath(import.meta.url));
const { JSDOM } = await import("jsdom");

const dom = new JSDOM(
  '<!doctype html><html><body><div id="stage"></div></body></html>',
  { pretendToBeVisual: true, runScripts: "dangerously" },
);
const { window } = dom;
const d3Source = readFileSync(
  path.resolve(galleryDir, "../node_modules/d3/dist/d3.js"),
  "utf8",
);
window.eval(d3Source);
const d3 = window.d3;
assert.ok(d3 !== undefined, "d3 UMD bundle loaded into jsdom");
assert(typeof d3.curveBumpY === "function", "d3.curveBumpY available");
assert(typeof d3.line === "function", "d3.line available");

const { DEMO_COMMITS } = await import("./demo-data.js");

async function renderVariant(modulePath, assertDom) {
  const mod = await import(modulePath);
  const stage = window.document.querySelector("#stage");
  stage.replaceChildren();
  const instance = mod.render({ stage, commits: DEMO_COMMITS, d3 });
  assertDom(stage);
  instance.destroy();
  assert.equal(stage.children.length, 0, `${modulePath} destroy cleans up`);
}

await renderVariant("./variant-compact.js", (stage) => {
  const rows = stage.querySelectorAll("div.gg-row");
  assert.equal(rows.length, DEMO_COMMITS.length, "compact rows rendered");
  assert.ok(
    stage.querySelectorAll("svg").length >= DEMO_COMMITS.length,
    "compact lane svgs rendered",
  );
  assert.ok(
    stage.textContent.includes("HEAD → main"),
    "compact shows HEAD ref pill",
  );
  assert.ok(
    stage.textContent.includes("Release 1.2"),
    "compact shows newest subject",
  );
  const headerCells = [...stage.querySelectorAll(".gg-list-header-cell")].map(
    (cell) => cell.textContent,
  );
  assert.deepEqual(headerCells, ["Graph", "Description", "Date"]);
});

await renderVariant("./variant-curve.js", (stage) => {
  assert.equal(
    stage.querySelectorAll("div.gg-row").length,
    DEMO_COMMITS.length,
    "curve rows rendered",
  );
  const edges = stage.querySelectorAll("path.gg-curve-edge");
  const expectedEdges = DEMO_COMMITS.reduce(
    (sum, commit) => sum + commit.parents.length,
    0,
  );
  assert.equal(edges.length, expectedEdges, "curve edges rendered");
  assert.equal(
    stage.querySelectorAll("g.gg-curve-node").length,
    DEMO_COMMITS.length,
    "curve nodes rendered",
  );
  assert.equal(
    stage.querySelectorAll("circle.gg-curve-merge-ring").length,
    DEMO_COMMITS.filter((c) => c.parents.length > 1).length,
    "merge rings rendered",
  );
  const chainRow = [...stage.querySelectorAll("div.gg-row")].find((row) =>
    row.textContent.includes("Polish login error states"),
  );
  chainRow.dispatchEvent(new window.MouseEvent("mouseenter"));
  const dimmed = stage.querySelectorAll("div.gg-row.gg-dim").length;
  assert.ok(dimmed > 0, "hover dims rows outside the ancestry chain");
  chainRow.dispatchEvent(new window.MouseEvent("mouseleave"));
  assert.equal(
    stage.querySelectorAll("div.gg-row.gg-dim").length,
    0,
    "leaving hover clears the chain",
  );
});

await renderVariant("./variant-dag.js", (stage) => {
  assert.equal(
    stage.querySelectorAll("g.gg-dag-node").length,
    DEMO_COMMITS.length,
    "dag nodes rendered",
  );
  const expectedEdges = DEMO_COMMITS.reduce(
    (sum, commit) => sum + commit.parents.length,
    0,
  );
  assert.equal(
    stage.querySelectorAll("path.gg-dag-edge").length,
    expectedEdges,
    "dag parent edges rendered",
  );
  assert.ok(stage.textContent.includes("fork"), "dag labels forks");
  assert.ok(stage.textContent.includes("merge"), "dag labels merges");
  const middle = [...stage.querySelectorAll("g.gg-dag-node")].find((node) =>
    node.textContent.includes("Wire login form to"),
  );
  middle.dispatchEvent(new window.MouseEvent("mouseenter"));
  assert.ok(
    stage.querySelectorAll("g.gg-dag-node.gg-dim").length > 0,
    "dag hover dims nodes outside upstream/downstream",
  );
  middle.dispatchEvent(new window.MouseEvent("mouseleave"));
});

console.log(
  `gallery render smoke passed: 3 variants rendered ${DEMO_COMMITS.length} commits and all parent edges in jsdom + d3`,
);
