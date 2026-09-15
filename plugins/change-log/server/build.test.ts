import { describe, expect, it } from "vitest";
import { buildChangeLog } from "./build.js";
import { collectTimelineChanges } from "./collect.js";
import type {
  PromptHistoryEntry,
  ThreadTimelineResult,
  TimelineRow,
} from "./timeline-types.js";

const ROOT_THREAD = "thr_root";
const CHILD_THREAD = "thr_child";

interface FileChangeArgs {
  added?: number;
  approvalStatus?: "waiting_for_approval" | "denied" | null;
  createdAt: number;
  diff?: string | null;
  id: string;
  kind?: string | null;
  movePath?: string | null;
  path: string;
  removed?: number;
  seq: number;
  status?: "pending" | "completed" | "error" | "interrupted";
  threadId?: string;
  turnId?: string | null;
}

function fileChangeRow(args: FileChangeArgs): TimelineRow {
  return {
    kind: "work",
    workKind: "file-change",
    id: args.id,
    threadId: args.threadId ?? ROOT_THREAD,
    turnId: args.turnId ?? "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq + 1,
    startedAt: args.createdAt,
    createdAt: args.createdAt,
    status: args.status ?? "completed",
    callId: `call_${args.id}`,
    change: {
      path: args.path,
      kind: args.kind ?? "update",
      movePath: args.movePath ?? null,
      diff: args.diff === undefined ? "@@ -1 +1 @@\n-a\n+b\n" : args.diff,
      diffStats: { added: args.added ?? 1, removed: args.removed ?? 1 },
    },
    stdout: null,
    stderr: null,
    approvalStatus: args.approvalStatus ?? null,
  } as TimelineRow;
}

function delegationRow(args: {
  childRows: TimelineRow[];
  id: string;
  seq: number;
}): TimelineRow {
  return {
    kind: "work",
    workKind: "delegation",
    id: args.id,
    threadId: ROOT_THREAD,
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq + 1,
    startedAt: 0,
    createdAt: 0,
    status: "completed",
    callId: `call_${args.id}`,
    toolName: "task",
    childRef: null,
    background: false,
    subagentType: null,
    description: null,
    output: "",
    completedAt: null,
    childRows: args.childRows,
  } as TimelineRow;
}

function turnRow(args: {
  children?: TimelineRow[];
  completedAt: number | null;
  startedAt: number;
  status?: "pending" | "completed" | "error" | "interrupted";
  turnId: string;
}): TimelineRow {
  return {
    kind: "turn",
    id: `row_${args.turnId}`,
    threadId: ROOT_THREAD,
    turnId: args.turnId,
    sourceSeqStart: 1,
    sourceSeqEnd: 2,
    startedAt: args.startedAt,
    createdAt: args.startedAt,
    status: args.status ?? "completed",
    summaryCount: args.children?.length ?? 0,
    completedAt: args.completedAt,
    children: args.children ?? null,
  } as TimelineRow;
}

function makeTimeline(args: {
  hasOlderRows?: boolean;
  olderCursor?: { anchorId: string; anchorSeq: number } | null;
  rows: TimelineRow[];
}): ThreadTimelineResult {
  return {
    rows: args.rows,
    contextBoundarySeq: null,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 50,
      returnedSegmentCount: args.rows.length,
      hasOlderRows: args.hasOlderRows ?? false,
      olderCursor: args.olderCursor ?? null,
    },
    maxSeq: 1_000,
  } as unknown as ThreadTimelineResult;
}

function promptEntry(createdAt: number, text: string): PromptHistoryEntry {
  return {
    id: `prompt_${createdAt}`,
    createdAt,
    input: [{ type: "text", text, mentions: [] }],
  } as unknown as PromptHistoryEntry;
}

function build(args: {
  prompts?: PromptHistoryEntry[];
  rows: TimelineRow[];
  hasOlderRows?: boolean;
  olderCursor?: { anchorId: string; anchorSeq: number } | null;
  title?: string;
}) {
  return buildChangeLog({
    thread: {
      id: ROOT_THREAD,
      title: args.title ?? "Fix the flaky test",
      environmentId: "env_1",
    },
    timeline: makeTimeline({
      rows: args.rows,
      hasOlderRows: args.hasOlderRows,
      olderCursor: args.olderCursor,
    }),
    prompts: args.prompts ?? [],
  });
}

describe("collectTimelineChanges", () => {
  it("collects rows nested under turns in sequence order", () => {
    const first = fileChangeRow({
      id: "change_1",
      seq: 10,
      createdAt: 1_000,
      path: "a.ts",
    });
    const second = fileChangeRow({
      id: "change_2",
      seq: 30,
      createdAt: 2_000,
      path: "b.ts",
    });
    const collected = collectTimelineChanges(
      [
        turnRow({
          turnId: "turn-1",
          startedAt: 900,
          completedAt: 3_000,
          children: [second, first],
        }),
      ],
      ROOT_THREAD,
    );
    expect(collected.changes.map((entry) => entry.rowId)).toEqual([
      "change_1",
      "change_2",
    ]);
    expect(collected.turns).toEqual([
      {
        turnId: "turn-1",
        startedAt: 900,
        completedAt: 3_000,
        status: "completed",
      },
    ]);
  });

  it("walks delegation child rows and ignores non-change work rows", () => {
    const nested = fileChangeRow({
      id: "change_child",
      seq: 5,
      createdAt: 500,
      path: "child.ts",
      threadId: CHILD_THREAD,
    });
    const collected = collectTimelineChanges(
      [
        delegationRow({ id: "deleg_1", seq: 4, childRows: [nested] }),
        fileChangeRow({
          id: "change_root",
          seq: 6,
          createdAt: 600,
          path: "root.ts",
        }),
      ],
      ROOT_THREAD,
    );
    expect(collected.changes.map((entry) => entry.rowId)).toEqual([
      "change_child",
      "change_root",
    ]);
    expect(collected.changes[0]?.nestedThreadId).toBe(CHILD_THREAD);
    expect(collected.changes[1]?.nestedThreadId).toBeNull();
  });

  it("deduplicates a change row that appears twice", () => {
    const row = fileChangeRow({
      id: "change_1",
      seq: 10,
      createdAt: 1_000,
      path: "a.ts",
    });
    const collected = collectTimelineChanges([row, row], ROOT_THREAD);
    expect(collected.changes).toHaveLength(1);
  });
});

describe("buildChangeLog", () => {
  it("aggregates files and totals from the change entries", () => {
    const result = build({
      rows: [
        fileChangeRow({
          id: "change_1",
          seq: 10,
          createdAt: 1_000,
          path: "src/a.ts",
          added: 3,
          removed: 1,
        }),
        fileChangeRow({
          id: "change_2",
          seq: 20,
          createdAt: 2_000,
          path: "src/a.ts",
          added: 2,
          removed: 4,
        }),
        fileChangeRow({
          id: "change_3",
          seq: 30,
          createdAt: 3_000,
          path: "src/b.ts",
          kind: "add",
          added: 10,
          removed: 0,
        }),
      ],
    });
    expect(result.totals).toEqual({
      changes: 3,
      files: 2,
      added: 15,
      removed: 5,
      edits: 3,
    });
    const a = result.files.find((file) => file.path === "src/a.ts");
    expect(a).toMatchObject({
      changes: 2,
      edits: 2,
      added: 5,
      removed: 5,
    });
    expect(result.files[0]?.path).toBe("src/b.ts");
  });

  it("uses the rename destination as the final file path", () => {
    const result = build({
      rows: [
        fileChangeRow({
          id: "change_1",
          seq: 10,
          createdAt: 1_000,
          path: "src/old.ts",
          movePath: "src/new.ts",
          diff: "@@ -1 +1 @@\n",
        }),
      ],
    });
    expect(result.files.map((file) => file.path)).toEqual(["src/new.ts"]);
    expect(result.entries[0]?.action).toBe("renamed");
  });

  it("builds turn durations and matches prompt excerpts by time", () => {
    const result = build({
      rows: [
        turnRow({
          turnId: "turn-1",
          startedAt: 1_000,
          completedAt: 4_000,
          children: [
            fileChangeRow({
              id: "change_1",
              seq: 10,
              createdAt: 1_500,
              path: "a.ts",
            }),
          ],
        }),
        turnRow({
          turnId: "turn-2",
          startedAt: 10_000,
          completedAt: null,
          status: "pending",
          children: [
            fileChangeRow({
              id: "change_2",
              seq: 20,
              createdAt: 10_500,
              path: "b.ts",
            }),
          ],
        }),
      ],
      prompts: [
        promptEntry(900, "Make the test deterministic"),
        promptEntry(9_500, "Now update the docs"),
      ],
    });
    expect(result.turns).toEqual([
      {
        turnId: "turn-1",
        startedAt: 1_000,
        completedAt: 4_000,
        durationMs: 3_000,
        status: "completed",
        promptExcerpt: "Make the test deterministic",
      },
      {
        turnId: "turn-2",
        startedAt: 10_000,
        completedAt: null,
        durationMs: null,
        status: "pending",
        promptExcerpt: "Now update the docs",
      },
    ]);
  });

  it("drops agent-only prompt inputs from the excerpt", () => {
    const result = build({
      rows: [
        turnRow({
          turnId: "turn-1",
          startedAt: 1_000,
          completedAt: 2_000,
          children: [
            fileChangeRow({
              id: "change_1",
              seq: 10,
              createdAt: 1_500,
              path: "a.ts",
            }),
          ],
        }),
      ],
      prompts: [
        {
          id: "prompt_1",
          createdAt: 900,
          input: [
            {
              type: "text",
              text: "system note",
              mentions: [],
              visibility: "agent-only",
            },
            { type: "text", text: "visible prompt", mentions: [] },
          ],
        } as unknown as PromptHistoryEntry,
      ],
    });
    expect(result.turns[0]?.promptExcerpt).toBe("visible prompt");
  });

  it("omits a patch that exceeds the character limit", () => {
    const result = build({
      rows: [
        fileChangeRow({
          id: "change_1",
          seq: 10,
          createdAt: 1_000,
          path: "big.ts",
          diff: `@@ -1 +1 @@\n${"+x".repeat(150_000)}\n`,
        }),
      ],
    });
    expect(result.entries[0]?.patch).toBeNull();
    expect(result.entries[0]?.patchTruncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("passes the older-page cursor through", () => {
    const result = build({
      rows: [],
      hasOlderRows: true,
      olderCursor: { anchorSeq: 42, anchorId: "row_42" },
    });
    expect(result.page).toEqual({
      hasOlder: true,
      olderCursor: { anchorSeq: 42, anchorId: "row_42" },
    });
  });

  it("keeps the newest entries when a page exceeds the entry cap", () => {
    const rows = Array.from({ length: 505 }, (_, index) =>
      fileChangeRow({
        id: `change_${index}`,
        seq: index,
        createdAt: index,
        path: `file_${index}.ts`,
      }),
    );
    const result = build({ rows });
    expect(result.entries).toHaveLength(500);
    expect(result.entries[0]?.rowId).toBe("change_5");
    expect(result.entries.at(-1)?.rowId).toBe("change_504");
    expect(result.truncated).toBe(true);
  });

  it("returns an empty result for a thread with no file changes", () => {
    const result = build({ rows: [] });
    expect(result.entries).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.totals).toEqual({
      changes: 0,
      files: 0,
      added: 0,
      removed: 0,
      edits: 0,
    });
    expect(result.truncated).toBe(false);
  });

  it("merges same-path edits inside one turn and keeps them separate across turns", () => {
    const result = build({
      rows: [
        turnRow({
          turnId: "turn-1",
          startedAt: 1_000,
          completedAt: 5_000,
          children: [
            fileChangeRow({
              id: "change_1",
              seq: 10,
              createdAt: 1_100,
              path: "src/a.ts",
              added: 5,
              removed: 0,
              diff: "--- /dev/null\n+++ b/a.ts\n+line\n",
            }),
            fileChangeRow({
              id: "change_2",
              seq: 20,
              createdAt: 2_100,
              path: "src/a.ts",
              added: 0,
              removed: 0,
              diff: null,
            }),
          ],
        }),
        turnRow({
          turnId: "turn-2",
          startedAt: 10_000,
          completedAt: 12_000,
          children: [
            fileChangeRow({
              id: "change_3",
              seq: 30,
              createdAt: 10_100,
              path: "src/a.ts",
              turnId: "turn-2",
              added: 0,
              removed: 0,
              diff: null,
            }),
          ],
        }),
      ],
    });
    expect(result.entries).toHaveLength(2);
    const first = result.entries.find((entry) => entry.turnId === "turn-1");
    expect(first).toMatchObject({
      rowId: "change_1",
      added: 5,
      removed: 0,
      edits: 2,
      createdAt: 2_100,
      patch: "--- /dev/null\n+++ b/a.ts\n+line\n",
    });
    const second = result.entries.find((entry) => entry.turnId === "turn-2");
    expect(second).toMatchObject({
      rowId: "change_3",
      edits: 1,
      patch: null,
    });
  });
});
