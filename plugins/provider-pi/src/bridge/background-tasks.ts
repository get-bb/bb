import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  backgroundTaskItemStatus,
  experimental_killPortableProcess as killPortableProcess,
  experimental_spawnPortableProcess as spawnPortableProcess,
  type BackgroundTaskStatus,
  type DeltaBackgroundTaskShape,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import { buildPiChildEnv } from "./rpc-child.js";
import { BACKGROUND_TASK_WORKER_SOURCE } from "./background-task-worker.js";

const launchSchema = z
  .object({
    command: z.string().trim().min(1).max(65536),
    description: z.string().trim().min(1).max(200),
    cwd: z.string().min(1).max(4096).optional(),
    timeout_sec: z.number().int().positive().max(2147483).optional(),
  })
  .strict();
const cancelSchema = z.object({ taskId: z.string().uuid() }).strict();

export const BACKGROUND_TASK_TOOLS = [
  {
    name: "background_task",
    description:
      "Run a shell command as a background task and return immediately. BB shows a task card and delivers completion automatically; continue other work without polling. Full output stays in a file. Ordinary turn completion preserves work; stopping the thread cancels it.",
    inputSchema: z.toJSONSchema(launchSchema),
  },
  {
    name: "background_task_cancel",
    description:
      "Cancel a background shell task owned by this thread, terminating its process tree.",
    inputSchema: z.toJSONSchema(cancelSchema),
  },
];

const recordSchema = z.object({
  taskId: z.string().uuid(),
  pid: z.number().int().positive(),
  command: z.string(),
  description: z.string().max(200),
  startedAt: z.number(),
});
const registrySchema = z.array(recordSchema);
const resultSchema = z.object({
  code: z.number().int().nullable(),
  error: z.string().nullable(),
});
type TaskRecord = z.infer<typeof recordSchema>;
type TaskResult = z.infer<typeof resultSchema>;
interface RunningTask {
  record: TaskRecord;
  child: ChildProcess;
  settled: Promise<void>;
  stopReason: string | null;
  deadline: ReturnType<typeof setTimeout> | null;
  killEscalation: ReturnType<typeof setTimeout> | null;
}

function outputTail(path: string): string {
  if (!existsSync(path)) return "";
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const buffer = Buffer.alloc(Math.min(size, 2048));
    const bytes = readSync(
      fd,
      buffer,
      0,
      buffer.length,
      Math.max(0, size - buffer.length),
    );
    return buffer.subarray(0, bytes).toString("utf8").slice(-500);
  } finally {
    closeSync(fd);
  }
}

export class BackgroundTaskTracker {
  private readonly tasks = new Map<string, RunningTask>();
  private readonly directory: string;
  private records: TaskRecord[];
  private disposed = false;
  private readonly executions = new Set<Promise<string>>();

  constructor(
    private readonly options: {
      cwd: string;
      threadId: string;
      emit: (deltas: ThreadDelta[]) => void;
      notify: (text: string) => Promise<void>;
      reportError: (error: unknown) => void;
    },
  ) {
    const owner = createHash("sha256").update(options.threadId).digest("hex");
    this.directory = join(options.cwd, ".bb-pi-bg", owner);
    const registry = join(this.directory, "registry.json");
    this.records = existsSync(registry)
      ? registrySchema.parse(JSON.parse(readFileSync(registry, "utf8")))
      : [];
  }

  recover(): void {
    for (const record of this.records) {
      this.options.emit([
        this.closeDelta(
          record,
          { code: null, error: "task orphaned by provider restart" },
          "failed",
        ),
      ]);
    }
    if (this.records.length > 0) {
      this.records = [];
      this.persist();
    }
  }

  execute(
    name: string,
    args: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<string> {
    const execution = this.run(name, args, env);
    this.executions.add(execution);
    void execution
      .finally(() => this.executions.delete(execution))
      .catch(() => undefined);
    return execution;
  }

  private async run(
    name: string,
    args: Record<string, unknown>,
    env: Record<string, string>,
  ): Promise<string> {
    if (this.disposed)
      throw new Error("Background tasks are stopped for this session");
    if (name === "background_task_cancel") {
      const { taskId } = cancelSchema.parse(args);
      const task = this.tasks.get(taskId);
      if (!task)
        throw new Error(
          "No running background task owned by this thread: " + taskId,
        );
      await this.stop(task, "cancelled");
      return JSON.stringify({ taskId, status: "killed" });
    }
    const params = launchSchema.parse(args);
    const cwd = resolve(this.options.cwd, params.cwd ?? ".");
    if (!statSync(cwd).isDirectory())
      throw new Error("Background task cwd must be a directory");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const taskId = randomUUID();
    const outputFile = this.outputFile(taskId);
    const output = openSync(outputFile, "wx", 0o600);
    let child: ChildProcess;
    try {
      child = spawnPortableProcess({
        command: process.execPath,
        args: ["-e", BACKGROUND_TASK_WORKER_SOURCE],
        cwd,
        env: {
          ...buildPiChildEnv(env),
          ...(process.env.ELECTRON_RUN_AS_NODE
            ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE }
            : {}),
        },
        detached: true,
        stdio: ["pipe", output, output],
      });
    } finally {
      closeSync(output);
    }
    child.stdin?.on("error", () => undefined);
    await new Promise<void>((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error("Background worker did not start");
    const record: TaskRecord = {
      taskId,
      pid,
      command: params.command,
      description: params.description,
      startedAt: Date.now(),
    };
    let settle: () => void = () => undefined;
    const task: RunningTask = {
      record,
      child,
      stopReason: null,
      deadline: null,
      killEscalation: null,
      settled: new Promise<void>((resolveSettled) => {
        settle = resolveSettled;
      }),
    };
    this.tasks.set(taskId, task);
    child.once("exit", () => {
      try {
        this.complete(task);
      } catch (error) {
        this.options.reportError(error);
      } finally {
        settle();
      }
    });
    try {
      this.records.push(record);
      this.persist();
      this.options.emit([
        {
          kind: "item.open",
          key: this.key(taskId),
          item: this.shape(record, "running"),
          attach: "currentOrLast",
        },
      ]);
      if (this.disposed) {
        await this.stop(task, "stopped");
        throw new Error("Session stopped before background task launch");
      }
      child.stdin?.write(
        JSON.stringify({
          ...params,
          cwd,
          resultFile: this.resultFile(taskId),
        }) + "\n",
      );
      if (params.timeout_sec) {
        task.deadline = setTimeout(() => {
          void this.stop(task, "timeout").catch(this.options.reportError);
        }, params.timeout_sec * 1000);
      }
    } catch (error) {
      await this.stop(task, "stopped");
      throw error;
    }
    return (
      JSON.stringify({ taskId, outputFile }) +
      "\nCompletion will be delivered automatically. Continue other work without polling."
    );
  }

  hasRunningTasks(): boolean {
    return this.tasks.size > 0;
  }

  sessionResetDeltas(turnDeltas: readonly ThreadDelta[]): ThreadDelta[] {
    const deltas: ThreadDelta[] = [];
    for (const task of this.tasks.values()) {
      const item = {
        ...this.shape(task.record, "stopped"),
        summary: "Task tracking continues in the replacement Pi session.",
      };
      deltas.push({
        kind: "item.close",
        key: this.key(task.record.taskId),
        status: item.status,
        item,
      });
    }
    const turnOpen = turnDeltas.findIndex(
      (delta) => delta.kind === "turn.open",
    );
    deltas.push(
      { kind: "session.reset" },
      ...turnDeltas.slice(0, turnOpen + 1),
    );
    for (const task of this.tasks.values())
      deltas.push({
        kind: "item.open",
        key: this.key(task.record.taskId),
        item: this.shape(task.record, "running"),
        attach: "currentOrLast",
      });
    deltas.push(...turnDeltas.slice(turnOpen + 1));
    return deltas;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.executions]);
    await Promise.all(
      [...this.tasks.values()].map((task) => this.stop(task, "stopped")),
    );
  }

  private async stop(task: RunningTask, reason: string): Promise<void> {
    task.stopReason ??= reason;
    task.child.stdin?.write(JSON.stringify({ stop: task.stopReason }) + "\n");
    task.child.stdin?.end();
    if (task.killEscalation === null && this.tasks.has(task.record.taskId)) {
      task.killEscalation = setTimeout(() => {
        if (!this.tasks.has(task.record.taskId)) return;
        if (process.platform === "win32")
          killPortableProcess(task.child, "SIGKILL");
        else {
          try {
            process.kill(-task.record.pid, "SIGKILL");
          } catch {
            task.child.kill("SIGKILL");
          }
        }
      }, 500);
    }
    await task.settled;
  }

  private complete(task: RunningTask): void {
    if (!this.tasks.delete(task.record.taskId)) return;
    if (task.deadline) clearTimeout(task.deadline);
    if (task.killEscalation) clearTimeout(task.killEscalation);
    const resultPath = this.resultFile(task.record.taskId);
    let result: TaskResult = {
      code: task.child.exitCode,
      error: "Background worker exited without a result",
    };
    if (existsSync(resultPath)) {
      try {
        result = resultSchema.parse(
          JSON.parse(readFileSync(resultPath, "utf8")),
        );
      } catch (error) {
        result.error =
          "Could not read background task result: " + String(error);
      }
    }
    if (task.stopReason) result.error = task.stopReason;
    if (result.error) result.error = result.error.slice(0, 500);
    const status: BackgroundTaskStatus =
      result.error === "stopped"
        ? "stopped"
        : result.error === "cancelled"
          ? "killed"
          : result.error || result.code !== 0
            ? "failed"
            : "completed";
    this.records = this.records.filter(
      (record) => record.taskId !== task.record.taskId,
    );
    try {
      this.persist();
    } catch (error) {
      this.options.reportError(error);
    }
    const delta = this.closeDelta(task.record, result, status);
    this.options.emit([delta]);
    if (!this.disposed) {
      const summary = outputTail(this.outputFile(task.record.taskId));
      const text = `Background task '${task.record.description}' (id ${task.record.taskId}) ${status}${result.error ? ": " + result.error : "; exit code " + result.code}. Output file: ${this.outputFile(task.record.taskId)}\n${summary}`;
      void this.options.notify(text).catch(this.options.reportError);
    }
  }

  private shape(
    record: TaskRecord,
    taskStatus: BackgroundTaskStatus,
  ): DeltaBackgroundTaskShape {
    return {
      type: "backgroundTask",
      familyId: record.taskId,
      taskType: "local_bash",
      description: record.description,
      status: backgroundTaskItemStatus(taskStatus),
      taskStatus,
      skipTranscript: false,
      outputFile: this.outputFile(record.taskId),
    };
  }

  private closeDelta(
    record: TaskRecord,
    result: TaskResult,
    status: BackgroundTaskStatus,
  ): ThreadDelta {
    const item = {
      ...this.shape(record, status),
      summary: outputTail(this.outputFile(record.taskId)),
      ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    };
    return {
      kind: "item.close",
      key: this.key(record.taskId),
      status: item.status,
      item,
    };
  }

  private key(taskId: string) {
    return { providerItemId: "bgtask-" + taskId };
  }
  private outputFile(taskId: string): string {
    return join(this.directory, taskId + ".log");
  }
  private resultFile(taskId: string): string {
    return join(this.directory, taskId + ".result.json");
  }
  private persist(): void {
    const path = join(this.directory, "registry.json");
    writeFileSync(path + ".tmp", JSON.stringify(this.records), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  }
}
