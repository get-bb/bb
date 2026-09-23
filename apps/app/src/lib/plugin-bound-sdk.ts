import type {
  BbSdkAreas,
  ThreadForkArgs,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
} from "@bb/sdk";
import type { QueryClient } from "@tanstack/react-query";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk";
import {
  beginEnvironmentNameUpdateTransaction,
  completeEnvironmentNameUpdateTransaction,
  rollbackEnvironmentNameUpdateTransaction,
} from "@/hooks/cache-owners/environment-workspace-cache-owner";

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
