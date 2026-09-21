import type {
  BbSdkAreas,
  ThreadForkArgs,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
} from "@bb/sdk";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk";

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
): PluginBrowserBbSdk {
  return {
    ...sdk,
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

const boundSdkByPlugin = new WeakMap<
  BbSdkAreas,
  Map<string, PluginBrowserBbSdk>
>();

export function getPluginBoundSdk(
  sdk: BbSdkAreas,
  pluginId: string,
): PluginBrowserBbSdk {
  let byPlugin = boundSdkByPlugin.get(sdk);
  if (byPlugin === undefined) {
    byPlugin = new Map();
    boundSdkByPlugin.set(sdk, byPlugin);
  }
  let bound = byPlugin.get(pluginId);
  if (bound === undefined) {
    bound = bindSdkToPlugin(sdk, pluginId);
    byPlugin.set(pluginId, bound);
  }
  return bound;
}
