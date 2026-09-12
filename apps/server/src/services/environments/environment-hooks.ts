import { resolveHostEnvironment } from "../hosts/host-environment.js";
import { environmentHookOperations } from "@bb/db";
import { eq } from "drizzle-orm";
import type { EnvironmentHookProgressMessage } from "@bb/host-daemon-contract";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import type { WorkSessionDeps } from "../../types.js";
import {
  callHostOnlineRpc,
  callHostOnlineRpcForWork,
} from "../hosts/online-rpc.js";

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

function registerEnvironmentProgressReport(
  deps: Pick<WorkSessionDeps, "db">,
  args: {
    hostId: string;
    operationId: string;
    report: PluginEnvironmentProviderProgress;
  },
): () => void {
  let active = reports.get(deps.db);
  if (active === undefined) {
    active = new Map();
    reports.set(deps.db, active);
  }
  active.set(args.operationId, {
    hostId: args.hostId,
    report: args.report,
  });
  return () => {
    if (active.get(args.operationId)?.report === args.report)
      active.delete(args.operationId);
  };
}

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
    kind: "teardown";
    resumeOnly: boolean;
    report: PluginEnvironmentProviderProgress;
    signal: AbortSignal;
  },
): Promise<void> {
  args.signal.throwIfAborted();
  const existing = deps.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.id, args.id))
    .get();
  if (existing?.finishedAt != null) return;
  const operationId = args.id;
  if (existing === undefined)
    deps.db
      .insert(environmentHookOperations)
      .values({
        id: args.id,
        operationId,
        hostId: args.hostId,
        path: args.path,
        kind: args.kind,
        startedAt: Date.now(),
      })
      .run();
  const unregister = registerEnvironmentProgressReport(deps, {
    operationId,
    hostId: args.hostId,
    report: args.report,
  });
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
    args.signal.throwIfAborted();
    await callHostOnlineRpcForWork(deps, {
      hostId: args.hostId,
      timeoutMs: ENVIRONMENT_HOOK_TIMEOUT_MS + TRANSPORT_GRACE_MS,
      command: {
        type: "environment.hook.run",
        contributedEnv: await resolveHostEnvironment(deps, {
          hostId: args.hostId,
          projectId: null,
        }),
        resumeOnly: args.resumeOnly || existing !== undefined,
        operationId,
        path: args.path,
        kind: args.kind,
        timeoutMs: ENVIRONMENT_HOOK_TIMEOUT_MS,
      },
    });
    deps.db
      .update(environmentHookOperations)
      .set({ finishedAt: Date.now() })
      .where(eq(environmentHookOperations.id, args.id))
      .run();
    args.signal.throwIfAborted();
  } catch (error) {
    await cancelPendingEnvironmentHook(deps, {
      id: args.id,
      hostId: args.hostId,
    });
    const text = error instanceof Error ? error.message : String(error);
    args.report.log(text);
    deps.logger.warn(
      { hostId: args.hostId, path: args.path, error: text },
      "Environment teardown hook failed; continuing removal",
    );
  } finally {
    args.signal.removeEventListener("abort", abort);
    unregister();
  }
}

export async function cancelPendingEnvironmentHook(
  deps: WorkSessionDeps,
  args: { id: string; hostId: string },
): Promise<void> {
  const id = args.id;
  const operation = deps.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.id, id))
    .get();
  if (operation?.finishedAt != null) return;
  const result = await callHostOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: TRANSPORT_GRACE_MS,
    command: {
      type: "environment.hook.cancel",
      operationId: args.id,
    },
  });
  if (result.status === "unknown")
    throw new Error(
      "Environment hook outcome is unknown after interruption. Automatic cleanup is blocked; inspect the workspace before recovering it.",
    );
  deps.db
    .update(environmentHookOperations)
    .set({
      finishedAt: Date.now(),
      error: "Environment hook cancelled",
    })
    .where(eq(environmentHookOperations.id, id))
    .run();
}
