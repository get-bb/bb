import type { BbPluginApi } from "@get-bb/plugin-sdk";

import {
  COMMUNITY_MARKETPLACE,
  type CommunityCatalogRecord,
  searchCommunityPlugins,
} from "./community-catalog";
import {
  type InstalledPluginRecord,
  hasAgentFacingInterface,
  searchInstalledPlugins,
} from "./installed-catalog";
import {
  MAX_ITEM_TITLE_BYTES,
  boundUntrustedText,
  buildCommunityPluginContext,
  buildInstalledPluginContext,
  decodeCommunityItemId,
  decodeInstalledItemId,
} from "./mention-context";

export const SDK_READ_TIMEOUT_MS = 1_500;

class SdkReadTimeoutError extends Error {
  constructor() {
    super("SDK read timed out");
    this.name = "SdkReadTimeoutError";
  }
}

async function boundedSdkRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SdkReadTimeoutError());
      }, SDK_READ_TIMEOUT_MS);

      Promise.resolve()
        .then(() => read(controller.signal))
        .then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function targetName(plugin: InstalledPluginRecord): string {
  return (
    boundUntrustedText(plugin.name ?? "", MAX_ITEM_TITLE_BYTES) ||
    boundUntrustedText(plugin.id, MAX_ITEM_TITLE_BYTES) ||
    "This plugin"
  );
}

function fallbackTarget(pluginId: string): string {
  return boundUntrustedText(pluginId, MAX_ITEM_TITLE_BYTES) || "This plugin";
}

function missingInstalledError(target: string): Error {
  return new Error(
    `${target} is no longer installed. Reinstall it in Plugins settings or remove @${target}, then retry.`,
  );
}

function unusableInstalledError(target: string): Error {
  return new Error(
    `${target} is not currently usable. Restore it in Plugins settings or remove @${target}, then retry.`,
  );
}

function noAgentCapabilityError(target: string): Error {
  return new Error(
    `${target} no longer exposes an agent capability. Reload or update it, or remove @${target}, then retry.`,
  );
}

function inventoryVerificationError(target: string): Error {
  return new Error(
    `${target} could not be verified right now. Retry, or remove @${target} to send without it.`,
  );
}

function communityMissingError(target: string): Error {
  return new Error(
    `${target} is no longer available in bb Community. Remove @${target} or choose a current result, then retry.`,
  );
}

function communityIncompatibleError(target: string): Error {
  return new Error(
    `${target} is no longer listed for this version of bb. Remove @${target} or choose a current result, then retry.`,
  );
}

function communityVerificationError(target: string): Error {
  return new Error(
    `${target} could not be verified in bb Community right now. Retry, or remove @${target} to send without it.`,
  );
}

function invalidInstalledReferenceError(): Error {
  return new Error(
    "This Installed plugin reference is invalid. Remove the mention and choose the plugin again.",
  );
}

function invalidCommunityReferenceError(): Error {
  return new Error(
    "This Community plugin reference is invalid. Remove the mention and choose the plugin again.",
  );
}

function findInstalledPlugin(
  plugins: readonly InstalledPluginRecord[],
  pluginId: string,
): InstalledPluginRecord | undefined {
  return plugins.find((plugin) => plugin.id === pluginId);
}

function resolveInstalledRecord(plugin: InstalledPluginRecord): {
  context: string;
} {
  const target = targetName(plugin);
  if (plugin.status !== "running") throw unusableInstalledError(target);
  if (!hasAgentFacingInterface(plugin)) throw noAgentCapabilityError(target);

  return {
    context: buildInstalledPluginContext({ name: target, pluginId: plugin.id }),
  };
}

function exactCommunityEntry(
  entries: readonly CommunityCatalogRecord[],
  identity: { pluginId: string; marketplace: string; entryId: string },
): CommunityCatalogRecord | undefined {
  return entries.find(
    (entry) =>
      entry.pluginId === identity.pluginId &&
      entry.marketplace === identity.marketplace &&
      entry.entryId === identity.entryId,
  );
}

export default async function plugin(bb: BbPluginApi) {
  bb.ui.registerMentionProvider({
    id: "installed",
    label: "Installed",
    async search({ query }) {
      try {
        const inventory = await boundedSdkRead((signal) =>
          bb.sdk.plugins.list({ signal }),
        );
        return searchInstalledPlugins(inventory.plugins, query, bb.pluginId);
      } catch {
        return [];
      }
    },
    async resolve(itemId) {
      let pluginId: string;
      try {
        pluginId = decodeInstalledItemId(itemId).pluginId;
      } catch {
        throw invalidInstalledReferenceError();
      }

      const fallback = fallbackTarget(pluginId);
      let inventory: Awaited<ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>>;
      try {
        inventory = await boundedSdkRead((signal) =>
          bb.sdk.plugins.list({ signal }),
        );
      } catch {
        throw inventoryVerificationError(fallback);
      }

      const installed = findInstalledPlugin(inventory.plugins, pluginId);
      if (installed === undefined) throw missingInstalledError(fallback);
      return resolveInstalledRecord(installed);
    },
  });

  bb.ui.registerMentionProvider({
    id: "community",
    label: "Community",
    async search({ query }) {
      try {
        const entries = await boundedSdkRead((signal) =>
          bb.sdk.plugins.catalog.search({ query, signal }),
        );
        return searchCommunityPlugins(entries, query);
      } catch {
        return [];
      }
    },
    async resolve(itemId) {
      let identity: ReturnType<typeof decodeCommunityItemId>;
      try {
        identity = decodeCommunityItemId(itemId);
        if (identity.marketplace !== COMMUNITY_MARKETPLACE) {
          throw invalidCommunityReferenceError();
        }
      } catch {
        throw invalidCommunityReferenceError();
      }

      const fallback = fallbackTarget(identity.pluginId);
      let inventory: Awaited<ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>>;
      try {
        inventory = await boundedSdkRead((signal) =>
          bb.sdk.plugins.list({ signal }),
        );
      } catch {
        throw inventoryVerificationError(fallback);
      }

      const installed = findInstalledPlugin(
        inventory.plugins,
        identity.pluginId,
      );
      if (installed !== undefined) return resolveInstalledRecord(installed);

      let entries: Awaited<
        ReturnType<BbPluginApi["sdk"]["plugins"]["catalog"]["search"]>
      >;
      try {
        entries = await boundedSdkRead((signal) =>
          bb.sdk.plugins.catalog.search({ query: identity.pluginId, signal }),
        );
      } catch {
        throw communityVerificationError(fallback);
      }

      const entry = exactCommunityEntry(entries, identity);
      if (entry === undefined) throw communityMissingError(fallback);

      const liveTarget = boundUntrustedText(
        entry.displayName,
        MAX_ITEM_TITLE_BYTES,
      );
      if (liveTarget.length === 0) throw communityMissingError(fallback);
      if (!entry.compatible) throw communityIncompatibleError(liveTarget);
      if (entry.installed) throw communityMissingError(liveTarget);

      return {
        context: buildCommunityPluginContext({
          name: liveTarget,
          pluginId: entry.pluginId,
          marketplace: entry.marketplace,
          entryId: entry.entryId,
        }),
      };
    },
  });
}
