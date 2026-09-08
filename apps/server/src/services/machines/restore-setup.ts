import { and, eq } from "drizzle-orm";
import { environments, machineLifecycles } from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { runEnvironmentHook } from "../environments/environment-hooks.js";

const running = new WeakMap<object, Map<string, Promise<void>>>();

export async function runMachineRestoreSetup(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  const restore = deps.db
    .select({ operationId: machineLifecycles.restoreOperationId })
    .from(machineLifecycles)
    .where(eq(machineLifecycles.hostId, hostId))
    .get();
  if (restore?.operationId == null) return;
  let pending = running.get(deps.db);
  if (pending === undefined) {
    pending = new Map();
    running.set(deps.db, pending);
  }
  const key = `${hostId}:${restore.operationId}`;
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const operation = (async () => {
    const checkouts = deps.db
      .select({ id: environments.id, path: environments.path })
      .from(environments)
      .where(
        and(
          eq(environments.hostId, hostId),
          eq(environments.providerOwnsPath, true),
          eq(environments.status, "ready"),
        ),
      )
      .all();
    for (const checkout of checkouts) {
      if (checkout.path === null) continue;
      const identity = { hostId, environmentId: checkout.id };
      try {
        await runEnvironmentHook(deps, {
          id: `restore:${restore.operationId}:${checkout.id}`,
          hostId,
          path: checkout.path,
          kind: "setup",
          signal: AbortSignal.timeout(15 * 60_000),
          report: {
            step: (message) => deps.logger.info(identity, message),
            log: (message) => deps.logger.info(identity, message),
          },
        });
      } catch (error) {
        deps.logger.warn(
          { ...identity, error },
          "Restored checkout setup failed; readiness is blocked",
        );
      }
    }
  })();
  pending.set(key, operation);
  try {
    await operation;
  } finally {
    pending.delete(key);
  }
}
