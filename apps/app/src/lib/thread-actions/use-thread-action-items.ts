import { useCallback, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { JsonObject } from "@bb/domain";
import type {
  PluginRpcClient,
  PluginThreadAction,
  PluginThreadActionItem,
  PluginThreadActionSurface,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { invalidateCachedThreadPluginMetadata } from "@/hooks/cache-owners/thread-plugin-metadata-cache-owner";
import { createPluginRpcClient } from "@/lib/plugin-sdk-hooks";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { useThreadSectionMove } from "@/components/thread/ThreadSectionMoveProvider";
import { usePluginSlots, type PluginThreadActionSlot } from "@/lib/plugin-slots";
import {
  useResolveSidebarThread,
  useSidebarThreadActions,
} from "@/lib/plugin-sidebar-hooks";
import { useSidebarThreadSplit } from "@/lib/plugin-sidebar-split";
import {
  orderThreadActionItems,
  resolveCoreThreadActions,
  type CoreThreadActionContext,
} from "./core-thread-actions";
import { useThreadPluginMetadata } from "./thread-plugin-metadata-query";

function useCoreThreadActionContext(threadId: string): CoreThreadActionContext {
  const isCompactViewport = useIsCompactViewport();
  const canSplit = useSidebarThreadSplit(threadId).isAvailable;
  const sidebarActions = useSidebarThreadActions();
  const hostActions = useThreadActions();
  const resolveThread = useResolveSidebarThread();
  const sectionMove = useThreadSectionMove();
  const requireThread = useCallback(
    (id: string) => {
      const thread = resolveThread(id);
      if (thread === null) throw new Error(`Unknown thread: ${id}`);
      return thread;
    },
    [resolveThread],
  );
  return useMemo<CoreThreadActionContext>(
    () => ({
      isCompactViewport,
      canSplit,
      sidebarActions,
      requestRename: (id) => hostActions.requestRename(requireThread(id)),
      unarchive: (id) => hostActions.unarchiveThread(requireThread(id)),
      sectionMove,
    }),
    [
      canSplit,
      hostActions,
      isCompactViewport,
      requireThread,
      sectionMove,
      sidebarActions,
    ],
  );
}

function isWellFormed(action: PluginThreadAction): boolean {
  return (action.run === undefined) !== (action.choices === undefined);
}

function refreshMetadataAfter(
  action: PluginThreadAction,
  refresh: () => void,
): PluginThreadAction {
  const settle = async (work: () => void | Promise<void>) => {
    try {
      await work();
    } finally {
      refresh();
    }
  };
  const { run, choices } = action;
  return {
    ...action,
    ...(run === undefined ? {} : { run: () => settle(() => run()) }),
    ...(choices === undefined
      ? {}
      : {
          choices: {
            ...choices,
            select: (choiceId: string) =>
              settle(() => choices.select(choiceId)),
          },
        }),
  };
}

function resolvePluginThreadAction(
  slot: PluginThreadActionSlot,
  target: PluginThreadActionTarget,
  surface: PluginThreadActionSurface,
  metadata: ReadonlyMap<string, JsonObject | null>,
  rpc: PluginRpcClient,
  queryClient: QueryClient,
): PluginThreadActionItem[] {
  const label = `plugin ${slot.pluginId}: thread action "${slot.id}"`;
  try {
    const action = slot.resolve({
      thread: target,
      surface,
      metadata: metadata.get(slot.pluginId) ?? null,
      rpc,
    });
    if (action === null) return [];
    if (!isWellFormed(action)) {
      console.error(`${label} must set exactly one of "run" and "choices"`);
      return [];
    }
    return [
      {
        key: `${slot.pluginId}/${slot.id}`,
        pluginId: slot.pluginId,
        action: refreshMetadataAfter(action, () =>
          invalidateCachedThreadPluginMetadata(
            queryClient,
            slot.pluginId,
            target.id,
          ),
        ),
      },
    ];
  } catch (error) {
    console.error(`${label} failed to resolve`, error);
    return [];
  }
}

export function useThreadActionItems(
  target: PluginThreadActionTarget,
  surface: PluginThreadActionSurface,
): readonly PluginThreadActionItem[] {
  const slots = usePluginSlots().threadActions;
  const queryClient = useQueryClient();
  const context = useCoreThreadActionContext(target.id);
  const pluginIds = useMemo(
    () => [...new Set(slots.map((slot) => slot.pluginId))],
    [slots],
  );
  const rpcClients = useMemo(
    () =>
      new Map(pluginIds.map((pluginId) => [pluginId, createPluginRpcClient(pluginId)])),
    [pluginIds],
  );
  const metadata = useThreadPluginMetadata(pluginIds, target.id);
  return useMemo(
    () =>
      orderThreadActionItems([
        ...resolveCoreThreadActions(target, surface, context),
        ...slots.flatMap((slot) =>
          resolvePluginThreadAction(
            slot,
            target,
            surface,
            metadata,
            rpcClients.get(slot.pluginId) ?? createPluginRpcClient(slot.pluginId),
            queryClient,
          ),
        ),
      ]),
    [context, metadata, queryClient, rpcClients, slots, surface, target],
  );
}
