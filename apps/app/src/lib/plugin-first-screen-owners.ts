import { z } from "zod";
import { createLastKnownCache } from "./last-known-cache";

export const DEFAULT_FIRST_SCREEN_PLUGIN_IDS: readonly string[] = [
  "thread-list",
  "navigation",
];

const firstScreenOwnersCache = createLastKnownCache({
  prefix: "bb.plugin-first-screen-owners",
  version: "1",
  schema: z.array(z.string().min(1)),
});

export function readFirstScreenOwners(): readonly string[] {
  return (
    firstScreenOwnersCache.read(firstScreenOwnersCache.key()) ??
    DEFAULT_FIRST_SCREEN_PLUGIN_IDS
  );
}

interface FirstScreenSlotOwners {
  experimentalSidebarNavigations: readonly { pluginId: string }[];
  threadLists: readonly { pluginId: string }[];
}

export function rememberFirstScreenOwners(
  snapshot: FirstScreenSlotOwners,
): void {
  const pluginIds = new Set(
    [...snapshot.threadLists, ...snapshot.experimentalSidebarNavigations].map(
      (slot) => slot.pluginId,
    ),
  );
  if (pluginIds.size === 0) return;
  firstScreenOwnersCache.write(firstScreenOwnersCache.key(), [...pluginIds]);
}
