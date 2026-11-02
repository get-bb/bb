import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import {
  runEnvironmentHookOperation,
  runSetupScript,
  runTeardownScript,
} from "../environment-lifecycle-script.js";
import type { ResourceEnd } from "../resource-ledger.js";
import { inspectWorkspaceProcesses } from "../workspace-processes.js";

function hookResult(end: ResourceEnd): Record<string, never> {
  if (end.status === "failed") throw new Error(end.message);
  return {};
}

function cancelStatus(end: ResourceEnd): "unknown" | "terminated" {
  return end.status === "failed" && end.terminationUnverified
    ? "unknown"
    : "terminated";
}

export async function runEnvironmentHook(
  command: CommandOf<"environment.hook.run">,
  options: CommandDispatchOptions,
): Promise<Record<string, never>> {
  const ledger = options.runtimeManager.resourceLedger;
  if (ledger.isOperationCancelled(command.operationId))
    throw new ExpectedCommandDispatchError(
      "command_failed",
      "Environment hook cancelled before dispatch",
    );
  const existing = ledger.findOperation(command.operationId);
  const ended = ledger.operationEnd(command.operationId);
  const owner = existing?.owner ?? ended?.owner;
  if (
    owner !== undefined &&
    (owner.kind !== "environment-hook" ||
      owner.path !== command.path ||
      owner.hook !== command.kind)
  )
    throw new Error("Environment hook identity mismatch");
  if (existing !== undefined) return hookResult(await existing.done);
  if (ended !== null) return hookResult(ended.end);
  if (command.resumeOnly) {
    if (
      ledger.previousOperationTermination(command.operationId) === "confirmed"
    )
      throw new Error(
        "Environment hook was interrupted when the host daemon restarted; bb stopped its processes",
      );
    throw new Error("Environment hook outcome is unknown after daemon restart");
  }
  const run = command.kind === "setup" ? runSetupScript : runTeardownScript;
  try {
    await runEnvironmentHookOperation({
      ledger,
      operationId: command.operationId,
      kind: command.kind,
      workspacePath: command.path,
      timeoutMs: command.timeoutMs,
      run: (control) =>
        run({
          workspacePath: command.path,
          contributedEnv: command.contributedEnv,
          env: { ...process.env, ...options.runtimeManager.getShellEnv() },
          timeoutMs: command.timeoutMs,
          shellPath: options.runtimeManager.getShellEnv().PATH,
          signal: control.signal,
          processOwner: control.processOwner,
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
        }),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  return {};
}

export async function cancelEnvironmentHooks(
  runtimeManager: CommandDispatchOptions["runtimeManager"],
): Promise<void> {
  const running = runtimeManager.resourceLedger.find(
    (owner) => owner.kind === "environment-hook",
  );
  await Promise.all(running.map((resource) => resource.abort()));
  await Promise.all(running.map((resource) => resource.done));
}

export async function cancelEnvironmentHook(
  command: CommandOf<"environment.hook.cancel">,
  options: CommandDispatchOptions,
): Promise<{ status: "unknown" | "terminated" }> {
  const ledger = options.runtimeManager.resourceLedger;
  const resource = ledger.findOperation(command.operationId);
  if (resource !== undefined) {
    await resource.abort();
    return { status: cancelStatus(await resource.done) };
  }
  const ended = ledger.operationEnd(command.operationId);
  if (ended !== null) return { status: cancelStatus(ended.end) };
  if (ledger.previousOperationTermination(command.operationId) === "confirmed")
    return { status: "terminated" };
  ledger.markOperationCancelled(command.operationId);
  return { status: "unknown" };
}

export async function inspectEnvironmentCleanup(
  command: CommandOf<"environment.inspect_cleanup">,
  options: CommandDispatchOptions,
) {
  const inspection = await inspectWorkspaceProcesses(command.path);
  const active =
    options.runtimeManager.hasPendingEnvironmentProvision(
      command.environmentId,
    ) ||
    options.runtimeManager.resourceLedger.find(
      (owner) =>
        owner.kind === "environment-hook" && owner.path === command.path,
    ).length > 0;
  return { ...inspection, active };
}
