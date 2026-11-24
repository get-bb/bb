import {
  finishEnvironmentHookOperation,
  getEnvironmentHookOperation,
  insertEnvironmentHookOperation,
  restartEnvironmentHookOperation,
} from "@bb/db";
import type { ProvisioningTranscriptEntry } from "@bb/domain";
import type { EnvironmentHookProgressMessage } from "@bb/host-daemon-contract";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { resolveHostEnvironment } from "../hosts/host-environment.js";
import {
  callHostOnlineRpc,
  callHostOnlineRpcForWork,
} from "../hosts/online-rpc.js";
import { ENVIRONMENT_HOOK_TIMEOUT_MS } from "./environment-hook-timeout.js";

const TRANSPORT_GRACE_MS = 6_000;

export type EnvironmentHookProgressSink = (
  entry: ProvisioningTranscriptEntry,
) => void;

const sinks = new WeakMap<
  object,
  Map<string, { hostId: string; onProgress: EnvironmentHookProgressSink }>
>();

export function progressSinkForReport(
  report: PluginEnvironmentProviderProgress,
): EnvironmentHookProgressSink {
  return (entry) => {
    if (entry.type === "output") report.log(entry.text + "\n");
    else if (entry.status !== "failed") report.step(entry.text);
  };
}

export function registerEnvironmentProgressReport(
  deps: Pick<WorkSessionDeps, "db">,
  args: {
    hostId: string;
    operationId: string;
    onProgress: EnvironmentHookProgressSink;
  },
): () => void {
  let active = sinks.get(deps.db);
  if (active === undefined) {
    active = new Map();
    sinks.set(deps.db, active);
  }
  const registration = { hostId: args.hostId, onProgress: args.onProgress };
  active.set(args.operationId, registration);
  return () => {
    if (active.get(args.operationId) === registration)
      active.delete(args.operationId);
  };
}

export function reportEnvironmentHookProgress(
  deps: Pick<WorkSessionDeps, "db">,
  hostId: string,
  progress: EnvironmentHookProgressMessage,
): void {
  const active = sinks.get(deps.db)?.get(progress.operationId);
  if (active === undefined || active.hostId !== hostId) return;
  const { entry } = progress;
  active.onProgress({
    type: entry.type,
    key: entry.key,
    text: entry.text,
    ...(entry.status === null ? {} : { status: entry.status }),
    ...(entry.startedAt === null ? {} : { startedAt: entry.startedAt }),
    ...(entry.metadata === null ? {} : { metadata: entry.metadata }),
  });
}

function isEnvironmentSetupScriptFailure(error: unknown): boolean {
  return error instanceof ApiError && error.body.code === "setup_script_failed";
}

export function isEnvironmentHookOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.body.code === "environment_hook_outcome_unknown"
  );
}

export async function runEnvironmentHook(
  deps: WorkSessionDeps,
  args: {
    id: string;
    projectId: string;
    hostId: string;
    path: string;
    kind: "setup" | "teardown";
    resumeOnly: boolean;
    onProgress: EnvironmentHookProgressSink;
    signal: AbortSignal;
  },
): Promise<void> {
  args.signal.throwIfAborted();
  const existing = getEnvironmentHookOperation(deps.db, args.id);
  if (existing?.finishedAt != null && args.kind === "teardown") return;
  const resuming = existing !== null && existing.finishedAt === null;
  const contributedEnv = await resolveHostEnvironment(deps, {
    hostId: args.hostId,
    projectId: args.projectId,
  });
  if (existing === null)
    insertEnvironmentHookOperation(deps.db, {
      id: args.id,
      hostId: args.hostId,
      path: args.path,
      kind: args.kind,
      startedAt: Date.now(),
    });
  else if (!resuming)
    restartEnvironmentHookOperation(deps.db, args.id, Date.now());
  const unregister = registerEnvironmentProgressReport(deps, {
    operationId: args.id,
    hostId: args.hostId,
    onProgress: args.onProgress,
  });
  const abort = (): void => {
    void cancelPendingEnvironmentHook(deps, {
      id: args.id,
      hostId: args.hostId,
    }).catch((error) =>
      deps.logger.warn(
        { error, operationId: args.id },
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
        contributedEnv,
        resumeOnly: args.resumeOnly || resuming,
        operationId: args.id,
        path: args.path,
        kind: args.kind,
        timeoutMs: ENVIRONMENT_HOOK_TIMEOUT_MS,
      },
    });
    finishEnvironmentHookOperation(deps.db, args.id, {
      finishedAt: Date.now(),
      error: null,
    });
    args.signal.throwIfAborted();
  } catch (error) {
    if (isEnvironmentSetupScriptFailure(error))
      finishEnvironmentHookOperation(deps.db, args.id, {
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    throw error;
  } finally {
    args.signal.removeEventListener("abort", abort);
    unregister();
  }
}

export async function runEnvironmentTeardownHook(
  deps: WorkSessionDeps,
  args: {
    id: string;
    projectId: string;
    hostId: string;
    path: string;
    resumeOnly: boolean;
    report: PluginEnvironmentProviderProgress;
    signal: AbortSignal;
  },
): Promise<void> {
  try {
    await runEnvironmentHook(deps, {
      id: args.id,
      projectId: args.projectId,
      hostId: args.hostId,
      path: args.path,
      kind: "teardown",
      resumeOnly: args.resumeOnly,
      onProgress: progressSinkForReport(args.report),
      signal: args.signal,
    });
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
  }
}

export async function cancelPendingEnvironmentHook(
  deps: WorkSessionDeps,
  args: { id: string; hostId: string },
): Promise<void> {
  const id = args.id;
  const operation = getEnvironmentHookOperation(deps.db, id);
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
  finishEnvironmentHookOperation(deps.db, id, {
    finishedAt: Date.now(),
    error: "Environment hook cancelled",
  });
}
