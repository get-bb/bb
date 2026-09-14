import { computeLanes, laneColor, refLabel, relativeTime } from "./shared.js";

export const title = "Compact Git Graph lanes";
export const blurb =
  "The production layout: fixed 28px rows, one lane column, straight segments with S-curves at forks and merges. Dense and scannable.";

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 13;
export const LEFT_PAD = 8;

export function laneX(lane) {
  return LEFT_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

export function compute(commits) {
  const layout = computeLanes(commits);
  return {
    ...layout,
    rowHeight: ROW_HEIGHT,
    graphWidth: LEFT_PAD + (layout.maxLane + 1) * LANE_WIDTH + 8,
  };
}

function drawLane(svg, row, layout, d3) {
  const cy = ROW_HEIGHT / 2;
  const dotX = laneX(row.lane);
  const edge = (stroke) =>
    svg
      .append("path")
      .attr("fill", "none")
      .attr("stroke", stroke)
      .attr("stroke-width", 2)
      .attr("class", "gg-edge");

  for (const segment of row.passThrough) {
    const x = laneX(segment.lane);
    edge(laneColor(segment.colorIndex)).attr(
      "d",
      `M ${x} 0 L ${x} ${ROW_HEIGHT}`,
    );
  }
  for (const segment of row.intoDot) {
    const fromX = laneX(segment.fromLane);
    const stroke = laneColor(segment.colorIndex);
    if (fromX === dotX) {
      edge(stroke).attr("d", `M ${fromX} 0 L ${dotX} ${cy}`);
    } else {
      edge(stroke).attr(
        "d",
        `M ${fromX} 0 C ${fromX} ${cy}, ${dotX} 0, ${dotX} ${cy}`,
      );
    }
  }
  for (const segment of row.outOfDot) {
    const toX = laneX(segment.toLane);
    const stroke = laneColor(segment.colorIndex);
    if (toX === dotX) {
      edge(stroke).attr("d", `M ${dotX} ${cy} L ${toX} ${ROW_HEIGHT}`);
    } else {
      edge(stroke).attr(
        "d",
        `M ${dotX} ${cy} C ${dotX} ${ROW_HEIGHT}, ${toX} ${cy}, ${toX} ${ROW_HEIGHT}`,
      );
    }
  }
  void layout;
  svg
    .append("circle")
    .attr("cx", dotX)
    .attr("cy", cy)
    .attr("r", 4)
    .attr("fill", laneColor(row.colorIndex))
    .attr("stroke", "var(--gg-bg)")
    .attr("stroke-width", (d) => (d.refs.some((r) => r.isHead) ? 2 : 0))
    .attr("class", "gg-dot");
}

export function render({ stage, commits, d3 }) {
  const layout = compute(commits);
  const rowsByHash = new Map(layout.rows.map((row) => [row.hash, row]));

  const container = d3.select(stage).append("div").attr("class", "gg-list");

  container
    .append("div")
    .attr("class", "gg-list-header")
    .selectAll("div")
    .data([
      { label: "Graph", width: layout.graphWidth },
      { label: "Description", width: null },
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

  const rowSelection = container
    .selectAll("div.gg-row")
    .data(commits)
    .enter()
    .append("div")
    .attr("class", "gg-row")
    .attr("data-hash", (d) => d.hash);

  rowSelection
    .append("div")
    .attr("class", "gg-row-graph")
    .append("svg")
    .attr("width", layout.graphWidth)
    .attr("height", ROW_HEIGHT)
    .attr("viewBox", `0 0 ${layout.graphWidth} ${ROW_HEIGHT}`)
    .each(function draw(commit) {
      drawLane(d3.select(this), rowsByHash.get(commit.hash), layout, d3);
    });

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

  return { destroy: () => container.remove() };
}
