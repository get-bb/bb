import type { DiffFileEntry } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  chunkPaths,
  clearError,
  clearLoading,
  collectViewportPatchPaths,
  dedupeOrderedPaths,
  EMPTY_IN_FLIGHT,
  markLoading,
  MISSING_PATCH_MESSAGE,
  resolveDiffFileBodyState,
  resolvePatchState,
  selectPathsToFetch,
  settlePage,
} from "./diff-patch-state";

function entry(
  path: string,
  loadMode: DiffFileEntry["loadMode"] = "auto",
): DiffFileEntry {
  return {
    path,
    previousPath: null,
    changeKind: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    origin: "tracked",
    loadMode,
  };
}

describe("viewport → fetch pages", () => {
  it("orders visible before overscan and drops duplicates", () => {
    expect(
      dedupeOrderedPaths({
        visible: ["b", "c"],
        overscan: ["a", "b", "d"],
      }),
    ).toEqual(["b", "c", "a", "d"]);
  });

  it("chunks into pages of at most 50 paths", () => {
    const paths = Array.from({ length: 120 }, (_, index) => `f${index}`);
    const pages = chunkPaths(paths);
    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages[0]?.[0]).toBe("f0");
    expect(pages[2]?.[19]).toBe("f119");
  });

  it("skips cached, loading (current generation) and errored paths", () => {
    const inFlight = {
      loading: new Map([
        ["loading-current", 3],
        ["loading-stale", 2],
      ]),
      errors: new Map([["errored", "boom"]]),
    };
    expect(
      selectPathsToFetch({
        requested: {
          visible: ["cached", "loading-current", "loading-stale"],
          overscan: ["errored", "fresh"],
        },
        inFlight,
        currentEvictionGeneration: 3,
        isCached: (path) => path === "cached",
      }),
    ).toEqual(["loading-stale", "fresh"]);
  });

  it("requests only auto-tier paths, visible before overscan", () => {
    const files = [
      entry("a"),
      entry("b", "on_demand"),
      entry("c"),
      entry("d", "too_large"),
      entry("e"),
      entry("f"),
    ];
    expect(
      collectViewportPatchPaths(
        files,
        { start: 2, end: 3 },
        { start: 0, end: 5 },
      ),
    ).toEqual({ visible: ["c"], overscan: ["a", "e", "f"] });
    expect(collectViewportPatchPaths(files, null, null)).toEqual({
      visible: [],
      overscan: [],
    });
  });
});

describe("in-flight bookkeeping", () => {
  it("marks loading under a generation and clears a previous error", () => {
    const state = markLoading(
      { loading: new Map(), errors: new Map([["a", "old"]]) },
      ["a", "b"],
      7,
    );
    expect(state.loading.get("a")).toBe(7);
    expect(state.loading.get("b")).toBe(7);
    expect(state.errors.has("a")).toBe(false);
  });

  it("settles an available page: returned paths load, omitted ones error terminally", () => {
    const loading = markLoading(EMPTY_IN_FLIGHT, ["a", "b"], 1);
    const settled = settlePage({
      previous: loading,
      paths: ["a", "b"],
      loadingGeneration: 1,
      returnedPaths: new Set(["a"]),
    });
    expect(settled.loading.size).toBe(0);
    expect(settled.errors.get("b")).toBe(MISSING_PATCH_MESSAGE);
    expect(settled.errors.has("a")).toBe(false);
  });

  it("settles a failed page onto every path of the page", () => {
    const settled = settlePage({
      previous: markLoading(EMPTY_IN_FLIGHT, ["a", "b"], 1),
      paths: ["a", "b"],
      loadingGeneration: 1,
      error: "daemon offline",
    });
    expect(settled.errors.get("a")).toBe("daemon offline");
    expect(settled.errors.get("b")).toBe("daemon offline");
  });

  it("only releases the generation a page started under", () => {
    // Page started at generation 1; an eviction bumped to 2 and a fresh
    // request re-marked `a` under 2 before the stale page settled.
    const stale = markLoading(EMPTY_IN_FLIGHT, ["a"], 1);
    const remarked = markLoading(stale, ["a"], 2);
    const settled = settlePage({
      previous: remarked,
      paths: ["a"],
      loadingGeneration: 1,
      returnedPaths: new Set(["a"]),
    });
    expect(settled.loading.get("a")).toBe(2);
    const cleared = clearLoading(remarked, ["a"], 1);
    expect(cleared).toBe(remarked);
    expect(clearLoading(remarked, ["a"], 2).loading.has("a")).toBe(false);
  });

  it("clearError is identity when nothing to clear", () => {
    expect(clearError(EMPTY_IN_FLIGHT, "x")).toBe(EMPTY_IN_FLIGHT);
    const withError = { loading: new Map(), errors: new Map([["x", "e"]]) };
    expect(clearError(withError, "x").errors.has("x")).toBe(false);
  });
});

describe("patch + body state", () => {
  it("prefers cached over error over loading", () => {
    const inFlight = {
      loading: new Map([["a", 1]]),
      errors: new Map([["a", "err"]]),
    };
    expect(
      resolvePatchState({
        cached: { patch: "p", truncated: false },
        inFlight,
        path: "a",
      }),
    ).toEqual({ status: "loaded", patch: "p", truncated: false });
    expect(
      resolvePatchState({ cached: undefined, inFlight, path: "a" }),
    ).toEqual({ status: "error", error: "err" });
    expect(
      resolvePatchState({
        cached: undefined,
        inFlight: { loading: new Map([["a", 1]]), errors: new Map() },
        path: "a",
      }),
    ).toEqual({ status: "loading" });
    expect(
      resolvePatchState({
        cached: undefined,
        inFlight: EMPTY_IN_FLIGHT,
        path: "a",
      }),
    ).toEqual({ status: "idle" });
  });

  it("tiers the card body", () => {
    expect(
      resolveDiffFileBodyState({ loadMode: "too_large" }, { status: "idle" }),
    ).toEqual({ kind: "too-large" });
    expect(
      resolveDiffFileBodyState({ loadMode: "on_demand" }, { status: "idle" }),
    ).toEqual({ kind: "load-on-demand" });
    expect(
      resolveDiffFileBodyState(
        { loadMode: "on_demand" },
        { status: "loading" },
      ),
    ).toEqual({ kind: "loading" });
    expect(
      resolveDiffFileBodyState({ loadMode: "auto" }, { status: "idle" }),
    ).toEqual({ kind: "loading" });
    expect(
      resolveDiffFileBodyState(
        { loadMode: "too_large" },
        { status: "error", error: "x" },
      ),
    ).toEqual({ kind: "error", message: "x" });
    expect(
      resolveDiffFileBodyState(
        { loadMode: "auto" },
        { status: "loaded", patch: "diff", truncated: true },
      ),
    ).toEqual({ kind: "loaded", patch: "diff", truncated: true });
  });
});
