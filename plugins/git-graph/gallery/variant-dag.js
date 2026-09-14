import {
  childrenMapOf,
  depthFromRoots,
  laneColor,
  refLabel,
  ancestorsOf,
  descendantsOf,
} from "./shared.js";

export const title = "Top-down DAG";
export const blurb =
  "The history as a directed acyclic graph: roots at the top, every parent link drawn, forks and merges labeled. Hover lights the commit's upstream and downstream.";

export const NODE_GAP_Y = 72;
export const NODE_GAP_X = 168;

export function compute(commits) {
  const depths = depthFromRoots(commits);
  const children = childrenMapOf(commits);
  const ranks = new Map();
  for (const commit of commits) {
    const depth = depths.get(commit.hash) ?? 0;
    ranks.set(depth, [...(ranks.get(depth) ?? []), commit.hash]);
  }
  const byDepth = [...ranks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, hashes]) => {
      const sorted = hashes.slice().sort((a, b) => {
        const aMerge = (children.get(a) ?? []).length;
        const bMerge = (children.get(b) ?? []).length;
        if (aMerge !== bMerge) return bMerge - aMerge;
        return a.localeCompare(b);
      });
      return { depth, hashes: sorted };
    });

  const nodes = [];
  const positionByHash = new Map();
  const maxDepth = byDepth.length - 1;
  const widthPerDepth = new Map(
    byDepth.map(({ depth, hashes }) => [depth, hashes.length]),
  );
  const maxPerDepth = Math.max(...widthPerDepth.values(), 1);
  byDepth.forEach(({ depth, hashes }) => {
    hashes.forEach((hash, indexInDepth) => {
      const commit = commits.find((c) => c.hash === hash);
      const lane = indexInDepth;
      const position = {
        hash,
        x: lane * NODE_GAP_X,
        y: depth * NODE_GAP_Y,
        lane,
      };
      positionByHash.set(hash, position);
      nodes.push({
        ...position,
        commit,
        isMerge: commit.parents.length > 1,
        isFork: (children.get(hash) ?? []).length > 1,
        isRoot: commit.parents.length === 0,
        colorIndex: depth % 10,
      });
    });
  });

  const edges = [];
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const from = positionByHash.get(parent);
      const to = positionByHash.get(commit.hash);
      if (from === undefined || to === undefined) continue;
      edges.push({
        id: `${parent}->${commit.hash}`,
        from,
        to,
        isMergeEdge: commit.parents.length > 1 && commit.parents[0] !== parent,
      });
    }
  }

  return {
    nodes,
    edges,
    maxDepth,
    maxPerDepth,
    width: (maxPerDepth - 1) * NODE_GAP_X + 200,
    height: maxDepth * NODE_GAP_Y + 120,
  };
}

export function render({ stage, commits, d3 }) {
  const layout = compute(commits);
  const container = d3.select(stage).append("div").attr("class", "gg-dag");
  const legend = container
    .append("div")
    .attr("class", "gg-dag-legend")
    .selectAll("span")
    .data([
      { text: "root", cls: "gg-dag-badge gg-dag-badge-root" },
      { text: "fork (split)", cls: "gg-dag-badge gg-dag-badge-fork" },
      { text: "merge", cls: "gg-dag-badge gg-dag-badge-merge" },
      { text: "second-parent edge", cls: "gg-dag-badge gg-dag-badge-side" },
    ])
    .enter()
    .append("span")
    .attr("class", (d) => d.cls)
    .text((d) => d.text);

  const scroller = container.append("div").attr("class", "gg-dag-scroll");
  const svg = scroller
    .append("svg")
    .attr("class", "gg-dag-svg")
    .attr("width", Math.max(layout.width, 640))
    .attr("height", layout.height)
    .attr("viewBox", `0 0 ${Math.max(layout.width, 640)} ${layout.height}`);

  const edgeSelection = svg
    .selectAll("path.gg-dag-edge")
    .data(layout.edges)
    .enter()
    .append("path")
    .attr(
      "class",
      (d) => `gg-dag-edge${d.isMergeEdge ? " gg-dag-edge-side" : ""}`,
    )
    .attr("fill", "none")
    .attr("stroke-width", 2)
    .attr("data-from", (d) => d.from.hash)
    .attr("data-to", (d) => d.to.hash)
    .attr("d", (d) => {
      const x1 = d.from.x + 70;
      const y1 = d.from.y + 18;
      const x2 = d.to.x + 70;
      const y2 = d.to.y - 6;
      const mid = (y1 + y2) / 2;
      return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
    });

  const node = svg
    .selectAll("g.gg-dag-node")
    .data(layout.nodes)
    .enter()
    .append("g")
    .attr("class", "gg-dag-node")
    .attr("data-hash", (d) => d.hash)
    .attr("transform", (d) => `translate(${d.x}, ${d.y})`);

  node
    .append("rect")
    .attr("class", "gg-dag-box")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 140)
    .attr("height", 24)
    .attr("rx", 6)
    .attr("stroke", (d) => laneColor(d.colorIndex));

  node
    .append("circle")
    .attr("class", "gg-dag-dot")
    .attr("cx", 0)
    .attr("cy", 12)
    .attr("r", 4)
    .attr("fill", (d) => laneColor(d.colorIndex));

  node
    .append("text")
    .attr("class", "gg-dag-subject")
    .attr("x", 12)
    .attr("y", 16)
    .text((d) => truncate(d.commit.subject, 22));

  node
    .append("text")
    .attr("class", "gg-dag-abbrev")
    .attr("x", 12)
    .attr("y", -4)
    .text((d) => d.commit.abbrev);

  node.each(function appendBadges(d) {
    const group = d3.select(this);
    let offset = 140;
    const badge = (text, cls) => {
      group
        .append("text")
        .attr("class", `gg-dag-badge-text ${cls}`)
        .attr("x", offset + 6)
        .attr("y", 16)
        .text(text);
      offset += 14 + text.length * 6;
    };
    if (d.isRoot) badge("root", "gg-dag-badge-root");
    if (d.isFork) badge("fork", "gg-dag-badge-fork");
    if (d.isMerge) badge("merge", "gg-dag-badge-merge");
  });

  const tooltip = container
    .append("div")
    .attr("class", "gg-dag-tooltip")
    .style("display", "none");

  const highlight = (hash) => {
    const upstream = ancestorsOf(commits, hash);
    const downstream = descendantsOf(commits, hash);
    const inFocus = (h) => upstream.has(h) || downstream.has(h);
    node.classed("gg-dim", (d) => !inFocus(d.hash));
    edgeSelection.classed(
      "gg-dim",
      (d) => !(inFocus(d.from.hash) && inFocus(d.to.hash)),
    );
  };
  const clear = () => {
    node.classed("gg-dim", false);
    edgeSelection.classed("gg-dim", false);
    tooltip.style("display", "none");
  };
  node
    .on("mouseenter", (event, d) => {
      highlight(d.hash);
      const refs = d.commit.refs.map((r) => refLabel(r)).join(", ");
      tooltip
        .style("display", "block")
        .style("left", `${event.offsetX + 16}px`)
        .style("top", `${event.offsetY + 12}px`)
        .html(
          `<strong>${d.commit.subject}</strong><br/>${d.commit.abbrev} · ${d.commit.author}<br/>${refs.length > 0 ? refs : "no refs"}`,
        );
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", `${event.offsetX + 16}px`)
        .style("top", `${event.offsetY + 12}px`);
    })
    .on("mouseleave", clear);

  return { destroy: () => container.remove() };
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
