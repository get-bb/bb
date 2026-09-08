import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import {
  runSetupScript,
  runTeardownScript,
} from "../environment-lifecycle-script.js";

const operations = new WeakMap<object, Map<string, AbortController>>();

function controllers(
  options: CommandDispatchOptions,
): Map<string, AbortController> {
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
  if (active.has(command.operationId))
    throw new Error("Environment hook is already running");
  const controller = new AbortController();
  active.set(command.operationId, controller);
  try {
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
  } finally {
    active.delete(command.operationId);
  }
}

export async function cancelEnvironmentHook(
  command: CommandOf<"environment.hook.cancel">,
  options: CommandDispatchOptions,
): Promise<Record<string, never>> {
  controllers(options).get(command.operationId)?.abort();
  return {};
}
