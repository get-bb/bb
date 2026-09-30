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
  beginThreadMetadataBatchTransaction,
  invalidateThreadMetadataBatch,
  rollbackThreadMetadataBatchTransaction,
} from "@/hooks/cache-owners/thread-state-cache-owner";

interface PendingThreadUpdate {
  args: ThreadUpdateArgs;
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

function createOptimisticThreadUpdateBatcher(
  sdk: BbSdkAreas,
  queryClient: QueryClient,
): (args: ThreadUpdateArgs) => Promise<ThreadMutationResult> {
  let pending: PendingThreadUpdate[] = [];
  let scheduled = false;

  const flush = async () => {
    const batch = pending;
    pending = [];
    scheduled = false;
    let transaction;
    try {
      transaction = await beginThreadMetadataBatchTransaction({
        queryClient,
        updates: batch.map(({ args }) => ({
          threadId: args.threadId,
          title: args.title,
          sectionId: args.sectionId,
          parentThreadId: args.parentThreadId,
        })),
      });
    } catch (error) {
      for (const request of batch) request.reject(error);
      return;
    }

    const results = await Promise.allSettled(
      batch.map(({ args }) => sdk.threads.update(args)),
    );
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

  return (args) => {
    if (!hasThreadMetadataUpdate(args)) return sdk.threads.update(args);
    return new Promise<ThreadMutationResult>((resolve, reject) => {
      pending.push({ args, reject, resolve });
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => void flush());
    });
  };
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
  const updateThread = createOptimisticThreadUpdateBatcher(sdk, queryClient);
  return {
    ...sdk,
    environments: {
      ...sdk.environments,
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
    threads: {
      ...sdk.threads,
      update: updateThread,
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
