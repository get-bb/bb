import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { environmentSetupOutcomes } from "@bb/db";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

type SetupIdentity = { hostId: string; path: string; operationId: string };

export function environmentSetupInputHash(
  facts: HostDaemonOnlineRpcResult<"workspace.readiness.inspect">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        commit: facts.commit,
        files: facts.files,
        abi: facts.abi,
      }),
    )
    .digest("hex");
}

async function inspect(deps: WorkSessionDeps, args: SetupIdentity) {
  try {
    return await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: 60_000,
      command: { type: "workspace.readiness.inspect", path: args.path },
    });
  } catch {
    return null;
  }
}

export async function beginEnvironmentSetupOutcome(
  deps: WorkSessionDeps,
  args: SetupIdentity,
): Promise<void> {
  const value = {
    ...args,
    state: "running" as const,
    inputHash: null,
    updatedAt: Date.now(),
  };
  deps.db
    .insert(environmentSetupOutcomes)
    .values(value)
    .onConflictDoUpdate({
      target: [environmentSetupOutcomes.hostId, environmentSetupOutcomes.path],
      set: value,
    })
    .run();
  const facts = await inspect(deps, args);
  deps.db
    .update(environmentSetupOutcomes)
    .set({
      inputHash: facts === null ? null : environmentSetupInputHash(facts),
    })
    .where(
      and(
        eq(environmentSetupOutcomes.hostId, args.hostId),
        eq(environmentSetupOutcomes.path, args.path),
        eq(environmentSetupOutcomes.operationId, args.operationId),
      ),
    )
    .run();
}

export async function finishEnvironmentSetupOutcome(
  deps: WorkSessionDeps,
  args: SetupIdentity & { succeeded: boolean },
): Promise<void> {
  const facts = args.succeeded ? await inspect(deps, args) : null;
  const key = and(
    eq(environmentSetupOutcomes.hostId, args.hostId),
    eq(environmentSetupOutcomes.path, args.path),
    eq(environmentSetupOutcomes.operationId, args.operationId),
  );
  const inputHash = facts === null ? null : environmentSetupInputHash(facts);
  deps.db.transaction((tx) => {
    const row = tx.select().from(environmentSetupOutcomes).where(key).get();
    if (!row) return;
    tx.update(environmentSetupOutcomes)
      .set({
        state:
          args.succeeded && inputHash !== null && inputHash === row.inputHash
            ? "passed"
            : "failed",
        updatedAt: Date.now(),
      })
      .where(key)
      .run();
  });
}
