import {
  computeLanes,
  laneColor,
  refLabel,
  relativeTime,
  ancestorsOf,
} from "./shared.js";

export const title = "Smooth curveBumpY lanes";
export const blurb =
  "Taller rows and D3 curveBumpY Bézier joins: edges flow like ribbons instead of hard S-curves. Hover a commit to light up its full ancestry chain.";

export const ROW_HEIGHT = 38;
export const LANE_WIDTH = 18;
export const LEFT_PAD = 12;

export function laneX(lane) {
  return LEFT_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

export function compute(commits) {
  const layout = computeLanes(commits);
  const edges = [];
  const rowsByHash = new Map(layout.rows.map((row) => [row.hash, row]));
  const indexByHash = new Map(commits.map((c, index) => [c.hash, index]));
  commits.forEach((commit, index) => {
    const row = rowsByHash.get(commit.hash);
    row.outOfDot.forEach((segment, parentIndex) => {
      const parent = commit.parents[parentIndex];
      if (parent === undefined || !indexByHash.has(parent)) return;
      edges.push({
        fromHash: commit.hash,
        toHash: parent,
        fromLane: row.lane,
        toLane: segment.toLane,
        colorIndex: segment.colorIndex,
        fromIndex: index,
        toIndex: indexByHash.get(parent),
      });
    });
  });
  return {
    ...layout,
    rowHeight: ROW_HEIGHT,
    graphWidth: LEFT_PAD + (layout.maxLane + 1) * LANE_WIDTH + 12,
    edges,
  };
}

export function render({ stage, commits, d3 }) {
  const layout = compute(commits);
  const rowsByHash = new Map(layout.rows.map((row) => [row.hash, row]));
  const bump = d3.line().curve(d3.curveBumpY);
  const svgHeight = commits.length * ROW_HEIGHT;

  const container = d3.select(stage).append("div").attr("class", "gg-curve");

  const header = container
    .append("div")
    .attr("class", "gg-list-header")
    .selectAll("div")
    .data([
      { label: "Graph", width: layout.graphWidth },
      { label: "Description · hover to trace ancestry", width: null },
      { label: "Date", width: 76 },
    ])
    .enter()
    .append("div")
    .attr(
      "class",
      (d) => `gg-list-header-cell${d.width === null ? " gg-flex" : ""}`,
    )
    .style("width", (d) => (d.width === null ? null : `${d.width}px`))
    .text((d) => d.label);

  const body = container.append("div").attr("class", "gg-curve-body");

  const graphSvg = body
    .append("svg")
    .attr("class", "gg-curve-svg")
    .attr("width", layout.graphWidth)
    .attr("height", svgHeight)
    .attr("viewBox", `0 0 ${layout.graphWidth} ${svgHeight}`);

  const edgeSelection = graphSvg
    .selectAll("path.gg-curve-edge")
    .data(layout.edges)
    .enter()
    .append("path")
    .attr("class", "gg-curve-edge")
    .attr("fill", "none")
    .attr("stroke", (d) => laneColor(d.colorIndex))
    .attr("stroke-width", 2.4)
    .attr("stroke-linecap", "round")
    .attr("data-from", (d) => d.fromHash)
    .attr("data-to", (d) => d.toHash)
    .attr("d", (d) => {
      const x1 = laneX(d.fromLane);
      const x2 = laneX(d.toLane);
      const y1 = d.fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const y2 = d.toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      return bump([
        [x1, y1],
        [x2, y2],
      ]);
    });

  const dotSelection = graphSvg
    .selectAll("g.gg-curve-node")
    .data(commits)
    .enter()
    .append("g")
    .attr("class", "gg-curve-node")
    .attr("data-hash", (d) => d.hash)
    .attr(
      "transform",
      (d, index) =>
        `translate(${laneX(rowsByHash.get(d.hash).lane)}, ${index * ROW_HEIGHT + ROW_HEIGHT / 2})`,
    );
  dotSelection
    .append("circle")
    .attr("r", 4.6)
    .attr("fill", (d) => laneColor(rowsByHash.get(d.hash).colorIndex))
    .attr("stroke", "var(--gg-bg)")
    .attr("stroke-width", (d) => (d.refs.some((r) => r.isHead) ? 2 : 0))
    .attr("class", "gg-dot");
  dotSelection
    .filter((d) => d.parents.length > 1)
    .append("circle")
    .attr("r", 7.6)
    .attr("fill", "none")
    .attr("stroke", (d) => laneColor(rowsByHash.get(d.hash).colorIndex))
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "2 2")
    .attr("class", "gg-curve-merge-ring");

  const list = body.append("div").attr("class", "gg-curve-list");
  const rowSelection = list
    .selectAll("div.gg-row")
    .data(commits)
    .enter()
    .append("div")
    .attr("class", "gg-row gg-row-tall")
    .attr("style", (d, index) => `height:${ROW_HEIGHT}px`)
    .attr("data-hash", (d) => d.hash);

  const description = rowSelection.append("div").attr("class", "gg-row-desc");
  description
    .selectAll("span.gg-ref")
    .data((d) => d.refs)
    .enter()
    .append("span")
    .attr(
      "class",
      (d) => `gg-ref gg-ref-${d.kind}${d.isHead ? " gg-ref-head" : ""}`,
    )
    .text((d) => refLabel(d));
  description
    .append("span")
    .attr("class", "gg-subject")
    .text((d) => d.subject);
  description
    .append("span")
    .attr("class", "gg-author")
    .text((d) => d.author);
  rowSelection
    .append("div")
    .attr("class", "gg-row-date")
    .text((d) => relativeTime(d.date));

  const highlight = (hash) => {
    const chain = ancestorsOf(commits, hash);
    rowSelection.classed("gg-dim", (d) => !chain.has(d.hash));
    rowSelection.classed("gg-active", (d) => chain.has(d.hash));
    dotSelection.classed("gg-dim", (d) => !chain.has(d.hash));
    edgeSelection.classed(
      "gg-dim",
      (d) => !(chain.has(d.fromHash) && chain.has(d.toHash)),
    );
  };
  const clearHighlight = () => {
    rowSelection.classed("gg-dim", false).classed("gg-active", false);
    dotSelection.classed("gg-dim", false);
    edgeSelection.classed("gg-dim", false);
  };
  rowSelection
    .on("mouseenter", (event) => {
      highlight(event.currentTarget.getAttribute("data-hash"));
    })
    .on("mouseleave", clearHighlight);
  dotSelection
    .on("mouseenter", (event) => {
      highlight(event.currentTarget.getAttribute("data-hash"));
    })
    .on("mouseleave", clearHighlight);

  void header;
  return { destroy: () => container.remove() };
}
