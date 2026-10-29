import type { ThreadProviderCommand } from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { resolveBridgeLaunchForProviderId } from "../system/provider-bridge-launch.js";

export const PROVIDER_LIVE_COMMANDS_FRESH_MS = 60_000;
const PROVIDER_LIVE_COMMANDS_MAX_ENTRIES = 256;

type LiveCommands = readonly ThreadProviderCommand[];

interface CacheEntry {
  commands: LiveCommands;
  freshUntil: number;
}

interface ProviderLiveCommandsReadArgs {
  key: string;
  load: () => Promise<LiveCommands>;
  onChanged: () => void;
  onRefreshError: (error: unknown) => void;
}

export interface ProviderLiveCommandsCache {
  read(args: ProviderLiveCommandsReadArgs): Promise<LiveCommands>;
}

export function createProviderLiveCommandsCache(
  options: { now?: () => number } = {},
): ProviderLiveCommandsCache {
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<LiveCommands>>();

  function store(key: string, commands: LiveCommands): void {
    entries.delete(key);
    entries.set(key, {
      commands,
      freshUntil: now() + PROVIDER_LIVE_COMMANDS_FRESH_MS,
    });
    for (const oldest of entries.keys()) {
      if (entries.size <= PROVIDER_LIVE_COMMANDS_MAX_ENTRIES) break;
      entries.delete(oldest);
    }
  }

  function start(
    args: ProviderLiveCommandsReadArgs,
    onLoaded: (commands: LiveCommands) => void,
  ): Promise<LiveCommands> {
    const started = args
      .load()
      .then((commands) => {
        onLoaded(commands);
        return commands;
      })
      .finally(() => {
        if (pending.get(args.key) === started) pending.delete(args.key);
      });
    pending.set(args.key, started);
    return started;
  }

  function revalidate(
    args: ProviderLiveCommandsReadArgs,
    previous: CacheEntry,
  ): void {
    start(args, (commands) => {
      if (entries.get(args.key) !== previous) return;
      store(args.key, commands);
      if (JSON.stringify(commands) !== JSON.stringify(previous.commands)) {
        args.onChanged();
      }
    }).catch(args.onRefreshError);
  }

  return {
    async read(args) {
      const entry = entries.get(args.key);
      if (entry !== undefined) {
        if (entry.freshUntil <= now() && !pending.has(args.key)) {
          revalidate(args, entry);
        }
        return entry.commands;
      }
      return (
        pending.get(args.key) ??
        start(args, (commands) => store(args.key, commands))
      );
    },
  };
}

export async function listProviderLiveCommands(
  deps: AppDeps,
  args: { hostId: string; providerId: string; cwd: string | null },
): Promise<LiveCommands> {
  const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, args.providerId);
  if (bridgeLaunch === null) {
    return [];
  }
  const logFields = { hostId: args.hostId, providerId: args.providerId };
  try {
    return await deps.providerLiveCommands.read({
      key: JSON.stringify([args.hostId, args.providerId, args.cwd]),
      load: async () => {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: args.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "provider.list_commands",
            providerId: args.providerId,
            bridgeLaunch,
            cwd: args.cwd,
          },
        });
        return result.commands;
      },
      onChanged: () =>
        deps.hub.notifyHost(args.hostId, ["provider-commands-changed"]),
      onRefreshError: (error) =>
        deps.logger.warn(
          { err: error, ...logFields },
          "Unable to refresh the provider's live commands; keeping the previous list",
        ),
    });
  } catch (error) {
    deps.logger.warn(
      { err: error, ...logFields },
      "Unable to list the provider's live commands; offering scanned commands only",
    );
    return [];
  }
}
