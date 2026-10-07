import type { WorkspaceFile } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildThreadStorageTree,
  flattenThreadStorageNode,
  threadStorageAncestorPaths,
  type ThreadStorageTreeNode,
} from "./thread-storage-tree";

function files(...paths: string[]): WorkspaceFile[] {
  return paths.map((path) => ({ path, name: path.split("/").at(-1) ?? path }));
}

function visiblePaths(
  tree: readonly ThreadStorageTreeNode[],
  expanded: readonly string[],
): string[] {
  return tree.flatMap((node) =>
    flattenThreadStorageNode(node, (path) => expanded.includes(path)).map(
      ({ node: row, depth }) => `${"  ".repeat(depth)}${row.name}`,
    ),
  );
}

describe("buildThreadStorageTree", () => {
  it("lists folders before files and sorts names naturally", () => {
    const tree = buildThreadStorageTree(
      files("b.md", "notes/10.md", "a.md", "notes/2.md", "Archive/x.md"),
    );
    expect(visiblePaths(tree, ["notes"])).toEqual([
      "Archive",
      "notes",
      "  2.md",
      "  10.md",
      "a.md",
      "b.md",
    ]);
  });

  it("joins folders that only contain one folder", () => {
    const tree = buildThreadStorageTree(
      files("qa/shots/after/a.png", "qa/shots/after/b.png", "qa/shots/c.png"),
    );
    expect(tree).toMatchObject([
      { kind: "folder", name: "qa/shots", path: "qa/shots" },
    ]);
    expect(visiblePaths(tree, ["qa/shots", "qa/shots/after"])).toEqual([
      "qa/shots",
      "  after",
      "    a.png",
      "    b.png",
      "  c.png",
    ]);
  });

  it("hides the children of collapsed folders", () => {
    const tree = buildThreadStorageTree(files("notes/a.md", "notes/b.md"));
    expect(visiblePaths(tree, [])).toEqual(["notes"]);
  });
});

describe("threadStorageAncestorPaths", () => {
  it("lists every folder above a file, outermost first", () => {
    expect(threadStorageAncestorPaths("qa/shots/after/a.png")).toEqual([
      "qa",
      "qa/shots",
      "qa/shots/after",
    ]);
    expect(threadStorageAncestorPaths("handoff.md")).toEqual([]);
  });
});
