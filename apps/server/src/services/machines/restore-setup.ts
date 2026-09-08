import { and, eq, isNotNull } from "drizzle-orm";
import {
  environmentHookOperations,
  environments,
  machineLifecycles,
} from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { runEnvironmentHook } from "../environments/environment-hooks.js";

const running = new WeakMap<object, Map<string, Promise<void>>>();

export function beginMachineRestoreSetup(
  deps: Pick<WorkSessionDeps, "db">,
  hostId: string,
  operationId: string,
): void {
  deps.db.transaction((tx) => {
    const checkouts = tx
      .select({ id: environments.id, path: environments.path })
      .from(environments)
      .where(
        and(
          eq(environments.hostId, hostId),
          eq(environments.providerOwnsPath, true),
          eq(environments.status, "ready"),
          isNotNull(environments.path),
        ),
      )
      .all()
      .flatMap((row) =>
        row.path === null ? [] : [{ id: row.id, path: row.path }],
      );
    tx.update(machineLifecycles)
      .set({ restoreOperationId: operationId, restoreCheckouts: checkouts })
      .where(eq(machineLifecycles.hostId, hostId))
      .run();
  });
}

export async function runMachineRestoreSetup(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  const restore = deps.db
    .select({
      operationId: machineLifecycles.restoreOperationId,
      checkouts: machineLifecycles.restoreCheckouts,
    })
    .from(machineLifecycles)
    .where(eq(machineLifecycles.hostId, hostId))
    .get();
  if (restore?.operationId == null) return;
  const operationId = restore.operationId;
  let pending = running.get(deps.db);
  if (pending === undefined) {
    pending = new Map();
    running.set(deps.db, pending);
  }
  const key = `${hostId}:${operationId}`;
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const operation = (async () => {
    if (restore.checkouts === null)
      beginMachineRestoreSetup(deps, hostId, operationId);
    const checkouts =
      restore.checkouts ??
      deps.db
        .select({ checkouts: machineLifecycles.restoreCheckouts })
        .from(machineLifecycles)
        .where(
          and(
            eq(machineLifecycles.hostId, hostId),
            eq(machineLifecycles.restoreOperationId, operationId),
          ),
        )
        .get()?.checkouts ??
      [];
    let settled = true;
    for (const checkout of checkouts) {
      const exists = deps.db
        .select({ id: environments.id })
        .from(environments)
        .where(
          and(
            eq(environments.id, checkout.id),
            eq(environments.hostId, hostId),
            eq(environments.path, checkout.path),
            eq(environments.status, "ready"),
          ),
        )
        .get();
      if (exists === undefined) continue;
      const identity = { hostId, environmentId: checkout.id };
      try {
        await runEnvironmentHook(deps, {
          id: `restore:${operationId}:${checkout.id}`,
          hostId,
          path: checkout.path,
          kind: "setup",
          resumeOnly: false,
          signal: AbortSignal.timeout(15 * 60_000),
          report: {
            step: (message) => deps.logger.info(identity, message),
            log: (message) => deps.logger.info(identity, message),
          },
        });
      } catch (error) {
        const hook = deps.db
          .select({ finishedAt: environmentHookOperations.finishedAt })
          .from(environmentHookOperations)
          .where(
            eq(
              environmentHookOperations.id,
              `restore:${operationId}:${checkout.id}`,
            ),
          )
          .get();
        if (hook?.finishedAt == null) settled = false;
        deps.logger.warn(
          { ...identity, error },
          "Restored checkout setup failed; readiness is blocked",
        );
      }
    }
    if (settled)
      deps.db
        .update(machineLifecycles)
        .set({ restoreOperationId: null, restoreCheckouts: null })
        .where(
          and(
            eq(machineLifecycles.hostId, hostId),
            eq(machineLifecycles.restoreOperationId, operationId),
          ),
        )
        .run();
  })();
  pending.set(key, operation);
  try {
    await operation;
  } finally {
    pending.delete(key);
  }
}
