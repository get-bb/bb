import { randomUUID } from "node:crypto";
import type { EnvironmentHookProgressMessage } from "@bb/host-daemon-contract";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";

const HOOK_TIMEOUT_MS = 15 * 60 * 1000;
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
    hostId: string;
    path: string;
    kind: "setup" | "teardown";
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
  const operationId = randomUUID();
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
      timeoutMs: HOOK_TIMEOUT_MS + TRANSPORT_GRACE_MS,
      command: {
        type: "environment.hook.run",
        operationId,
        path: args.path,
        kind: args.kind,
        timeoutMs: HOOK_TIMEOUT_MS,
      },
    });
    args.signal.throwIfAborted();
  } catch (error) {
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
