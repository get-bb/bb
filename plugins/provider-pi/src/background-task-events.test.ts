import { describe, expect, it } from "vitest";
import { threadDeltaSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createDeltaAssembler as createAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  BackgroundTaskProjection,
  parseBackgroundTaskEvent,
  type BackgroundTaskEvent,
} from "./background-task-events.js";

const task = {
  id: "run",
  label: "Review",
  taskType: "local_subagent" as const,
  status: "running" as const,
};
function event(
  sequence: number,
  fields: Record<string, unknown> = {},
): BackgroundTaskEvent {
  const parsed = parseBackgroundTaskEvent({
    v: 1,
    source: "example.tools",
    sourceId: "publisher",
    sequence,
    kind: "upsert",
    task,
    ...fields,
  });
  if (!parsed) throw new Error("invalid fixture");
  return parsed;
}
function started() {
  const projection = new BackgroundTaskProjection("generation");
  projection.agentStart();
  return projection;
}

describe("experimental background task contract", () => {
  it.each([
    { v: 2 },
    { sequence: 0 },
    { sequence: 1.5 },
    { source: "bad|source" },
    { sourceId: "x".repeat(129) },
    { task: { ...task, id: "" } },
    { task: { ...task, label: "x".repeat(257) } },
    { task: { ...task, summary: "x".repeat(2049) } },
    { task: { ...task, taskType: "arbitrary" } },
    { task: { ...task, status: "unknown" } },
    { kind: "snapshot", tasks: [task, task] },
    {
      kind: "snapshot",
      tasks: Array.from({ length: 257 }, (_, id) => ({
        ...task,
        id: String(id),
      })),
    },
  ])("rejects malformed envelopes atomically: %j", (fields) => {
    expect(
      parseBackgroundTaskEvent({ ...event(1), ...fields }),
    ).toBeUndefined();
  });

  it("strips private data at both envelope and task boundaries", () => {
    expect(
      parseBackgroundTaskEvent({
        ...event(1),
        threadId: "private",
        payload: "secret",
        task: { ...task, output: "private", prompt: "secret" },
      }),
    ).toEqual(event(1));
  });

  it.each(["pending", "paused", "running"] as const)(
    "keeps %s active",
    (status) => {
      const deltas = started().accept(event(1, { task: { ...task, status } }));
      expect(deltas).toMatchObject([
        {
          kind: "item.open",
          item: {
            status: "pending",
            taskStatus: status,
            skipTranscript: false,
          },
        },
      ]);
    },
  );

  it.each([
    ["completed", "completed"],
    ["failed", "failed"],
    ["killed", "interrupted"],
    ["stopped", "interrupted"],
  ])("closes %s once", (status, itemStatus) => {
    const projection = started();
    projection.accept(event(1));
    expect(
      projection.accept(event(2, { task: { ...task, status } })),
    ).toMatchObject([{ kind: "item.close", status: itemStatus }]);
    expect(projection.accept(event(3))).toEqual([]);
    expect(projection.accept(event(4, { task: { ...task, status } }))).toEqual(
      [],
    );
  });

  it("holds snapshots until a real turn and maintains native identity after parent idle", () => {
    const projection = new BackgroundTaskProjection("generation");
    const assembler = createAssembler({
      providerId: "pi",
      entropyPrefix: "background-test",
    });
    const assemble = (deltas: ReturnType<typeof projection.accept>) =>
      assembler.assemble({
        threadId: "thr_background",
        deltas: deltas.map((delta) => threadDeltaSchema.parse(delta)),
      });
    expect(
      projection.accept(event(1, { kind: "snapshot", tasks: [task] })),
    ).toEqual([]);
    assemble([{ kind: "session.reset" }, { kind: "turn.open" }]);
    const opened = assemble(projection.agentStart());
    expect(opened).toHaveLength(1);
    const open = opened[0];
    if (open?.type !== "item/started" || open.item.type !== "backgroundTask")
      throw new Error("missing task");
    expect(open.item).toMatchObject({
      status: "pending",
      taskType: "local_subagent",
      skipTranscript: false,
    });
    assemble([{ kind: "turn.boundary", status: "completed" }]);
    const progress = assemble(
      projection.accept(
        event(2, { task: { ...task, summary: "Idle progress" } }),
      ),
    );
    const completed = assemble(
      projection.accept(event(3, { task: { ...task, status: "completed" } })),
    );
    expect(progress).toMatchObject([
      {
        type: "item/backgroundTask/progress",
        scope: { kind: "thread" },
        item: {
          id: open.item.id,
          familyId: open.item.familyId,
          summary: "Idle progress",
          status: "pending",
          taskType: "local_subagent",
          skipTranscript: false,
        },
      },
    ]);
    expect(completed).toMatchObject([
      {
        type: "item/backgroundTask/completed",
        item: {
          id: open.item.id,
          familyId: open.item.familyId,
          status: "completed",
          skipTranscript: false,
        },
      },
    ]);
    expect(completed).toHaveLength(1);
  });

  it("deduplicates ordering, reconciles publisher supersession and rejects retired publishers", () => {
    const projection = started();
    projection.accept(event(4));
    expect(projection.accept(event(4))).toEqual([]);
    expect(projection.accept(event(2, { kind: "clear" }))).toEqual([]);
    const replacement = projection.accept(event(1, { sourceId: "next" }));
    expect(replacement.map((delta) => delta.kind)).toEqual([
      "item.close",
      "item.open",
    ]);
    expect(projection.accept(event(999))).toEqual([]);
    expect(
      projection.accept(event(2, { sourceId: "next", kind: "clear" })),
    ).toMatchObject([{ kind: "item.close", item: { taskStatus: "stopped" } }]);
  });

  it("reconciles omitted and cleared tasks without reopening their run IDs", () => {
    const projection = started();
    projection.accept(
      event(1, { kind: "snapshot", tasks: [task, { ...task, id: "other" }] }),
    );
    expect(
      projection.accept(event(2, { kind: "snapshot", tasks: [task] })),
    ).toMatchObject([
      { kind: "item.close", item: { taskStatus: "stopped" } },
      { kind: "item.progress" },
    ]);
    expect(projection.accept(event(3, { kind: "clear" }))).toHaveLength(1);
    expect(projection.accept(event(4))).toEqual([]);
    expect(projection.close()).toEqual([]);
  });

  it("namespaces IDs by source and generation", () => {
    const projection = started();
    const a = projection.accept(event(1));
    const b = projection.accept(event(1, { source: "other" }));
    const other = new BackgroundTaskProjection("other-session");
    other.agentStart();
    const c = other.accept(event(1));
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("bounds admission without silently evicting active work", () => {
    const projection = started();
    for (let i = 0; i < 64; i++)
      expect(projection.accept(event(1, { source: `s${i}` }))).toHaveLength(1);
    expect(projection.accept(event(1, { source: "overflow" }))).toEqual([]);
    expect(projection.close()).toHaveLength(64);
    const tasks = started();
    for (let i = 0; i < 8; i++)
      tasks.accept(
        event(i + 1, {
          kind: "snapshot",
          tasks: Array.from({ length: 256 }, (_, j) => ({
            ...task,
            id: String(i * 256 + j),
          })),
        }),
      );
    expect(
      tasks.accept(event(9, { task: { ...task, id: "overflow" } })),
    ).toEqual([]);
    expect(tasks.close()).toHaveLength(256);
    const lifetimes = started();
    for (let i = 0; i <= 32; i++)
      lifetimes.accept(event(1, { sourceId: `life${i}` }));
    expect(lifetimes.accept(event(1, { sourceId: "overflow" }))).toEqual([]);
    expect(lifetimes.close()).toHaveLength(1);
  });
});
