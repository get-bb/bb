import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import {
  runSetupScript,
  runTeardownScript,
} from "../environment-lifecycle-script.js";

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
  const active = controllers(options);
  const existing = active.get(command.operationId);
  if (existing !== undefined) {
    if (existing.path !== command.path || existing.kind !== command.kind)
      throw new Error("Environment hook identity mismatch");
    return existing.done;
  }
  if (command.resumeOnly)
    throw new Error("Environment hook operation is unknown; cleanup pending");
  const controller = new AbortController();
  const done = (async (): Promise<Record<string, never>> => {
    const run = command.kind === "setup" ? runSetupScript : runTeardownScript;
    await run({
      workspacePath: command.path,
      timeoutMs: command.timeoutMs,
      shellPath: options.runtimeManager.getShellEnv().PATH,
      signal: controller.signal,
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
    return {};
  })();
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
): Promise<Record<string, never>> {
  const operation = controllers(options).get(command.operationId);
  if (operation === undefined)
    throw new Error("Environment hook operation is unknown; cleanup pending");
  operation.controller.abort();
  await operation.done.catch(() => undefined);
  return {};
}
