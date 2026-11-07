import { createRetiredEnvironmentMembers } from "@bb/sdk";
import type {
  BbSdk,
  PluginThreadMetadataListArgs,
  ThreadForkArgs,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
} from "@bb/sdk";
import type { PluginBbSdk } from "@get-bb/plugin-sdk";

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

export function wrapSdkForPlugin(sdk: BbSdk, pluginId: string): PluginBbSdk {
  return {
    ...sdk,
    environments: {
      ...sdk.environments,
      ...createRetiredEnvironmentMembers(sdk.plugins.callRpc),
    },
    threads: {
      ...sdk.threads,
      async getPluginMetadata(
        args: Omit<ThreadPluginMetadataArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.getPluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      async experimental_listPluginMetadata(
        args: Omit<PluginThreadMetadataListArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.experimental_listPluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      async updatePluginMetadata(
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
      send(args) {
        return sdk.threads.send({ ...args, originPluginId: pluginId });
      },
    },
  };
}
