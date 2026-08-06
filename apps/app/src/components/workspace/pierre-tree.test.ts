import { describe, expect, it, vi } from "vitest";
import {
  createProgressiveTreeAdapter,
  type ProgressiveTreeModel,
  type ProgressiveTreeRow,
} from "./pierre-tree";

function createModel() {
  let listener: (() => void) | undefined;
  let rows: ProgressiveTreeRow[] = [];
  const model: ProgressiveTreeModel = {
    batch: vi.fn(),
    getVisibleCount: () => rows.length,
    getVisibleRows: () => rows,
    subscribe: (nextListener) => {
      listener = nextListener;
      return vi.fn();
    },
  };

  return {
    model,
    publish(nextRows: ProgressiveTreeRow[]) {
      rows = nextRows;
      listener?.();
    },
  };
}

describe("createProgressiveTreeAdapter", () => {
  it("appends only new paths through one batch without resetting the tree", () => {
    const { model } = createModel();
    const adapter = createProgressiveTreeAdapter(model, vi.fn());

    adapter.appendPaths(["src/", "src/index.ts"]);
    adapter.appendPaths(["src/index.ts", "src/new.ts"]);

    expect(model.batch).toHaveBeenNthCalledWith(1, [
      { path: "src/", type: "add" },
      { path: "src/index.ts", type: "add" },
    ]);
    expect(model.batch).toHaveBeenNthCalledWith(2, [
      { path: "src/new.ts", type: "add" },
    ]);
    expect(model).not.toHaveProperty("resetPaths");
  });

  it("requests a newly expanded unresolved directory once", () => {
    const { model, publish } = createModel();
    const requestChildren = vi.fn();
    const adapter = createProgressiveTreeAdapter(model, requestChildren);

    adapter.appendPaths(["src/"]);
    publish([
      {
        isExpanded: false,
        kind: "directory",
        path: "src/",
      },
    ]);
    publish([
      {
        isExpanded: true,
        kind: "directory",
        path: "src/",
      },
    ]);
    publish([
      {
        isExpanded: true,
        kind: "directory",
        path: "src/",
      },
    ]);

    expect(requestChildren).toHaveBeenCalledOnce();
    expect(requestChildren).toHaveBeenCalledWith("src/");
  });
});
