import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import type {
  ThreadTimelineResult,
  TimelineRow,
} from "./server/timeline-types.js";

const ROOT_THREAD = "thr_root";
const ENV_ID = "env_1";

function fileChangeRow(args: {
  added: number;
  createdAt: number;
  id: string;
  path: string;
  removed: number;
  seq: number;
}): TimelineRow {
  return {
    kind: "work",
    workKind: "file-change",
    id: args.id,
    threadId: ROOT_THREAD,
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq + 1,
    startedAt: args.createdAt,
    createdAt: args.createdAt,
    status: "completed",
    callId: `call_${args.id}`,
    change: {
      path: args.path,
      kind: "update",
      movePath: null,
      diff: "@@ -1 +1 @@\n-a\n+b\n",
      diffStats: { added: args.added, removed: args.removed },
    },
    stdout: null,
    stderr: null,
    approvalStatus: null,
  } as TimelineRow;
}

function makeTimeline(
  rows: TimelineRow[],
  hasOlderRows = false,
): ThreadTimelineResult {
  return {
    rows,
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
      returnedSegmentCount: rows.length,
      hasOlderRows,
      olderCursor: hasOlderRows ? { anchorSeq: 7, anchorId: "row_7" } : null,
    },
    maxSeq: 100,
  } as unknown as ThreadTimelineResult;
}

function setup(rows: TimelineRow[], hasOlderRows = false) {
  const timeline = vi.fn(async () => makeTimeline(rows, hasOlderRows));
  const get = vi.fn(async () =>
    makeThreadResponse({
      id: ROOT_THREAD,
      title: "Fix the flaky test",
      environmentId: ENV_ID,
    }),
  );
  const promptHistory = vi.fn(async () => []);
  const { bb, harness } = createFakePluginHost({
    pluginId: "change-log",
    sdk: { threads: { get, timeline, promptHistory } },
  });
  const ready = plugin(bb);
  return { ready, harness, timeline, promptHistory };
}

const rows = [
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
    path: "src/b.ts",
    added: 4,
    removed: 2,
  }),
];

describe("change-log rpc", () => {
  it("lists the thread's file changes", async () => {
    const { ready, harness, timeline } = setup(rows);
    await ready;
    const result = (await harness.callRpc("listChanges", {
      threadId: ROOT_THREAD,
    })) as {
      entries: Array<{ rowId: string; path: string }>;
      totals: { changes: number };
      thread: { environmentId: string | null };
    };
    expect(result.entries.map((entry) => entry.rowId)).toEqual([
      "change_1",
      "change_2",
    ]);
    expect(result.totals.changes).toBe(2);
    expect(result.thread.environmentId).toBe(ENV_ID);
    expect(timeline).toHaveBeenCalledWith({
      threadId: ROOT_THREAD,
      includeNestedRows: "true",
    });
  });

  it("forwards the older-page cursor to the timeline", async () => {
    const { ready, harness, timeline } = setup(rows, true);
    await ready;
    await harness.callRpc("listChanges", {
      threadId: ROOT_THREAD,
      beforeAnchorSeq: 7,
      beforeAnchorId: "row_7",
    });
    expect(timeline).toHaveBeenCalledWith({
      threadId: ROOT_THREAD,
      includeNestedRows: "true",
      beforeAnchorSeq: "7",
      beforeAnchorId: "row_7",
    });
  });

  it("publishes a realtime signal when the thread advances", async () => {
    const { ready, harness, timeline } = setup(rows);
    await ready;
    timeline.mockClear();
    const outcome = await harness.emitThreadEvent(
      "experimental_thread.events",
      { thread: makeThreadResponse({ id: ROOT_THREAD }), sequence: 12 },
    );
    expect(outcome.errors).toEqual([]);
    expect(harness.inspection.realtimeSignals).toEqual([
      { channel: "change-log", payload: { threadId: ROOT_THREAD } },
    ]);
  });
});

describe("change-log cli", () => {
  it("prints a human-readable list", async () => {
    const { ready, harness } = setup(rows);
    await ready;
    const result = await harness.runCli(["list", ROOT_THREAD]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("src/a.ts");
    expect(result.stdout).toContain("src/b.ts");
    expect(result.stdout).toContain("+3 -1");
  });

  it("filters by path and caps the entry count", async () => {
    const { ready, harness } = setup(rows);
    await ready;
    const filtered = await harness.runCli([
      "list",
      ROOT_THREAD,
      "--path",
      "b.ts",
    ]);
    expect(filtered.stdout).toContain("src/b.ts");
    expect(filtered.stdout).not.toContain("src/a.ts");
    const limited = await harness.runCli(["list", ROOT_THREAD, "--limit", "1"]);
    expect(limited.stdout).toContain("src/b.ts");
    expect(limited.stdout).not.toContain("src/a.ts");
  });

  it("strips patches from JSON output unless asked", async () => {
    const { ready, harness } = setup(rows);
    await ready;
    const plain = await harness.runCli(["list", ROOT_THREAD, "--json"]);
    const parsed = JSON.parse(plain.stdout) as {
      entries: Array<{ patch: string | null }>;
    };
    expect(parsed.entries.every((entry) => entry.patch === null)).toBe(true);

    const withPatches = await harness.runCli([
      "list",
      ROOT_THREAD,
      "--json",
      "--json-patches",
    ]);
    const patched = JSON.parse(withPatches.stdout) as {
      entries: Array<{ patch: string | null }>;
    };
    expect(patched.entries[0]?.patch).toContain("@@");
  });

  it("reports an empty thread honestly", async () => {
    const { ready, harness } = setup([]);
    await ready;
    const result = await harness.runCli(["list", ROOT_THREAD]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("No file changes recorded for this thread.");
  });

  it("rejects an unknown subcommand", async () => {
    const { ready, harness } = setup(rows);
    await ready;
    const result = await harness.runCli(["nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand");
  });

  it("requires a thread id", async () => {
    const { ready, harness } = setup(rows);
    await ready;
    const result = await harness.runCli(["list"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("thread id is required");
  });
});
