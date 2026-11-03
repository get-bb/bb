import {
  markThreadReadMutationOptions,
  markThreadUnreadMutationOptions,
} from "@/hooks/mutations/thread-state-mutations";
import { createThreadMutationBatcher } from "@/hooks/mutations/thread-mutation-batcher";
import type {
  BbSdkAreas,
  ThreadForkArgs,
  PluginThreadMetadataListArgs,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
} from "@bb/sdk";
import type { QueryClient } from "@tanstack/react-query";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk";
import { invalidateEnvironmentActionQueries } from "@/hooks/cache-owners/environment-cache-effects";
import {
  beginEnvironmentNameUpdateTransaction,
  completeEnvironmentNameUpdateTransaction,
  rollbackEnvironmentNameUpdateTransaction,
} from "@/hooks/cache-owners/environment-workspace-cache-owner";
import {
  applyPinnedThreadOrderResult,
  beginArchiveEnvironmentThreadsTransaction,
  rollbackArchiveThreadsTransaction,
  settleArchiveThreadsTransaction,
  beginUnarchiveThreadTransaction,
  rollbackThreadListMutationTransaction,
  settleThreadListMembershipMutation,
  succeedThreadListMutationTransaction,
} from "@/hooks/cache-owners/thread-state-cache-owner";

import {
  applySidebarSectionCreateResult,
  beginSidebarGroupTransaction,
} from "@/hooks/cache-owners/sidebar-group-cache-owner";

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
  const threadMutations = createThreadMutationBatcher(sdk.threads, queryClient);
  return {
    ...sdk,
    environments: {
      ...sdk.environments,
      async commit(args) {
        const response = await sdk.environments.commit(args);
        invalidateEnvironmentActionQueries({
          environmentId: args.environmentId,
          queryClient,
        });
        return response;
      },
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
        return queryClient
          .getMutationCache()
          .build(
            queryClient,
            markThreadReadMutationOptions(queryClient, sdk.threads),
          )
          .execute(args);
      },
      markUnread(args) {
        return queryClient
          .getMutationCache()
          .build(
            queryClient,
            markThreadUnreadMutationOptions(queryClient, sdk.threads),
          )
          .execute(args);
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
          const result = await sdk.threads.unarchive(args);
          succeedThreadListMutationTransaction(transaction);
          return result;
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
      experimental_listPluginMetadata(
        args: Omit<PluginThreadMetadataListArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.experimental_listPluginMetadata({
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
