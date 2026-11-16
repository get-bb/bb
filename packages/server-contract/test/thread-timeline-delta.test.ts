import { describe, expect, it } from "vitest";
import {
  THREAD_TIMELINE_WINDOW_FIELD_KEYS,
  TIMELINE_PAGE_FIELD_KEYS,
  threadTimelineResponseSchema,
  timelinePageMetadataSchema,
  threadTimelineSignalLenientSchema,
  type ThreadTimelineResponse,
} from "../src/api-types.js";
import {
  applyThreadTimelineDelta,
  computeThreadTimelineDelta,
} from "../src/thread-timeline-delta.js";
import type { TimelineRow } from "../src/thread-timeline.js";

function row(id: string, title = "t"): TimelineRow {
  return {
    id,
    kind: "system",
    threadId: "thr_x",
    turnId: null,
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 0,
    createdAt: 0,
    systemKind: "debug",
    title,
    detail: null,
    status: null,
  };
}

function message(id: string, text: string, sourceSeqEnd = 1): TimelineRow {
  return {
    id,
    kind: "conversation",
    role: "assistant",
    threadId: "thr_x",
    turnId: "turn_x",
    sourceSeqStart: 1,
    sourceSeqEnd,
    startedAt: 0,
    createdAt: 0,
    messageSeq: 1,
    text,
    attachments: null,
    turnRequest: null,
  };
}

function timeline(
  rows: TimelineRow[],
  overrides: Partial<ThreadTimelineResponse> = {},
): ThreadTimelineResponse {
  return {
    rows,
    contextBoundarySeq: null,
    completedTurnDisplay: "flat",
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    extensionStates: {},
    providerCommands: null,
    sessionOptions: null,
    modelFallback: null,
    timelinePage: {
      returnedSegmentCount: 1,
      olderCursor: null,
      historySnapshot: "snapshot",
      olderRowsSourceSeqEnd: null,
    },
    maxSeq: 1,
    tag: "tag-1",
    ...overrides,
  };
}

function roundTrip(
  previous: ThreadTimelineResponse,
  current: ThreadTimelineResponse,
) {
  const delta = computeThreadTimelineDelta(previous, current);
  return { delta, applied: applyThreadTimelineDelta(previous, delta) };
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("thread timeline delta", () => {
  it("round-trips an upsert and an append, sending only the changed rows", () => {
    const previous = timeline([row("a"), row("b")]);
    const current = timeline([row("a"), row("b", "changed"), row("c")], {
      maxSeq: 3,
      tag: "tag-3",
    });
    const { delta, applied } = roundTrip(previous, current);
    expect(delta.delta.upsertRows.map((r) => r.id)).toEqual(["c"]);
    expect(delta.delta.patchRows).toEqual([
      { id: "b", ops: [["set", ["title"], "changed"]] },
    ]);
    expect(delta.delta.rowOrder).toEqual([[0, 2], "c"]);
    expect(delta.delta.fields).toEqual({});
    expect(applied).toEqual(current);
  });

  it("sends only the appended text of a row whose text grew", () => {
    const settled =
      "## Plan\n\n" + "A settled paragraph of streamed text.\n\n".repeat(400);
    const previous = timeline([row("a"), message("m", settled, 5)]);
    const current = timeline(
      [row("a"), message("m", `${settled}Next line.\n`, 6)],
      {
        maxSeq: 6,
        tag: "tag-6",
      },
    );
    const { delta, applied } = roundTrip(previous, current);
    expect(delta.delta.upsertRows).toEqual([]);
    expect(delta.delta.patchRows).toEqual([
      {
        id: "m",
        ops: [
          ["set", ["sourceSeqEnd"], 6],
          ["append", ["text"], "Next line.\n"],
        ],
      },
    ]);
    expect(JSON.stringify(delta)).not.toContain(settled.slice(0, 40));
    expect(applied).toEqual(current);
    expect(applied?.rows[0]).toBe(previous.rows[0]);
  });

  it("round-trips random growth, rewrites, added and removed keys and nested arrays", () => {
    const random = seededRandom(11);
    const words = ["alpha ", "beta\n", "", "gamma ", "\n\n"];
    const nested = (seed: number) => ({
      kind: "work" as const,
      id: "w",
      threadId: "thr_x",
      turnId: "turn_x",
      sourceSeqStart: 1,
      sourceSeqEnd: seed,
      startedAt: 0,
      createdAt: 0,
      workKind: "tool" as const,
      status: "running" as const,
      callId: "call",
      toolName: "tool",
      args: {
        list: Array.from({ length: seed % 4 }, (_, index) => ({
          index,
          label: `item ${index}`,
        })),
      },
      output: "",
    });
    let text = "";
    let work: Record<string, unknown> = nested(1);
    let previous = timeline([
      message("m", text),
      work as unknown as TimelineRow,
    ]);
    for (let step = 0; step < 300; step += 1) {
      const choice = random();
      if (choice < 0.6) {
        text += words[Math.floor(random() * words.length)];
      } else if (choice < 0.7) {
        text = text.slice(0, Math.floor(random() * text.length));
      }
      const next: Record<string, unknown> = {
        ...nested(step + 2),
        output: `${String(work.output)}${step % 3 === 0 ? "out\n" : ""}`,
      };
      if (random() < 0.3) {
        next.extra = { flag: random() < 0.5, depth: [step] };
      }
      work = next;
      const current = timeline(
        [message("m", text, step + 2), work as unknown as TimelineRow],
        { maxSeq: step + 2, tag: `tag-${step + 2}` },
      );
      expect(roundTrip(previous, current).applied).toEqual(current);
      previous = current;
    }
  });

  it("refuses patches that do not fit the held rows", () => {
    const previous = timeline([message("m", "hello")]);
    const apply = (
      patchRows: NonNullable<
        ReturnType<typeof computeThreadTimelineDelta>["delta"]["patchRows"]
      >,
    ) =>
      applyThreadTimelineDelta(previous, {
        maxSeq: 2,
        tag: "tag-2",
        delta: { afterTag: "tag-1", upsertRows: [], patchRows, fields: {} },
      });
    expect(
      apply([{ id: "m", ops: [["append", ["sourceSeqEnd"], "x"]] }]),
    ).toBeNull();
    expect(
      apply([{ id: "m", ops: [["append", ["missing"], "x"]] }]),
    ).toBeNull();
    expect(apply([{ id: "m", ops: [["delete", ["missing"]]] }])).toBeNull();
    expect(apply([{ id: "absent", ops: [["set", ["text"], "x"]] }])).toBeNull();
    expect(
      apply([{ id: "m", ops: [["append", ["text"], " world"]] }])?.rows,
    ).toEqual([message("m", "hello world")]);
  });

  it("keeps a patched __proto__ key as data", () => {
    const before = JSON.parse('{"__proto__":{"a":1}}');
    const after = JSON.parse('{"__proto__":{"a":2}}');
    const work = (args: unknown) =>
      ({ ...row("w"), args }) as unknown as TimelineRow;
    const previous = timeline([work(before)]);
    const current = timeline([work(after)], { tag: "tag-2" });
    const { applied } = roundTrip(previous, current);
    expect(JSON.stringify(applied?.rows[0])).toBe(
      JSON.stringify(current.rows[0]),
    );
    expect(
      Object.getPrototypeOf(
        (applied?.rows[0] as unknown as { args: object }).args,
      ),
    ).toBe(Object.prototype);
  });

  it("encodes removals, inserts and moves as ranges over the previous rows", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const previous = timeline(ids.map((id) => row(id)));
    const current = timeline(
      ["a", "x", "b", "c", "f", "e", "y"].map((id) => row(id)),
      { tag: "tag-2" },
    );
    const { delta, applied } = roundTrip(previous, current);
    expect(delta.delta.rowOrder).toEqual([
      [0, 1],
      "x",
      [1, 2],
      [5, 1],
      [4, 1],
      "y",
    ]);
    expect(applied).toEqual(current);
  });

  it("round-trips random inserts, removals, reorders and edits exactly", () => {
    const random = seededRandom(7);
    let previous = timeline(
      Array.from({ length: 40 }, (_, index) => row(`r${index}`)),
    );
    let nextId = 40;
    for (let step = 0; step < 300; step += 1) {
      const rows = [...previous.rows];
      const operations = 1 + Math.floor(random() * 4);
      for (let op = 0; op < operations; op += 1) {
        const choice = random();
        const index = Math.floor(random() * (rows.length + 1));
        if (choice < 0.3) {
          rows.splice(index, 0, row(`r${nextId++}`));
        } else if (choice < 0.5 && rows.length > 0) {
          rows.splice(Math.min(index, rows.length - 1), 1);
        } else if (choice < 0.7 && rows.length > 1) {
          const [moved] = rows.splice(Math.min(index, rows.length - 1), 1);
          rows.splice(Math.floor(random() * rows.length), 0, moved!);
        } else if (rows.length > 0) {
          const target = Math.min(index, rows.length - 1);
          rows[target] = row(rows[target]!.id, `edit-${step}`);
        }
      }
      const current = timeline(rows, {
        maxSeq: step + 2,
        tag: `tag-${step + 2}`,
        extensionStates: random() < 0.2 ? {} : previous.extensionStates,
      });
      expect(roundTrip(previous, current).applied).toEqual(current);
      previous = current;
    }
  });

  it("sends only top-level fields that changed and removes cleared usage", () => {
    const usage = {
      estimated: false,
      modelContextWindow: 100,
      usedTokens: 10,
    };
    const planMode = { mode: "plan" as const, providerId: "codex", prompt: "" };
    const previous = timeline([row("a")], { contextWindowUsage: usage });
    const changed = timeline([row("a")], {
      contextWindowUsage: usage,
      activePromptMode: planMode,
      tag: "tag-2",
    });
    const first = roundTrip(previous, changed);
    expect(first.delta.delta.fields).toEqual({ activePromptMode: planMode });
    expect(first.applied).toEqual(changed);

    const cleared = timeline([row("a")], { tag: "tag-3" });
    const second = roundTrip(changed, cleared);
    expect(second.delta.delta.fields).toEqual({
      activePromptMode: null,
      contextWindowUsage: null,
    });
    expect(second.applied).toEqual(cleared);
    expect(second.applied).not.toHaveProperty("contextWindowUsage");
  });

  it("patches only the timeline page metadata that changed", () => {
    const olderRow = row("older");
    const previous = timeline([row("a")]);
    previous.timelinePage.olderRowUpdates = [olderRow];
    const current = timeline([row("a")], { tag: "tag-2" });
    current.timelinePage = {
      ...current.timelinePage,
      historySnapshot: "snapshot-2",
      olderRowUpdates: [olderRow],
    };
    const first = roundTrip(previous, current);
    expect(first.delta.delta.fields).toEqual({
      timelinePage: { historySnapshot: "snapshot-2" },
    });
    expect(first.applied).toEqual(current);

    const cleared = timeline([row("a")], { tag: "tag-3" });
    cleared.timelinePage.historySnapshot = "snapshot-2";
    const second = roundTrip(current, cleared);
    expect(second.delta.delta.fields).toEqual({
      timelinePage: { olderRowUpdates: null },
    });
    expect(second.applied).toEqual(cleared);
    expect(second.applied?.timelinePage).not.toHaveProperty("olderRowUpdates");
  });

  it("lists every timeline page field", () => {
    expect(new Set([...TIMELINE_PAGE_FIELD_KEYS, "olderRowUpdates"])).toEqual(
      new Set(Object.keys(timelinePageMetadataSchema.shape)),
    );
  });

  it("keeps unchanged rows by identity", () => {
    const a = row("a");
    const previous = timeline([a, row("b")]);
    const current = timeline([a, row("b", "changed")], { tag: "tag-2" });
    expect(roundTrip(previous, current).applied?.rows[0]).toBe(a);
  });

  it("refuses a delta built against a different baseline", () => {
    const previous = timeline([row("a")]);
    const current = timeline([row("a"), row("b")], { tag: "tag-2" });
    const delta = computeThreadTimelineDelta(previous, current);
    expect(
      applyThreadTimelineDelta({ ...previous, tag: "other" }, delta),
    ).toBeNull();
  });

  it("refuses ranges or upserts that do not fit the held rows", () => {
    const previous = timeline([row("a")]);
    const delta = (rowOrder: [[number, number]] | undefined) =>
      applyThreadTimelineDelta(previous, {
        maxSeq: 2,
        tag: "tag-2",
        delta: {
          afterTag: "tag-1",
          upsertRows: rowOrder === undefined ? [row("z")] : [],
          ...(rowOrder === undefined ? {} : { rowOrder }),
          fields: {},
        },
      });
    expect(delta([[0, 2]])).toBeNull();
    expect(delta(undefined)).toBeNull();
  });

  it("applies past a locally appended optimistic row", () => {
    const previous = timeline([row("a"), row("b")]);
    const current = timeline([row("a"), row("b"), row("c")], { tag: "tag-2" });
    const delta = computeThreadTimelineDelta(previous, current);
    const held = { ...previous, rows: [...previous.rows, row("optimistic")] };
    expect(applyThreadTimelineDelta(held, delta)).toEqual(current);
  });

  it("lists every top-level window field", () => {
    expect(
      new Set([
        ...THREAD_TIMELINE_WINDOW_FIELD_KEYS,
        "rows",
        "contextWindowUsage",
        "timelinePage",
        "maxSeq",
        "tag",
      ]),
    ).toEqual(new Set(Object.keys(threadTimelineResponseSchema.shape)));
  });

  it("reads untagged pushes from older servers as unreadable", () => {
    const signal = (timelineValue: unknown) =>
      threadTimelineSignalLenientSchema.parse({
        type: "thread-timeline",
        target: {
          kind: "thread-timeline",
          threadId: "thr_x",
          segmentLimit: null,
          deferContent: true,
        },
        afterSequence: 3,
        timeline: timelineValue,
      }).timeline;
    const { tag: _tag, ...untagged } = timeline([row("a")]);
    expect(signal(untagged)).toBeNull();
    expect(
      signal({ ...untagged, delta: { upsertRows: [], rowOrder: [] } }),
    ).toBeNull();
    expect(signal(timeline([row("a")]))).not.toBeNull();
  });
});
