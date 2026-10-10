import { z } from "zod";
import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f|]+$/u);
const taskSchema = z.object({
  id: identifier,
  label: z.string().min(1).max(256),
  taskType: z.enum(["local_subagent", "local_agent", "local_bash"]),
  status: z.enum([
    "pending",
    "running",
    "paused",
    "completed",
    "failed",
    "killed",
    "stopped",
  ]),
  summary: z.string().max(2048).optional(),
  error: z.string().max(2048).optional(),
});
const header = {
  v: z.literal(1),
  source: identifier,
  sourceId: identifier,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};
const eventSchema = z.discriminatedUnion("kind", [
  z.object({ ...header, kind: z.literal("upsert"), task: taskSchema }),
  z
    .object({
      ...header,
      kind: z.literal("snapshot"),
      tasks: z.array(taskSchema).max(256),
    })
    .refine(
      (event) =>
        new Set(event.tasks.map((task) => task.id)).size === event.tasks.length,
    ),
  z.object({ ...header, kind: z.literal("clear") }),
]);
export type BackgroundTaskEvent = z.infer<typeof eventSchema>;
type Task = z.infer<typeof taskSchema>;

export function parseBackgroundTaskEvent(
  value: unknown,
): BackgroundTaskEvent | undefined {
  const result = eventSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function terminal(task: Task): boolean {
  return !["pending", "running", "paused"].includes(task.status);
}

type TrackedTask = { task: Task; opened: boolean; closed: boolean };
type Source = {
  sourceId: string;
  sequence: number;
  retired: Set<string>;
  tasks: Map<string, TrackedTask>;
};

export class BackgroundTaskProjection {
  private readonly sources = new Map<string, Source>();
  private hasTurn = false;
  private observerEpoch = 0;
  private taskCount = 0;

  constructor(private readonly generation: string) {}

  accept(event: BackgroundTaskEvent): ThreadDelta[] {
    let source = this.sources.get(event.source);
    if (source?.retired.has(event.sourceId)) return [];
    const replacing =
      source !== undefined && source.sourceId !== event.sourceId;
    if (source && !replacing && event.sequence <= source.sequence) return [];
    if (
      (!source && this.sources.size >= 64) ||
      (replacing && source && source.retired.size >= 32)
    )
      return [];
    const tasks =
      event.kind === "upsert"
        ? [event.task]
        : event.kind === "snapshot"
          ? event.tasks
          : [];
    const additions = tasks.filter(
      (task) => replacing || !source?.tasks.has(task.id),
    ).length;
    if (this.taskCount + additions > 2048) return [];
    const deltas: ThreadDelta[] = [];
    if (replacing && source) {
      this.stopSource(event.source, source, deltas);
      source.retired.add(source.sourceId);
      source.sourceId = event.sourceId;
      source.tasks = new Map();
    }
    if (!source) {
      source = {
        sourceId: event.sourceId,
        sequence: 0,
        retired: new Set(),
        tasks: new Map(),
      };
      this.sources.set(event.source, source);
    }
    source.sequence = event.sequence;
    if (event.kind !== "upsert") {
      const present = new Set(tasks.map((task) => task.id));
      for (const [id, tracked] of source.tasks) {
        if (!present.has(id) && !terminal(tracked.task)) {
          tracked.task = { ...tracked.task, status: "stopped" };
          this.project(event.source, source, tracked, deltas);
        }
      }
    }
    for (const task of tasks) {
      let tracked = source.tasks.get(task.id);
      if (tracked && terminal(tracked.task)) continue;
      if (!tracked) {
        tracked = { task, opened: false, closed: false };
        source.tasks.set(task.id, tracked);
        this.taskCount += 1;
      } else {
        tracked.task = task;
      }
      this.project(event.source, source, tracked, deltas);
    }
    return deltas;
  }

  agentStart(): ThreadDelta[] {
    this.hasTurn = true;
    const deltas: ThreadDelta[] = [];
    for (const [name, source] of this.sources) {
      for (const tracked of source.tasks.values()) {
        if (!tracked.opened) this.project(name, source, tracked, deltas);
      }
    }
    return deltas;
  }

  observerEnd(): ThreadDelta[] {
    const hasTurn = this.hasTurn;
    const deltas = this.close();
    this.hasTurn = hasTurn;
    this.observerEpoch += 1;
    return deltas;
  }

  close(): ThreadDelta[] {
    const deltas: ThreadDelta[] = [];
    for (const [name, source] of this.sources)
      this.stopSource(name, source, deltas);
    this.sources.clear();
    this.taskCount = 0;
    this.hasTurn = false;
    return deltas;
  }

  private stopSource(
    name: string,
    source: Source,
    deltas: ThreadDelta[],
  ): void {
    for (const tracked of source.tasks.values()) {
      if (!terminal(tracked.task)) {
        tracked.task = { ...tracked.task, status: "stopped" };
        this.project(name, source, tracked, deltas);
      }
    }
  }

  private project(
    name: string,
    source: Source,
    tracked: TrackedTask,
    deltas: ThreadDelta[],
  ): void {
    if (!this.hasTurn || tracked.closed) return;
    const task = tracked.task;
    const identity = `pi-background|${this.generation}|${this.observerEpoch}|${name}|${source.sourceId}|${task.id}`;
    const key = { providerItemId: identity };
    const status =
      task.status === "completed"
        ? "completed"
        : task.status === "failed"
          ? "failed"
          : terminal(task)
            ? "interrupted"
            : "pending";
    const item: Extract<ThreadDelta, { kind: "item.open" }>["item"] & {
      type: "backgroundTask";
    } = {
      type: "backgroundTask",
      familyId: identity,
      taskType: task.taskType,
      description: task.label,
      status,
      taskStatus: task.status,
      skipTranscript: false,
      ...(task.summary === undefined ? {} : { summary: task.summary }),
      ...(task.error === undefined ? {} : { error: task.error }),
    };
    if (!tracked.opened) {
      deltas.push({ kind: "item.open", key, item, attach: "currentOrLast" });
      tracked.opened = true;
    } else if (!terminal(task)) {
      deltas.push({ kind: "item.progress", key, snapshot: item, flush: true });
    }
    if (terminal(task)) {
      deltas.push({ kind: "item.close", key, item, status });
      tracked.closed = true;
    }
  }
}
