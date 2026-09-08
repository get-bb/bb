import { resolveHostEnvironment } from "../hosts/host-environment.js";
import { environmentHookOperations } from "@bb/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { EnvironmentHookProgressMessage } from "@bb/host-daemon-contract";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import {
  beginEnvironmentSetupOutcome,
  finishEnvironmentSetupOutcome,
} from "./setup-outcomes.js";

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
    id: string;
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
  const existing = deps.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.id, args.id))
    .get();
  if (existing?.finishedAt != null) {
    if (existing.error !== null && args.kind === "setup")
      throw new Error(existing.error);
    return;
  }
  const operationId = existing?.operationId ?? randomUUID();
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
  const identity = { hostId: args.hostId, path: args.path, operationId };
  try {
    if (args.kind === "setup" && existing === undefined)
      await beginEnvironmentSetupOutcome(deps, identity);
    args.signal.throwIfAborted();
    await callHostOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: HOOK_TIMEOUT_MS + TRANSPORT_GRACE_MS,
      command: {
        type: "environment.hook.run",
        contributedEnv: await resolveHostEnvironment(deps, {
          hostId: args.hostId,
          projectId: null,
        }),
        resumeOnly: existing !== undefined,
        operationId,
        path: args.path,
        kind: args.kind,
        timeoutMs: HOOK_TIMEOUT_MS,
      },
    });
    deps.db
      .update(environmentHookOperations)
      .set({ finishedAt: Date.now() })
      .where(eq(environmentHookOperations.id, args.id))
      .run();
    args.signal.throwIfAborted();
    if (args.kind === "setup")
      await finishEnvironmentSetupOutcome(deps, {
        ...identity,
        succeeded: true,
      });
  } catch (error) {
    await cancelPendingEnvironmentHook(deps, args.id);
    if (args.kind === "setup") {
      await finishEnvironmentSetupOutcome(deps, {
        ...identity,
        succeeded: false,
      });
      throw error;
    }
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
  id: string,
): Promise<void> {
  const operation = deps.db
    .select()
    .from(environmentHookOperations)
    .where(eq(environmentHookOperations.id, id))
    .get();
  if (operation === undefined || operation.finishedAt !== null) return;
  const result = await callHostOnlineRpc(deps, {
    hostId: operation.hostId,
    timeoutMs: TRANSPORT_GRACE_MS,
    command: {
      type: "environment.hook.cancel",
      operationId: operation.operationId,
    },
  });
  deps.db
    .update(environmentHookOperations)
    .set({
      finishedAt: Date.now(),
      error:
        result.status === "never-started"
          ? "Environment hook never started"
          : "Environment hook cancelled",
    })
    .where(eq(environmentHookOperations.id, id))
    .run();
}
