import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import {
  runSetupScript,
  runTeardownScript,
} from "../environment-lifecycle-script.js";

import {
  environmentHookRecordStore,
  environmentHookProcessStart,
  terminateEnvironmentHookProcess,
  type EnvironmentHookRecord,
} from "../environment-hook-records.js";

interface HookOperation {
  controller: AbortController;
  done: Promise<Record<string, never>>;
  path: string;
  kind: "setup" | "teardown";
}
const operations = new WeakMap<object, Map<string, HookOperation>>();

function controllers(
  options: CommandDispatchOptions,
): Map<string, HookOperation> {
  let active = operations.get(options.runtimeManager);
  if (active === undefined) {
    active = new Map();
    operations.set(options.runtimeManager, active);
  }
  return active;
}

export async function runEnvironmentHook(
  command: CommandOf<"environment.hook.run">,
  options: CommandDispatchOptions,
): Promise<Record<string, never>> {
  if (
    environmentHookRecordStore(options.dataDir, command.operationId).cancelled()
  )
    throw new Error("Environment hook cancelled before dispatch");
  const active = controllers(options);
  const existing = active.get(command.operationId);
  if (existing !== undefined) {
    if (existing.path !== command.path || existing.kind !== command.kind)
      throw new Error("Environment hook identity mismatch");
    return existing.done;
  }
  const controller = new AbortController();
  const done = Promise.resolve().then(
    async (): Promise<Record<string, never>> => {
      const store = environmentHookRecordStore(
        options.dataDir,
        command.operationId,
      );
      if (store.cancelled())
        throw new Error("Environment hook cancelled before dispatch");
      const existingRecord = store.read();
      if (existingRecord !== null) {
        if (
          existingRecord.path !== command.path ||
          existingRecord.kind !== command.kind
        )
          throw new Error("Environment hook identity mismatch");
        if (existingRecord.finishedAt !== null) {
          if (existingRecord.error !== null)
            throw new Error(existingRecord.error);
          return {};
        }
        await terminateEnvironmentHookProcess(existingRecord);
        store.write({
          ...existingRecord,
          finishedAt: Date.now(),
          error: "Environment hook interrupted by daemon restart",
        });
        throw new Error("Environment hook interrupted by daemon restart");
      }
      if (command.resumeOnly)
        throw new Error("Environment hook was never started");
      let record: EnvironmentHookRecord = {
        operationId: command.operationId,
        path: command.path,
        kind: command.kind,
        pid: null,
        processStartedAt: null,
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      };
      store.write(record);
      try {
        const run =
          command.kind === "setup" ? runSetupScript : runTeardownScript;
        await run({
          workspacePath: command.path,
          timeoutMs: command.timeoutMs,
          shellPath: options.runtimeManager.getShellEnv().PATH,
          signal: controller.signal,
          onProcessSpawn: (pid) => {
            if (store.cancelled())
              throw new Error("Environment hook cancelled before dispatch");
            const processStartedAt = environmentHookProcessStart(pid);
            if (processStartedAt === null)
              throw new Error(
                "Environment hook process exited before dispatch",
              );
            record = { ...record, pid, processStartedAt };
            store.write(record);
          },
          onProgress: (entry) =>
            options.emitEnvironmentHookProgress?.({
              type: "environment.hook.progress",
              operationId: command.operationId,
              entry: {
                type: entry.type,
                text: entry.text,
                status: entry.status ?? null,
              },
            }),
        });
        store.write({ ...record, finishedAt: Date.now() });
        return {};
      } catch (error) {
        store.write({
          ...record,
          finishedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  );
  active.set(command.operationId, {
    controller,
    done,
    path: command.path,
    kind: command.kind,
  });
  return done;
}

export async function cancelEnvironmentHook(
  command: CommandOf<"environment.hook.cancel">,
  options: CommandDispatchOptions,
): Promise<{ status: "never-started" | "terminated" }> {
  const store = environmentHookRecordStore(
    options.dataDir,
    command.operationId,
  );
  store.cancel();
  const operation = controllers(options).get(command.operationId);
  if (operation !== undefined) {
    operation.controller.abort();
    await operation.done.catch(() => undefined);
  }
  const record = store.read();
  if (record === null) return { status: "never-started" };
  await terminateEnvironmentHookProcess(record);
  store.write({
    ...record,
    finishedAt: Date.now(),
    error: "Environment hook cancelled",
  });
  return { status: record.pid === null ? "never-started" : "terminated" };
}
