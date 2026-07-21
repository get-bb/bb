import { useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import {
  usePluginSlots,
  type PluginComposerAccessorySlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import {
  recordPluginComposerAccessoryUse,
  usePluginComposerAccessoryUsage,
} from "@/lib/plugin-composer-accessory-usage";
import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginComposerHost } from "./plugin-composer-host";

export const PLUGIN_COMPOSER_INLINE_PLUGIN_LIMIT = 3;

interface PluginComposerAccessoryGroup {
  pluginId: string;
  accessories: readonly PluginComposerAccessorySlot[];
  registrationIndex: number;
}

/**
 * Plugin `composerAccessory` slot mounts (plugin design §5.2), rendered in
 * the prompt box footer's leading region alongside the surface-provided
 * footer content. When a host supplies an active composer scope (for example,
 * a root composer whose selected project is not represented in the URL), its
 * scope takes precedence over route-derived props. The route-derived fallback
 * lets hosts without a Router (isolated tests/stories) render the empty state.
 */
export function PluginComposerAccessories() {
  const { composerAccessories } = usePluginSlots();
  if (composerAccessories.length === 0) return null;
  return <PluginComposerAccessoryList accessories={composerAccessories} />;
}

function PluginComposerAccessoryList({
  accessories,
}: {
  accessories: readonly PluginComposerAccessorySlot[];
}) {
  const usageCounts = usePluginComposerAccessoryUsage();
  const orderedGroups = useMemo(
    () => orderAccessoryGroups(accessories, usageCounts),
    [accessories, usageCounts],
  );
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [openPluginOrder, setOpenPluginOrder] = useState<
    readonly string[] | null
  >(null);
  const presentedGroups = useMemo(
    () =>
      overflowOpen && openPluginOrder !== null
        ? preserveOpenPluginOrder(orderedGroups, openPluginOrder)
        : orderedGroups,
    [openPluginOrder, orderedGroups, overflowOpen],
  );
  const inlineGroups = presentedGroups.slice(
    0,
    PLUGIN_COMPOSER_INLINE_PLUGIN_LIMIT,
  );
  const overflowGroups = presentedGroups.slice(
    PLUGIN_COMPOSER_INLINE_PLUGIN_LIMIT,
  );
  const { projectId, threadId } = useRouteState();
  const composerHost = usePluginComposerHost();
  const scope = composerHost?.scope;
  const activeProjectId =
    scope?.kind === "new-thread" || scope?.kind === "side-chat"
      ? scope.projectId
      : (projectId ?? null);
  const activeThreadId =
    scope?.kind === "side-chat"
      ? (scope.childThreadId ?? scope.parentThreadId)
      : scope && scope.kind !== "new-thread"
        ? scope.threadId
        : (threadId ?? null);
  return (
    <>
      {inlineGroups.map((group) => (
        <PluginComposerAccessoryGroupMount
          key={group.pluginId}
          group={group}
          placement="inline"
          projectId={activeProjectId}
          threadId={activeThreadId}
        />
      ))}
      {overflowGroups.length > 0 ? (
        <Popover
          open={overflowOpen}
          onOpenChange={(open) => {
            setOverflowOpen(open);
            setOpenPluginOrder(
              open ? orderedGroups.map((group) => group.pluginId) : null,
            );
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="More plugin actions"
              className={cn(
                COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
                "shrink-0 data-[state=open]:bg-state-active data-[state=open]:text-foreground",
              )}
            >
              <Icon name="MoreHorizontal" className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            data-plugin-composer-accessory-overflow=""
            aria-label="More plugin actions"
            align="start"
            side="top"
            sideOffset={6}
            mobileTitle="More plugin actions"
            className="max-h-[min(24rem,calc(100dvh-4rem))] w-max max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-1.5"
          >
            <div className="flex flex-col gap-1">
              {overflowGroups.map((group) => (
                <PluginComposerAccessoryGroupMount
                  key={group.pluginId}
                  group={group}
                  placement="overflow"
                  projectId={activeProjectId}
                  threadId={activeThreadId}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

function PluginComposerAccessoryGroupMount({
  group,
  placement,
  projectId,
  threadId,
}: {
  group: PluginComposerAccessoryGroup;
  placement: "inline" | "overflow";
  projectId: string | null;
  threadId: string | null;
}) {
  return (
    <div
      data-plugin-composer-accessory-plugin={group.pluginId}
      data-plugin-composer-accessory-placement={placement}
      className={
        placement === "inline"
          ? "contents"
          : "flex min-w-0 flex-wrap items-center gap-1 rounded-sm px-1 py-0.5"
      }
      onClickCapture={() => recordPluginComposerAccessoryUse(group.pluginId)}
    >
      {group.accessories.map((accessory) => (
        <PluginSlotMount
          // Generation in the key: a P3.4 reload remounts the slot (fresh
          // error-boundary state) instead of reusing a latched crash.
          key={`${accessory.pluginId}/${accessory.id}/${accessory.generation}`}
          pluginId={accessory.pluginId}
          slotKind="composerAccessory"
          slotId={accessory.id}
        >
          <accessory.component projectId={projectId} threadId={threadId} />
        </PluginSlotMount>
      ))}
    </div>
  );
}

function orderAccessoryGroups(
  accessories: readonly PluginComposerAccessorySlot[],
  usageCounts: Readonly<Record<string, number>>,
): PluginComposerAccessoryGroup[] {
  const groupsByPluginId = new Map<string, PluginComposerAccessoryGroup>();
  accessories.forEach((accessory, registrationIndex) => {
    const existing = groupsByPluginId.get(accessory.pluginId);
    if (existing) {
      groupsByPluginId.set(accessory.pluginId, {
        ...existing,
        accessories: [...existing.accessories, accessory],
      });
      return;
    }
    groupsByPluginId.set(accessory.pluginId, {
      pluginId: accessory.pluginId,
      accessories: [accessory],
      registrationIndex,
    });
  });
  return [...groupsByPluginId.values()].sort(
    (left, right) =>
      (usageCounts[right.pluginId] ?? 0) - (usageCounts[left.pluginId] ?? 0) ||
      left.registrationIndex - right.registrationIndex,
  );
}

function preserveOpenPluginOrder(
  groups: readonly PluginComposerAccessoryGroup[],
  pluginOrder: readonly string[],
): PluginComposerAccessoryGroup[] {
  const orderByPluginId = new Map(
    pluginOrder.map((pluginId, index) => [pluginId, index]),
  );
  return [...groups].sort(
    (left, right) =>
      (orderByPluginId.get(left.pluginId) ?? Number.MAX_SAFE_INTEGER) -
        (orderByPluginId.get(right.pluginId) ?? Number.MAX_SAFE_INTEGER) ||
      left.registrationIndex - right.registrationIndex,
  );
}
