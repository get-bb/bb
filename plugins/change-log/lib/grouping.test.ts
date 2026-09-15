import { describe, expect, it } from "vitest";
import type { ChangeEntry, ChangeTurn } from "../shared/contract.js";
import {
  filterEntries,
  finalPathOf,
  groupByFile,
  groupByTurn,
  groupEntries,
  isAbsoluteWorkspacePath,
} from "./grouping.js";

function entry(
  overrides: Partial<ChangeEntry> & { rowId: string },
): ChangeEntry {
  return {
    threadId: "thr_1",
    turnId: "turn-1",
    seqStart: 1,
    seqEnd: 2,
    createdAt: 1_000,
    path: "src/a.ts",
    movePath: null,
    action: "edited",
    status: "completed",
    approvalStatus: null,
    added: 1,
    removed: 1,
    edits: 1,
    patch: null,
    patchTruncated: false,
    nestedThreadId: null,
    ...overrides,
  };
}

function turn(overrides: Partial<ChangeTurn> & { turnId: string }): ChangeTurn {
  return {
    startedAt: 1_000,
    completedAt: 2_000,
    durationMs: 1_000,
    status: "completed",
    promptExcerpt: null,
    ...overrides,
  };
}

describe("isAbsoluteWorkspacePath", () => {
  it("recognizes Windows drive, UNC, and POSIX absolute paths", () => {
    expect(isAbsoluteWorkspacePath("C:/repo/a.ts")).toBe(true);
    expect(isAbsoluteWorkspacePath("C:\\repo\\a.ts")).toBe(true);
    expect(isAbsoluteWorkspacePath("\\\\server\\share\\a.ts")).toBe(true);
    expect(isAbsoluteWorkspacePath("/etc/hosts")).toBe(true);
  });

  it("treats workspace-relative paths as relative", () => {
    expect(isAbsoluteWorkspacePath("src/a.ts")).toBe(false);
    expect(isAbsoluteWorkspacePath("change-log-demo.md")).toBe(false);
  });
});

describe("filterEntries", () => {
  const entries = [
    entry({ rowId: "a", path: "src/a.ts" }),
    entry({ rowId: "b", path: "src/b.ts", nestedThreadId: "thr_child" }),
  ];

  it("filters by path substring", () => {
    expect(
      filterEntries(entries, { includeChildren: true, pathQuery: "b.ts" }).map(
        (item) => item.rowId,
      ),
    ).toEqual(["b"]);
  });

  it("drops child-thread changes when children are excluded", () => {
    expect(
      filterEntries(entries, { includeChildren: false, pathQuery: "" }).map(
        (item) => item.rowId,
      ),
    ).toEqual(["a"]);
  });
});

describe("grouping", () => {
  const turns = [
    turn({ turnId: "turn-1", startedAt: 1_000 }),
    turn({ turnId: "turn-2", startedAt: 5_000 }),
  ];
  const entries = [
    entry({ rowId: "a", turnId: "turn-1", path: "src/a.ts", createdAt: 1_100 }),
    entry({ rowId: "b", turnId: "turn-1", path: "src/b.ts", createdAt: 1_200 }),
    entry({ rowId: "c", turnId: "turn-2", path: "src/a.ts", createdAt: 5_100 }),
  ];

  it("groups by turn in chronological order", () => {
    const groups = groupByTurn(entries, turns);
    expect(groups.map((group) => group.turn?.turnId)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(groups[0]?.entries.map((item) => item.rowId)).toEqual(["a", "b"]);
    expect(groups[0]).toMatchObject({ added: 2, removed: 2 });
  });

  it("returns turn groups newest first for display", () => {
    expect(
      groupEntries(entries, turns, "turn").map((group) => group.turn?.turnId),
    ).toEqual(["turn-2", "turn-1"]);
  });

  it("groups by final file path and sorts by the last change", () => {
    const groups = groupByFile(entries);
    expect(groups.map((group) => group.key)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(groups[0]?.entries.map((item) => item.rowId)).toEqual(["a", "c"]);
    expect(finalPathOf(entries[0] as ChangeEntry)).toBe("src/a.ts");
  });
});
