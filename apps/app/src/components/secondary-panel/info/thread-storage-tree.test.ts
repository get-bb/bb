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
  showingAll: readonly string[] = [],
): string[] {
  return tree.flatMap((node) =>
    flattenThreadStorageNode(node, {
      isExpanded: (path) => expanded.includes(path),
      showsAllChildren: (path) => showingAll.includes(path),
      childLimit: 2,
    }).map((row) =>
      row.kind === "more"
        ? `${"  ".repeat(row.depth)}${row.hiddenCount} more`
        : `${"  ".repeat(row.depth)}${row.node.name}`,
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
      {
        kind: "folder",
        name: "qa/shots",
        path: "qa/shots",
        chainPaths: ["qa", "qa/shots"],
      },
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

describe("flattenThreadStorageNode", () => {
  it("caps an open folder's children until it shows them all", () => {
    const tree = buildThreadStorageTree(
      files("logs/1.txt", "logs/2.txt", "logs/3.txt", "logs/4.txt"),
    );
    expect(visiblePaths(tree, ["logs"])).toEqual([
      "logs",
      "  1.txt",
      "  2.txt",
      "  2 more",
    ]);
    expect(visiblePaths(tree, ["logs"], ["logs"])).toEqual([
      "logs",
      "  1.txt",
      "  2.txt",
      "  3.txt",
      "  4.txt",
    ]);
  });

  it("shows every child when only one would be hidden", () => {
    const tree = buildThreadStorageTree(
      files("logs/1.txt", "logs/2.txt", "logs/3.txt"),
    );
    expect(visiblePaths(tree, ["logs"])).toEqual([
      "logs",
      "  1.txt",
      "  2.txt",
      "  3.txt",
    ]);
  });
});
