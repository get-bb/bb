import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  computeGraphEdges,
  computeGraphLayout,
  restrictToLoadedParents,
  type GraphLayout,
  type LayoutCommit,
} from "./layout.js";

function c(hash: string, parents: readonly string[]): LayoutCommit {
  return { hash, parents };
}

function lanesOf(layout: GraphLayout): Record<string, number> {
  return Object.fromEntries(layout.rows.map((row) => [row.hash, row.lane]));
}

function edgeBetween(
  commits: readonly LayoutCommit[],
  from: string,
  to: string,
) {
  const { edges } = computeGraphEdges(commits, computeGraphLayout(commits));
  return edges.find((edge) => edge.fromHash === from && edge.toHash === to);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHistory(seed: number, size: number): LayoutCommit[] {
  const random = seededRandom(seed);
  const created: LayoutCommit[] = [];
  for (let index = 0; index < size; index += 1) {
    if (index === 0 || random() < 0.03) {
      created.push(c(`c${index}`, []));
      continue;
    }
    const pick = () =>
      `c${index - 1 - Math.floor(random() * Math.min(index, 12))}`;
    const first = pick();
    const parents = random() < 0.25 ? [...new Set([first, pick()])] : [first];
    created.push(c(`c${index}`, parents));
  }
  return created.reverse();
}

describe("computeGraphLayout", () => {
  it("keeps linear history on one lane", () => {
    const commits = [c("c3", ["c2"]), c("c2", ["c1"]), c("c1", [])];
    const layout = computeGraphLayout(commits);
    expect(layout.maxLane).toBe(0);
    expect(lanesOf(layout)).toEqual({ c3: 0, c2: 0, c1: 0 });
    const { edges, openEdges } = computeGraphEdges(commits, layout);
    expect(openEdges).toEqual([]);
    expect(
      edges.map((edge) => [edge.fromLane, edge.runLane, edge.toLane]),
    ).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("keeps the first-parent line on the left lane whichever side of a merge is listed first", () => {
    const featureFirst = [
      c("m", ["a2", "f2"]),
      c("f2", ["f1"]),
      c("f1", ["a1"]),
      c("a2", ["a1"]),
      c("a1", []),
    ];
    const mainFirst = [
      c("m", ["a2", "f2"]),
      c("a2", ["a1"]),
      c("f2", ["f1"]),
      c("f1", ["a1"]),
      c("a1", []),
    ];
    for (const commits of [featureFirst, mainFirst]) {
      const layout = computeGraphLayout(commits);
      expect(lanesOf(layout)).toEqual({ m: 0, a2: 0, a1: 0, f2: 1, f1: 1 });
      expect(layout.maxLane).toBe(1);
    }
    expect(edgeBetween(featureFirst, "f1", "a1")).toMatchObject({
      fromLane: 1,
      runLane: 1,
      toLane: 0,
    });
    expect(edgeBetween(mainFirst, "f1", "a1")).toMatchObject({
      fromLane: 1,
      runLane: 0,
      toLane: 0,
      departColorIndex: 1,
      colorIndex: 0,
    });
  });

  it("colors a merge's side run with the merged branch's lane", () => {
    const commits = [
      c("m", ["a2", "f1"]),
      c("f1", ["a1"]),
      c("a2", ["a1"]),
      c("a1", []),
    ];
    const layout = computeGraphLayout(commits);
    const side = edgeBetween(commits, "m", "f1");
    const featureRow = layout.rows.find((row) => row.hash === "f1");
    expect(side).toMatchObject({ fromLane: 0, runLane: 1, toLane: 1 });
    expect(side?.colorIndex).toBe(featureRow?.colorIndex);
    expect(side?.departColorIndex).toBe(featureRow?.colorIndex);
    expect(side?.colorIndex).not.toBe(layout.rows[0]?.colorIndex);
  });

  it("allocates a lane per parent for octopus merges", () => {
    const layout = computeGraphLayout([
      c("m", ["p1", "p2", "p3"]),
      c("p1", []),
      c("p2", []),
      c("p3", []),
    ]);
    expect(layout.rows[0]?.parentRuns.map((run) => run.lane)).toEqual([
      0, 1, 2,
    ]);
    expect(layout.maxLane).toBe(2);
  });

  it("starts a new lane for a commit no loaded child points at", () => {
    const commits = [c("x", ["unloaded"]), c("a", [])];
    const layout = computeGraphLayout(commits);
    expect(lanesOf(layout)).toEqual({ x: 0, a: 1 });
    expect(layout.maxLane).toBe(1);
    const { edges, openEdges } = computeGraphEdges(commits, layout);
    expect(edges).toEqual([]);
    expect(openEdges).toEqual([
      expect.objectContaining({
        fromHash: "x",
        toHash: "unloaded",
        runLane: 0,
      }),
    ]);
  });

  it("reuses freed lanes instead of growing the graph", () => {
    expect(
      computeGraphLayout([
        c("f", ["e"]),
        c("e", ["b", "d"]),
        c("b", ["a"]),
        c("d", ["a"]),
        c("a", []),
      ]).maxLane,
    ).toBe(1);
    const branchOffs = computeGraphLayout([
      c("b", ["p"]),
      c("t1", ["p"]),
      c("t2", ["p"]),
      c("t3", ["p"]),
      c("p", []),
    ]);
    expect(lanesOf(branchOffs)).toEqual({ b: 0, t1: 1, t2: 1, t3: 1, p: 0 });
    expect(branchOffs.maxLane).toBe(1);
  });

  it("keeps prefix rows stable when older pages load", () => {
    const full = [
      c("m", ["a2", "f2"]),
      c("f2", ["f1"]),
      c("f1", ["a1"]),
      c("a2", ["a1"]),
      c("a1", []),
    ];
    const fullLayout = computeGraphLayout(full);
    for (let size = 1; size < full.length; size += 1) {
      expect(computeGraphLayout(full.slice(0, size)).rows).toEqual(
        fullLayout.rows.slice(0, size),
      );
    }
  });

  it("cycles lane colors through the palette", () => {
    const commits: LayoutCommit[] = [];
    for (let index = 0; index < 14; index += 1) {
      commits.unshift(c(`c${index}`, []));
    }
    const layout = computeGraphLayout(commits);
    expect(new Set(layout.rows.map((row) => row.colorIndex)).size).toBe(10);
  });

  it("never routes a lane through another commit or shares a lane between two targets", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const history = randomHistory(seed, 140);
      for (const commits of [history, history.slice(0, 70)]) {
        const layout = computeGraphLayout(commits);
        const { edges, openEdges } = computeGraphEdges(commits, layout);
        const loaded = new Set(commits.map((commit) => commit.hash));
        const parentLinks = commits.flatMap((commit) => commit.parents);
        expect(edges.length).toBe(
          parentLinks.filter((parent) => loaded.has(parent)).length,
        );
        expect(openEdges.length).toBe(
          parentLinks.filter((parent) => !loaded.has(parent)).length,
        );
        for (const edge of edges) {
          expect(edge.toLane).toBe(layout.rows[edge.toIndex]?.lane);
          expect(edge.runLane).toBeGreaterThanOrEqual(edge.toLane);
        }
        const runs = [
          ...edges.map((edge) => ({ edge, endIndex: edge.toIndex })),
          ...openEdges.map((edge) => ({ edge, endIndex: commits.length })),
        ];
        const targetByLaneAndRow = new Map<string, string>();
        for (const { edge, endIndex } of runs) {
          expect(edge.fromIndex).toBeLessThan(endIndex);
          expect(edge.runLane).toBeLessThanOrEqual(layout.maxLane);
          for (let row = edge.fromIndex + 1; row < endIndex; row += 1) {
            expect(layout.rows[row]?.lane).not.toBe(edge.runLane);
            const key = `${edge.runLane}:${row}`;
            const previous = targetByLaneAndRow.get(key);
            expect(previous === undefined || previous === edge.toHash).toBe(
              true,
            );
            targetByLaneAndRow.set(key, edge.toHash);
          }
        }
      }
    }
  });
});

describe("restrictToLoadedParents", () => {
  it("keeps filtered results from reserving lanes for parents that never load", () => {
    const filtered = [c("x", ["gone1"]), c("y", ["w"]), c("w", ["gone2"])];
    expect(computeGraphLayout(filtered).maxLane).toBe(1);
    const restricted = restrictToLoadedParents(filtered);
    expect(restricted.map((commit) => commit.parents)).toEqual([[], ["w"], []]);
    const layout = computeGraphLayout(restricted);
    expect(layout.maxLane).toBe(0);
    expect(computeGraphEdges(restricted, layout).openEdges).toEqual([]);
  });
});

describe("ancestorsOf", () => {
  it("walks both merge sides transitively down to the root", () => {
    const commits = [
      c("m", ["b", "d"]),
      c("b", ["a"]),
      c("d", ["a"]),
      c("a", []),
    ];
    expect(ancestorsOf(commits, "m")).toEqual(new Set(["m", "b", "d", "a"]));
    expect(ancestorsOf(commits, "d")).toEqual(new Set(["d", "a"]));
  });

  it("ignores parents that are not loaded", () => {
    const commits = [c("top", ["ghost"]), c("ghost", ["root"])];
    expect(ancestorsOf(commits.slice(0, 1), "top")).toEqual(
      new Set(["top", "ghost"]),
    );
  });
});
