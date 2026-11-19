import {
  createEventId,
  environments,
  getAppSettings,
  getEnvironment,
  getPreparingEnvironment,
  getThread,
  listEnvironmentIdsOwingBranchRename,
} from "@bb/db";
import { threadScope } from "@bb/domain";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { perDbRegistry } from "../lib/per-db-registry.js";
import { errorMessage } from "../lib/error-log-fields.js";
import {
  getEnvironmentProvider,
  invokeEnvironmentProvider,
} from "../plugins/plugin-environment-provider-registry.js";
import { defineItemSweep, type ItemSweep } from "../system/item-sweep.js";
import { buildSuggestedBranchName } from "../threads/thread-create-helpers.js";
import {
  inspectEnvironmentBranch,
  refreshAttachedEnvironmentBranch,
} from "../threads/thread-environment-placement.js";
import type { ThreadProvisioningDeps } from "../threads/thread-provisioning-environment.js";
import { appendThreadEvent } from "../threads/thread-events.js";
import { toEnvironmentResponse } from "./environment-response.js";
import {
  environmentRemovalActive,
  waitForEnvironmentOperation,
} from "./environment-engine.js";
import { environmentResourceSchema } from "./environment-resource.js";

type Deps = ThreadProvisioningDeps;

export const BRANCH_RENAME_OPERATION = "branch_rename";

const pendingTitles = new WeakMap<object, Map<string, true>>();
const branchRenames = new WeakMap<object, Map<string, Promise<void>>>();

const renameResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("renamed"),
    resource: environmentResourceSchema.optional(),
  }),
  z.object({ status: z.literal("kept"), reason: z.string().min(1) }),
  z.object({ status: z.literal("failed"), message: z.string().min(1) }),
]);

export function markThreadTitlePending(deps: Deps, threadId: string): void {
  perDbRegistry(pendingTitles, deps.db).set(threadId, true);
}

export function isThreadTitlePending(
  deps: Pick<Deps, "db">,
  threadId: string,
): boolean {
  return perDbRegistry(pendingTitles, deps.db).has(threadId);
}

export function settleThreadTitle(deps: Deps, threadId: string): void {
  perDbRegistry(pendingTitles, deps.db).delete(threadId);
  const thread = getThread(deps.db, threadId);
  const environment =
    getPreparingEnvironment(deps.db, threadId) ??
    (thread?.environmentId
      ? getEnvironment(deps.db, thread.environmentId)
      : null);
  if (environment?.pendingBranchRename?.threadId !== threadId) return;
  void renameOwedEnvironmentBranch(deps, environment.id, {
    announce: true,
  }).catch((error) =>
    deps.logger.warn(
      { environmentId: environment.id, threadId, error: errorMessage(error) },
      "Branch rename will retry",
    ),
  );
}

export function awaitEnvironmentBranchRename(
  deps: Pick<Deps, "db">,
  environmentId: string,
): Promise<void> {
  return (
    perDbRegistry(branchRenames, deps.db)
      .get(environmentId)
      ?.catch(() => undefined) ?? Promise.resolve()
  );
}

export function renameOwedEnvironmentBranch(
  deps: Deps,
  environmentId: string,
  options: {
    announce: boolean;
    report?: PluginEnvironmentProviderProgress;
    signal?: AbortSignal;
  },
): Promise<void> {
  const map = perDbRegistry(branchRenames, deps.db);
  const existing = map.get(environmentId);
  if (existing !== undefined) return existing;
  if (environmentRemovalActive(deps, environmentId)) return Promise.resolve();
  const rename = runOwedBranchRename(deps, environmentId, options).finally(
    () => {
      if (map.get(environmentId) === rename) map.delete(environmentId);
    },
  );
  map.set(environmentId, rename);
  return rename;
}

function clearOwedBranchRename(deps: Deps, environmentId: string): void {
  deps.db
    .update(environments)
    .set({ pendingBranchRename: null, updatedAt: Date.now() })
    .where(eq(environments.id, environmentId))
    .run();
}

async function runOwedBranchRename(
  deps: Deps,
  environmentId: string,
  options: {
    announce: boolean;
    report?: PluginEnvironmentProviderProgress;
    signal?: AbortSignal;
  },
): Promise<void> {
  const row = getEnvironment(deps.db, environmentId);
  const owed = row?.pendingBranchRename ?? null;
  if (row === null || owed === null) return;
  if (row.status === "creating" && row.path === null) return;
  const path = row.path;
  if (
    path === null ||
    row.teardownStatus !== null ||
    row.status === "destroyed" ||
    row.status === "error"
  ) {
    clearOwedBranchRename(deps, environmentId);
    return;
  }
  const thread = getThread(deps.db, owed.threadId);
  if (thread === null || thread.deletedAt !== null) {
    clearOwedBranchRename(deps, environmentId);
    return;
  }
  const to = buildSuggestedBranchName({
    branchPrefix: getAppSettings(deps.db).managedBranchPrefix,
    title: thread.title ?? thread.titleFallback,
    threadId: thread.id,
  });
  const record =
    row.environmentProviderId === null
      ? undefined
      : getEnvironmentProvider(row.environmentProviderId);
  if (record === undefined)
    throw new Error(
      `Environment provider "${row.environmentProviderId}" is not registered`,
    );
  const renameBranch = record.provider.renameBranch;
  if (
    renameBranch === null ||
    record.pluginId !== row.environmentProviderPluginId
  ) {
    clearOwedBranchRename(deps, environmentId);
    return;
  }
  const signal = options.signal ?? new AbortController().signal;
  const from = await inspectEnvironmentBranch(deps, {
    hostId: row.hostId,
    path,
  });
  if (signal.aborted) return;
  if (from === null || from === to) {
    clearOwedBranchRename(deps, environmentId);
    return;
  }
  const invocation = await invokeEnvironmentProvider(
    record,
    `"${record.provider.id}" environment provider branch rename`,
    () =>
      renameBranch({
        environment: toEnvironmentResponse(deps.db, row),
        resource: row.resource,
        from,
        to,
        report: options.report ?? {
          step: () => undefined,
          log: (text) =>
            deps.logger.info(
              { environmentId, text },
              "Environment branch rename",
            ),
        },
        signal,
      }),
  );
  if (signal.aborted) return;
  if (!invocation.ok) throw new Error(invocation.error);
  if (invocation.value === null)
    throw new Error("The environment provider became unavailable.");
  const result = renameResultSchema.safeParse(invocation.value);
  if (!result.success || result.data.status !== "renamed") {
    clearOwedBranchRename(deps, environmentId);
    const fields = { environmentId, from, to };
    if (result.success && result.data.status === "kept")
      deps.logger.info(
        { ...fields, reason: result.data.reason },
        "Kept the environment's branch name",
      );
    else
      deps.logger.warn(
        {
          ...fields,
          error:
            result.success && result.data.status === "failed"
              ? result.data.message
              : "The environment provider returned an invalid branch rename result",
        },
        "Environment branch rename failed",
      );
    return;
  }
  const resource = result.data.resource;
  deps.db
    .update(environments)
    .set({
      pendingBranchRename: null,
      ...(resource === undefined ? {} : { resource }),
      updatedAt: Date.now(),
    })
    .where(eq(environments.id, environmentId))
    .run();
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
  if (options.announce)
    appendThreadEvent(deps, {
      threadId: thread.id,
      environmentId,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: BRANCH_RENAME_OPERATION,
        operationId: createEventId(),
        status: "completed",
        message: `Renamed branch ${from} to ${to}`,
        metadata: { from, to },
      },
    });
  if (row.status === "creating") return;
  const target = { environmentId, hostId: row.hostId, path };
  await refreshAttachedEnvironmentBranch(deps, target);
  void waitForEnvironmentOperation(deps, environmentId).then((waited) =>
    waited ? refreshAttachedEnvironmentBranch(deps, target) : undefined,
  );
}

export function environmentBranchRenameSweep(deps: Deps): ItemSweep {
  return defineItemSweep({
    name: "environment-branch-rename",
    concurrency: 1,
    list: () => listEnvironmentIdsOwingBranchRename(deps.db),
    key: (environmentId) => environmentId,
    process: async (environmentId) => {
      const owner = getEnvironment(deps.db, environmentId)?.pendingBranchRename;
      if (owner && isThreadTitlePending(deps, owner.threadId)) return;
      await renameOwedEnvironmentBranch(deps, environmentId, {
        announce: true,
      });
    },
  });
}
