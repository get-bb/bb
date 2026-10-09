import type {
  BbSdkAreas,
  ThreadForkArgs,
  ThreadMutationResult,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
  ThreadUpdateArgs,
} from "@bb/sdk";
import type { QueryClient } from "@tanstack/react-query";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk";
import {
  beginEnvironmentNameUpdateTransaction,
  completeEnvironmentNameUpdateTransaction,
  rollbackEnvironmentNameUpdateTransaction,
} from "@/hooks/cache-owners/environment-workspace-cache-owner";
import {
  applyThreadMetadataBatchResult,
  applyPinnedThreadOrderResult,
  beginArchiveEnvironmentThreadsTransaction,
  rollbackArchiveThreadsTransaction,
  settleArchiveThreadsTransaction,
  beginThreadMetadataBatchTransaction,
  beginUnarchiveThreadTransaction,
  rollbackThreadListMutationTransaction,
  settleThreadListMembershipMutation,
  invalidateThreadMetadataBatch,
  rollbackThreadMetadataBatchTransaction,
  applyThreadReadStateResult,
  beginThreadReadStateTransaction,
  rollbackThreadReadStateTransaction,
  settleThreadReadStateTransaction,
} from "@/hooks/cache-owners/thread-state-cache-owner";

import {
  applySidebarSectionCreateResult,
  beginSidebarGroupTransaction,
} from "@/hooks/cache-owners/sidebar-group-cache-owner";

interface PendingThreadMutation {
  args: ThreadUpdateArgs;
  operation: "update" | "pin" | "unpin";
  reject: (reason: unknown) => void;
  resolve: (thread: ThreadMutationResult) => void;
}

function hasThreadMetadataUpdate(args: ThreadUpdateArgs): boolean {
  return (
    args.title !== undefined ||
    args.sectionId !== undefined ||
    args.parentThreadId !== undefined
  );
}

function createOptimisticThreadMutationBatcher(
  sdk: BbSdkAreas,
  queryClient: QueryClient,
): Pick<BbSdkAreas["threads"], "update" | "pin" | "unpin"> {
  let pending: PendingThreadMutation[] = [];
  let scheduled = false;

  const flush = async () => {
    const batch = pending;
    pending = [];
    scheduled = false;
    let transaction;
    try {
      transaction = await beginThreadMetadataBatchTransaction({
        queryClient,
        updates: batch.map(({ args, operation }) => ({
          threadId: args.threadId,
          title: args.title,
          sectionId: args.sectionId,
          parentThreadId: args.parentThreadId,
          ...(operation === "pin"
            ? { pinnedAt: Date.now() }
            : operation === "unpin"
              ? { pinnedAt: null }
              : {}),
        })),
      });
    } catch (error) {
      for (const request of batch) request.reject(error);
      return;
    }

    const previousByThread = new Map<string, Promise<ThreadMutationResult>>();
    const results = await Promise.allSettled(
      batch.map(({ args, operation }) => {
        const request = (
          previousByThread.get(args.threadId) ?? Promise.resolve()
        ).then(() =>
          operation === "update"
            ? sdk.threads.update(args)
            : sdk.threads[operation]({ threadId: args.threadId }),
        );
        previousByThread.set(args.threadId, request);
        return request;
      }),
    );
    transaction.releasePendingPatches();
    const fulfilledThreads = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (fulfilledThreads.length === results.length) {
      applyThreadMetadataBatchResult({
        queryClient,
        threads: fulfilledThreads,
      });
    } else {
      rollbackThreadMetadataBatchTransaction({ queryClient, transaction });
      invalidateThreadMetadataBatch({
        queryClient,
        threadIds: batch.map(({ args }) => args.threadId),
      });
    }
    results.forEach((result, index) => {
      const request = batch[index];
      if (!request) return;
      if (result.status === "fulfilled") request.resolve(result.value);
      else request.reject(result.reason);
    });
  };

  const enqueue = (
    operation: PendingThreadMutation["operation"],
    args: ThreadUpdateArgs,
  ) =>
    new Promise<ThreadMutationResult>((resolve, reject) => {
      pending.push({ operation, args, reject, resolve });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => void flush());
    });
  return {
    update: (args) =>
      hasThreadMetadataUpdate(args)
        ? enqueue("update", args)
        : sdk.threads.update(args),
    pin: (args) => enqueue("pin", args),
    unpin: (args) => enqueue("unpin", args),
  };
}

async function withOptimisticReadState(
  queryClient: QueryClient,
  threadId: string,
  lastReadAt: number | null,
  request: () => ReturnType<BbSdkAreas["threads"]["markRead"]>,
): ReturnType<BbSdkAreas["threads"]["markRead"]> {
  const transaction = await beginThreadReadStateTransaction({
    lastReadAt,
    queryClient,
    threadId,
  });
  try {
    const thread = await request();
    applyThreadReadStateResult({ queryClient, thread });
    return thread;
  } catch (error) {
    rollbackThreadReadStateTransaction({ queryClient, threadId, transaction });
    throw error;
  } finally {
    settleThreadReadStateTransaction({ queryClient, transaction });
  }
}

function withPluginThreadAttribution<
  TArgs extends ThreadForkArgs | ThreadSpawnArgs,
>(args: TArgs, pluginId: string): TArgs {
  const attribution: Pick<ThreadSpawnArgs, "origin" | "originPluginId"> =
    args.pluginMetadata !== undefined
      ? { origin: "plugin", originPluginId: pluginId }
      : args.origin === undefined || args.origin === "plugin"
        ? { origin: "plugin", originPluginId: args.originPluginId ?? pluginId }
        : { origin: args.origin };
  return { ...args, ...attribution };
}

export function bindSdkToPlugin(
  sdk: BbSdkAreas,
  pluginId: string,
  queryClient: QueryClient,
): PluginBrowserBbSdk {
  const threadMutations = createOptimisticThreadMutationBatcher(
    sdk,
    queryClient,
  );
  return {
    ...sdk,
    environments: {
      ...sdk.environments,
      async archiveThreads(args) {
        const transaction = await beginArchiveEnvironmentThreadsTransaction({
          environmentId: args.environmentId,
          queryClient,
        });
        let response:
          | Awaited<ReturnType<typeof sdk.environments.archiveThreads>>
          | undefined;
        try {
          response = await sdk.environments.archiveThreads(args);
          return response;
        } catch (error) {
          rollbackArchiveThreadsTransaction({ queryClient, transaction });
          throw error;
        } finally {
          settleArchiveThreadsTransaction({
            queryClient,
            response,
            transaction,
          });
        }
      },
      async update(args) {
        const transaction =
          args.name === undefined
            ? undefined
            : await beginEnvironmentNameUpdateTransaction({
                environmentId: args.environmentId,
                name: args.name,
                queryClient,
              });
        try {
          const environment = await sdk.environments.update(args);
          completeEnvironmentNameUpdateTransaction({
            environment,
            queryClient,
            transaction,
          });
          return environment;
        } catch (error) {
          rollbackEnvironmentNameUpdateTransaction({
            queryClient,
            transaction,
          });
          throw error;
        }
      },
    },
    projects: {
      ...sdk.projects,
      async update(args) {
        const transaction =
          args.name === undefined
            ? undefined
            : await beginSidebarGroupTransaction({
                queryClient,
                mutation: {
                  kind: "project",
                  id: args.projectId,
                  name: args.name,
                },
              });
        try {
          return await sdk.projects.update(args);
        } catch (error) {
          transaction?.rollback();
          throw error;
        } finally {
          transaction?.settle();
        }
      },
      async delete(args) {
        const transaction = await beginSidebarGroupTransaction({
          queryClient,
          mutation: { kind: "project", id: args.projectId, name: null },
        });
        try {
          return await sdk.projects.delete(args);
        } catch (error) {
          transaction.rollback();
          throw error;
        } finally {
          transaction.settle();
        }
      },
    },
    hosts: {
      ...sdk.hosts,
      async update(args) {
        const transaction =
          args.name === undefined
            ? undefined
            : await beginSidebarGroupTransaction({
                queryClient,
                mutation: { kind: "host", id: args.hostId, name: args.name },
              });
        try {
          return await sdk.hosts.update(args);
        } catch (error) {
          transaction?.rollback();
          throw error;
        } finally {
          transaction?.settle();
        }
      },
    },
    threadSections: {
      ...sdk.threadSections,
      async create(args) {
        const section = await sdk.threadSections.create(args);
        applySidebarSectionCreateResult({ queryClient, section });
        return section;
      },
      async update(args) {
        const transaction = await beginSidebarGroupTransaction({
          queryClient,
          mutation: { kind: "section", id: args.id, name: args.name },
        });
        try {
          return await sdk.threadSections.update(args);
        } catch (error) {
          transaction.rollback();
          throw error;
        } finally {
          transaction.settle();
        }
      },
      async delete(args) {
        const transaction = await beginSidebarGroupTransaction({
          queryClient,
          mutation: { kind: "section", id: args.id, name: null },
        });
        try {
          return await sdk.threadSections.delete(args);
        } catch (error) {
          transaction.rollback();
          throw error;
        } finally {
          transaction.settle();
        }
      },
    },
    threads: {
      ...sdk.threads,
      ...threadMutations,
      markRead(args) {
        return withOptimisticReadState(
          queryClient,
          args.threadId,
          Date.now(),
          () => sdk.threads.markRead(args),
        );
      },
      markUnread(args) {
        return withOptimisticReadState(queryClient, args.threadId, null, () =>
          sdk.threads.markUnread(args),
        );
      },
      async reorderPinned(args) {
        const orderedRoots = await sdk.threads.reorderPinned(args);
        applyPinnedThreadOrderResult({ queryClient, orderedRoots });
        return orderedRoots;
      },
      async unarchive(args) {
        const transaction = await beginUnarchiveThreadTransaction({
          queryClient,
          threadId: args.threadId,
        });
        try {
          return await sdk.threads.unarchive(args);
        } catch (error) {
          rollbackThreadListMutationTransaction({
            queryClient,
            threadId: args.threadId,
            transaction,
          });
          throw error;
        } finally {
          settleThreadListMembershipMutation({
            queryClient,
            threadId: args.threadId,
          });
        }
      },
      getPluginMetadata(
        args: Omit<ThreadPluginMetadataArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.getPluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      updatePluginMetadata(
        args: Omit<ThreadPluginMetadataUpdateArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.updatePluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      fork(args: ThreadForkArgs) {
        return sdk.threads.fork(withPluginThreadAttribution(args, pluginId));
      },
      spawn(args: ThreadSpawnArgs) {
        return sdk.threads.spawn(withPluginThreadAttribution(args, pluginId));
      },
    },
  };
}

const boundSdkByQueryClient = new WeakMap<
  QueryClient,
  WeakMap<BbSdkAreas, Map<string, PluginBrowserBbSdk>>
>();

export function getPluginBoundSdk(
  sdk: BbSdkAreas,
  pluginId: string,
  queryClient: QueryClient,
): PluginBrowserBbSdk {
  let bySdk = boundSdkByQueryClient.get(queryClient);
  if (bySdk === undefined) {
    bySdk = new WeakMap();
    boundSdkByQueryClient.set(queryClient, bySdk);
  }
  let byPlugin = bySdk.get(sdk);
  if (byPlugin === undefined) {
    byPlugin = new Map();
    bySdk.set(sdk, byPlugin);
  }
  let bound = byPlugin.get(pluginId);
  if (bound === undefined) {
    bound = bindSdkToPlugin(sdk, pluginId, queryClient);
    byPlugin.set(pluginId, bound);
  }
  return bound;
}
