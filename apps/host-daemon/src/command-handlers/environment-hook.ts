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
const operations = new WeakMap<
  object,
  Map<string, HookOperation | "cancelled">
>();

function controllers(
  options: CommandDispatchOptions,
): Map<string, HookOperation | "cancelled"> {
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
  if (existing === "cancelled")
    throw new Error("Environment hook cancelled before dispatch");
  if (existing !== undefined) {
    if (existing.path !== command.path || existing.kind !== command.kind)
      throw new Error("Environment hook identity mismatch");
    return existing.done;
  }
  if (command.resumeOnly)
    throw new Error("Environment hook outcome is unknown after daemon restart");
  const controller = new AbortController();
  const done = Promise.resolve().then(
    async (): Promise<Record<string, never>> => {
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
): Promise<{ status: "unknown" | "terminated" }> {
  const active = controllers(options);
  const operation = active.get(command.operationId);
  if (operation === undefined || operation === "cancelled") {
    active.set(command.operationId, "cancelled");
    return { status: "unknown" };
  }
  operation.controller.abort();
  await operation.done.catch(() => undefined);
  return { status: "terminated" };
}
