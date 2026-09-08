import { createHash } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { environmentSetupOutcomes, environmentHookOperations } from "@bb/db";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

type SetupIdentity = { hostId: string; path: string; operationId: string };

export function environmentSetupInputHash(
  facts: HostDaemonOnlineRpcResult<"workspace.readiness.inspect">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        "kind" in facts
          ? facts
          : {
              commit: facts.commit,
              files: facts.files,
              abi: facts.abi,
            },
      ),
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
  if (args.succeeded) await reconcileLegacyEnvironmentSetupOutcome(deps, args);
  const key = and(
    eq(environmentSetupOutcomes.hostId, args.hostId),
    eq(environmentSetupOutcomes.path, args.path),
    eq(environmentSetupOutcomes.operationId, args.operationId),
    eq(environmentSetupOutcomes.state, "running"),
  );
  if (
    deps.db.select().from(environmentSetupOutcomes).where(key).get() ===
    undefined
  )
    return;
  const facts = args.succeeded ? await inspect(deps, args) : null;
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

export async function reconcileLegacyEnvironmentSetupOutcome(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string },
): Promise<void> {
  const key = and(
    eq(environmentSetupOutcomes.hostId, args.hostId),
    eq(environmentSetupOutcomes.path, args.path),
  );
  if (deps.db.select().from(environmentSetupOutcomes).where(key).get()) return;
  const hookKey = and(
    eq(environmentHookOperations.hostId, args.hostId),
    eq(environmentHookOperations.path, args.path),
    eq(environmentHookOperations.kind, "setup"),
  );
  const hook = deps.db
    .select()
    .from(environmentHookOperations)
    .where(hookKey)
    .orderBy(desc(environmentHookOperations.startedAt))
    .limit(1)
    .get();
  if (!hook || hook.finishedAt === null || hook.error !== null) return;
  const identity = { ...args, operationId: hook.operationId };
  const facts = await inspect(deps, identity);
  if (facts === null || ("dirty" in facts && facts.dirty.length > 0)) return;
  const inputHash = environmentSetupInputHash(facts);
  const checked = await inspect(deps, identity);
  if (
    checked === null ||
    environmentSetupInputHash(checked) !== inputHash ||
    ("dirty" in checked && checked.dirty.length > 0)
  )
    return;
  deps.db.transaction((tx) => {
    const latest = tx
      .select()
      .from(environmentHookOperations)
      .where(hookKey)
      .orderBy(desc(environmentHookOperations.startedAt))
      .limit(1)
      .get();
    if (
      latest?.operationId !== hook.operationId ||
      latest.finishedAt === null ||
      latest.error !== null
    )
      return;
    tx.insert(environmentSetupOutcomes)
      .values({
        ...identity,
        state: "passed",
        inputHash,
        updatedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
  });
}
