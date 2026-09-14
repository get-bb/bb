import { registerHooks } from "node:module";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

registerHooks({
  resolve(specifier, context, next) {
    const parentUrl = context.parentURL ?? "";
    if (
      specifier.startsWith(".") &&
      specifier.endsWith(".js") &&
      parentUrl.includes(`${path.sep === "\\" ? "/" : ""}plugins/git-graph/`)
    ) {
      return next(specifier.replace(/\.js$/u, ".ts"), context);
    }
    return next(specifier, context);
  },
});

const run = promisify(execFile);

const REPO =
  process.env.GIT_GRAPH_ACCEPTANCE_REPO ?? "C:/WS/FA_develop/financeaccounting";
const LIMIT = Number(process.env.GIT_GRAPH_ACCEPTANCE_LIMIT ?? 300);
const BACKGROUND = "#161a22";

async function loadHistoryFromRepo() {
  const format = ["%H", "%h", "%P", "%an", "%ae", "%ad", "%s"].join("\x1f");
  const { stdout } = await run(
    "git",
    [
      "-C",
      REPO,
      "-c",
      "core.quotepath=false",
      "-c",
      "core.fsmonitor=false",
      "log",
      "HEAD",
      "--branches",
      "--date-order",
      "--date=iso-strict",
      "-n",
      String(LIMIT),
      `--format=${format}\x1e`,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
  );
  const commits = [];
  for (const rawRecord of stdout.split("\x1e")) {
    const record = rawRecord.replace(/^[\r\n]+/u, "");
    if (record.trim().length === 0) continue;
    const [
      hash,
      abbrev,
      parents,
      authorName,
      authorEmail,
      authorDate,
      subject,
    ] = record.split("\x1f");
    commits.push({
      hash,
      abbrev,
      parents: parents.length === 0 ? [] : parents.split(" ").filter(Boolean),
      subject,
      authorName,
      authorEmail,
      authorDate,
      refs: [],
    });
  }
  const head = (
    await run("git", ["-C", REPO, "rev-parse", "HEAD"])
  ).stdout.trim();
  for (const commit of commits) {
    if (commit.hash === head) {
      commit.refs = [{ name: "HEAD", kind: "other", isHead: true }];
    }
  }
  return { commits, repo: REPO };
}

async function loadDemoHistory() {
  const { DEMO_COMMITS } = await import("./gallery/demo-data.js");
  return { commits: DEMO_COMMITS, repo: "gallery demo fixture" };
}

const source = await loadHistoryFromRepo().catch(() => loadDemoHistory());
const commits = source.commits;

const { computeGraphEdges, computeGraphLayout } =
  await import("./graph/layout.ts");
const geometry = await import("./graph/geometry.ts");
const { laneColor } = await import("./graph/palette.ts");

const layout = computeGraphLayout(commits);
const { edges, openEdges } = computeGraphEdges(commits, layout);

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const loaded = new Set(commits.map((commit) => commit.hash));
const loadedParentLinks = commits.reduce(
  (sum, commit) =>
    sum + commit.parents.filter((parent) => loaded.has(parent)).length,
  0,
);
check(
  edges.length === loadedParentLinks,
  `closed edges ${edges.length} != loaded parent links ${loadedParentLinks}`,
);

function anchorsOf(d) {
  return [...d.matchAll(/([MC])([^MC]*)/gu)].map(([, command, values]) =>
    values
      .split(",")
      .map(Number)
      .slice(command === "M" ? 0 : 4),
  );
}

function samePoint(a, b) {
  return (
    a !== undefined &&
    Math.abs(a[0] - b[0]) < 1e-6 &&
    Math.abs(a[1] - b[1]) < 1e-6
  );
}

for (const edge of edges) {
  const strokes = geometry.edgeStrokes(edge, {
    index: edge.toIndex,
    lane: edge.toLane,
  });
  const label = `${edge.fromHash.slice(0, 8)}->${edge.toHash.slice(0, 8)}`;
  check(
    samePoint(anchorsOf(strokes[0].d)[0], [
      geometry.laneX(edge.fromLane),
      geometry.rowCenterY(edge.fromIndex),
    ]),
    `edge ${label} does not start on its commit dot`,
  );
  check(
    samePoint(anchorsOf(strokes.at(-1).d).at(-1), [
      geometry.laneX(edge.toLane),
      geometry.rowCenterY(edge.toIndex),
    ]),
    `edge ${label} does not end on its parent dot`,
  );
  for (let row = edge.fromIndex + 1; row < edge.toIndex; row += 1) {
    check(
      layout.rows[row].lane !== edge.runLane,
      `edge ${label} runs through ${layout.rows[row].hash.slice(0, 8)}`,
    );
  }
}

const width = geometry.graphColumnWidth(layout.maxLane);
const height = commits.length * geometry.ROW_HEIGHT;
const textWidth = 560;
const strokesSvg = (route, end) =>
  geometry
    .edgeStrokes(route, end)
    .map(
      (stroke) =>
        `<path d="${stroke.d}" fill="none" stroke="${laneColor(stroke.colorIndex)}" stroke-width="${geometry.STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width + textWidth}" height="${height}" viewBox="0 0 ${width + textWidth} ${height}">`,
  `<rect width="${width + textWidth}" height="${height}" fill="${BACKGROUND}"/>`,
  ...edges.map((edge) =>
    strokesSvg(edge, { index: edge.toIndex, lane: edge.toLane }),
  ),
  ...openEdges.map((edge) =>
    strokesSvg(edge, { index: commits.length, lane: edge.runLane }),
  ),
  ...commits.map((commit, index) => {
    const row = layout.rows[index];
    const x = geometry.laneX(row.lane);
    const y = geometry.rowCenterY(index);
    const color = laneColor(row.colorIndex);
    const isHead = commit.refs.some((ref) => ref.isHead);
    const halo =
      !isHead && commit.parents.length > 1
        ? `<circle cx="${x}" cy="${y}" r="${geometry.MERGE_HALO_RADIUS}" fill="none" stroke="${color}" stroke-width="${geometry.MERGE_HALO_STROKE_WIDTH}" stroke-opacity="${geometry.MERGE_HALO_OPACITY}"/>`
        : "";
    const dot = isHead
      ? `<circle cx="${x}" cy="${y}" r="${geometry.RING_RADIUS}" fill="${BACKGROUND}" stroke="${color}" stroke-width="${geometry.RING_STROKE_WIDTH}"/>`
      : `<circle cx="${x}" cy="${y}" r="${geometry.DOT_RADIUS}" fill="${color}"/>`;
    return `${halo}${dot}<text x="${width + 8}" y="${y + 4}" fill="#e6e9ef" font-size="12" font-family="Segoe UI, sans-serif">${escapeXml(commit.subject.slice(0, 80))}</text>`;
  }),
  `</svg>`,
].join("\n");

const artifact = path.join(tmpdir(), "git-graph-production-render.svg");
writeFileSync(artifact, svg, "utf8");

const merges = commits.filter((commit) => commit.parents.length > 1);
console.log(`source: ${source.repo}`);
console.log(
  [
    `commits: ${commits.length}, merges: ${merges.length}, maxLane: ${layout.maxLane}`,
    `graph column: ${width}px wide, row ${geometry.ROW_HEIGHT}px, lane ${geometry.LANE_WIDTH}px`,
    `edges: ${edges.length} closed + ${openEdges.length} open`,
    `render artifact: ${artifact}`,
  ].join("\n"),
);

if (failures.length > 0) {
  console.error(`FAILURES:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("production render smoke passed");

function escapeXml(value) {
  return value.replace(/[<>&'"]/gu, (char) =>
    char === "<"
      ? "&lt;"
      : char === ">"
        ? "&gt;"
        : char === "&"
          ? "&amp;"
          : char === "'"
            ? "&apos;"
            : "&quot;",
  );
}
