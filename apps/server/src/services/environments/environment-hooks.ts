import type { EnvironmentHookProgressMessage } from "@bb/host-daemon-contract";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";

export const ENVIRONMENT_HOOK_TIMEOUT_MS = 15 * 60 * 1000;
const TRANSPORT_GRACE_MS = 6_000;
const reports = new WeakMap<
  object,
  Map<
    string,
    {
      hostId: string;
      report: PluginEnvironmentProviderProgress;
    }
  >
>();

export function reportEnvironmentHookProgress(
  deps: Pick<WorkSessionDeps, "db">,
  hostId: string,
  progress: EnvironmentHookProgressMessage,
): void {
  const active = reports.get(deps.db)?.get(progress.operationId);
  if (active === undefined || active.hostId !== hostId) return;
  if (progress.entry.type === "output")
    active.report.log(progress.entry.text + "\n");
  else if (progress.entry.status !== "failed")
    active.report.step(progress.entry.text);
}

export async function runEnvironmentHook(
  deps: WorkSessionDeps,
  args: {
    id: string;
    hostId: string;
    path: string;
    kind: "setup" | "teardown";
    resumeOnly: boolean;
    report: PluginEnvironmentProviderProgress;
    signal: AbortSignal;
  },
): Promise<void> {
  args.signal.throwIfAborted();
  let active = reports.get(deps.db);
  if (active === undefined) {
    active = new Map();
    reports.set(deps.db, active);
  }
  const operationId = args.id;
  active.set(operationId, { hostId: args.hostId, report: args.report });
  const abort = (): void => {
    void callHostOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: TRANSPORT_GRACE_MS,
      command: { type: "environment.hook.cancel", operationId },
    }).catch((error) =>
      deps.logger.warn(
        { error, operationId },
        "Environment hook cancellation failed",
      ),
    );
  };
  args.signal.addEventListener("abort", abort, { once: true });
  try {
    await callHostOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: ENVIRONMENT_HOOK_TIMEOUT_MS + TRANSPORT_GRACE_MS,
      command: {
        type: "environment.hook.run",
        resumeOnly: args.resumeOnly,
        operationId,
        path: args.path,
        kind: args.kind,
        timeoutMs: ENVIRONMENT_HOOK_TIMEOUT_MS,
      },
    });
    args.signal.throwIfAborted();
  } catch (error) {
    await cancelPendingEnvironmentHook(deps, {
      id: args.id,
      hostId: args.hostId,
    });
    if (args.kind === "setup") throw error;
    const text = error instanceof Error ? error.message : String(error);
    args.report.log(text);
    deps.logger.warn(
      { hostId: args.hostId, path: args.path, error: text },
      "Environment teardown hook failed; continuing removal",
    );
  } finally {
    args.signal.removeEventListener("abort", abort);
    active.delete(operationId);
  }
}

export async function cancelPendingEnvironmentHook(
  deps: WorkSessionDeps,
  args: { id: string; hostId: string },
): Promise<void> {
  const result = await callHostOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: TRANSPORT_GRACE_MS,
    command: { type: "environment.hook.cancel", operationId: args.id },
  });
  if (result.status === "unknown")
    throw new Error(
      "Environment hook outcome is unknown after interruption. Automatic cleanup is blocked; inspect the workspace before recovering it.",
    );
}
