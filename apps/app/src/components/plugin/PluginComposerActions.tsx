import { useMemo, useState } from "react";
import type {
  ComposerCustomization,
  ComposerPlusMenuItem,
  ComposerView,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { appToast } from "@/components/ui/app-toast";
import {
  recordPluginComposerActionUse,
  usePluginComposerActionUsage,
} from "@/lib/plugin-composer-action-usage";
import { useComposer, useComposerView } from "@/lib/plugin-sdk-hooks";
import { usePluginSlots } from "@/lib/plugin-slots";
import { usePluginDisplayName } from "@/lib/plugin-logos";
import { PluginIcon } from "./PluginIcon";
import { PluginSlotMount } from "./PluginSlotMount";
import {
  composerScopeIdentity,
  useOptionalPluginComposerView,
} from "./plugin-composer-host";
import { composerCustomizationsForScope } from "./composer-customizations";

export const PLUGIN_COMPOSER_INLINE_PLUGIN_LIMIT = 3;

interface PluginComposerActionContribution {
  pluginId: string;
  customizationId: string;
  generation: number;
  action: NonNullable<ComposerCustomization["actions"]>[number];
}

interface PluginComposerActionGroup {
  pluginId: string;
  actions: readonly PluginComposerActionContribution[];
  registrationIndex: number;
}

export interface PluginComposerPlusMenuContribution {
  pluginId: string;
  customizationId: string;
  generation: number;
  item: ComposerPlusMenuItem;
}

export interface PluginComposerPlusMenuSelection {
  restoreComposerFocus(): void;
  selectedElement: Element | null;
}

export function usePluginComposerPlusMenuContributions(
  view: ComposerView,
): readonly PluginComposerPlusMenuContribution[] {
  const { composerCustomizations } = usePluginSlots();
  return useMemo(
    () =>
      composerCustomizationsForScope(
        composerCustomizations,
        view.scope.kind,
      ).flatMap((customization) =>
        (customization.plusMenu ?? []).map((item) => ({
          pluginId: customization.pluginId,
          customizationId: customization.id,
          generation: customization.generation,
          item,
        })),
      ),
    [composerCustomizations, view.scope.kind],
  );
}

export function PluginComposerActions({ view }: { view?: ComposerView }) {
  const providedView = useOptionalPluginComposerView();
  const { composerCustomizations } = usePluginSlots();
  const composerView = view ?? providedView;
  if (composerView === undefined) return null;
  const scopeKey = composerScopeIdentity(composerView.scope);
  const actions: PluginComposerActionContribution[] =
    composerCustomizationsForScope(
      composerCustomizations,
      composerView.scope.kind,
    ).flatMap((customization) =>
      (customization.actions ?? []).map((action) => ({
        pluginId: customization.pluginId,
        customizationId: customization.id,
        generation: customization.generation,
        action,
      })),
    );

  if (actions.length === 0) return null;
  return <PluginComposerActionList actions={actions} scopeKey={scopeKey} />;
}

function PluginComposerActionList({
  actions,
  scopeKey,
}: {
  actions: readonly PluginComposerActionContribution[];
  scopeKey: string;
}) {
  const usageCounts = usePluginComposerActionUsage();
  const orderedGroups = useMemo(
    () => orderActionGroups(actions, usageCounts),
    [actions, usageCounts],
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

  return (
    <>
      {inlineGroups.map((group) => (
        <PluginComposerActionGroupMount
          key={group.pluginId}
          group={group}
          placement="inline"
          scopeKey={scopeKey}
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
            data-plugin-composer-action-overflow=""
            aria-label="More plugin actions"
            align="end"
            side="top"
            sideOffset={6}
            mobileTitle="More plugin actions"
            className="max-h-[min(24rem,calc(100dvh-4rem))] w-max max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-1.5"
          >
            <div className="flex flex-col gap-1">
              {overflowGroups.map((group) => (
                <PluginComposerActionGroupMount
                  key={group.pluginId}
                  group={group}
                  placement="overflow"
                  scopeKey={scopeKey}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

function PluginComposerActionGroupMount({
  group,
  placement,
  scopeKey,
}: {
  group: PluginComposerActionGroup;
  placement: "inline" | "overflow";
  scopeKey: string;
}) {
  return (
    <div
      data-plugin-composer-action-plugin={group.pluginId}
      data-plugin-composer-action-placement={placement}
      className={
        placement === "inline"
          ? "contents"
          : "flex min-w-0 flex-wrap items-center gap-1 rounded-sm px-1 py-0.5"
      }
      onClickCapture={() => recordPluginComposerActionUse(group.pluginId)}
    >
      {group.actions.map(
        ({ pluginId, customizationId, generation, action }) => (
          <div
            key={`${pluginId}/${customizationId}/${action.id}/${generation}/${scopeKey}`}
            data-plugin-composer-action=""
            className="flex h-9 max-h-9 shrink-0 items-center overflow-hidden"
          >
            <PluginSlotMount
              pluginId={pluginId}
              slotKind="composerAction"
              slotId={`${customizationId}/${action.id}`}
              crashFallback={<></>}
            >
              <action.component />
            </PluginSlotMount>
          </div>
        ),
      )}
    </div>
  );
}

function orderActionGroups(
  actions: readonly PluginComposerActionContribution[],
  usageCounts: Readonly<Record<string, number>>,
): PluginComposerActionGroup[] {
  const groupsByPluginId = new Map<string, PluginComposerActionGroup>();
  actions.forEach((action, registrationIndex) => {
    const existing = groupsByPluginId.get(action.pluginId);
    if (existing) {
      groupsByPluginId.set(action.pluginId, {
        ...existing,
        actions: [...existing.actions, action],
      });
      return;
    }
    groupsByPluginId.set(action.pluginId, {
      pluginId: action.pluginId,
      actions: [action],
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
  groups: readonly PluginComposerActionGroup[],
  pluginOrder: readonly string[],
): PluginComposerActionGroup[] {
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

export function PluginComposerPlusMenuEntry({
  contribution,
  showPluginLabel,
  onSelected,
}: {
  contribution: PluginComposerPlusMenuContribution;
  showPluginLabel: boolean;
  onSelected(selection: PluginComposerPlusMenuSelection): void;
}) {
  const { pluginId, customizationId, generation, item } = contribution;
  return (
    <PluginSlotMount
      key={`${pluginId}/${customizationId}/${item.id}/${generation}`}
      pluginId={pluginId}
      slotKind="composerPlusMenuItem"
      slotId={`${customizationId}/${item.id}`}
      crashFallback={<></>}
    >
      <PluginComposerPlusMenuEntryContent
        pluginId={pluginId}
        item={item}
        showPluginLabel={showPluginLabel}
        onSelected={onSelected}
      />
    </PluginSlotMount>
  );
}

function PluginComposerPlusMenuEntryContent({
  pluginId,
  item,
  showPluginLabel,
  onSelected,
}: {
  pluginId: string;
  item: ComposerPlusMenuItem;
  showPluginLabel: boolean;
  onSelected(selection: PluginComposerPlusMenuSelection): void;
}) {
  const composer = useComposer();
  const view = useComposerView();
  const pluginDisplayName = usePluginDisplayName(pluginId);
  const disabled =
    typeof item.disabled === "function" ? item.disabled(view) : item.disabled;

  const run = async () => {
    try {
      await item.run({ composer, view });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[plugin:${pluginId}] composer plus-menu item "${item.id}" failed: ${message}`,
        error,
      );
      appToast.error(`Plugin action failed`, { description: message });
    }
  };

  return (
    <>
      {showPluginLabel ? (
        <DropdownMenuLabel className="text-muted-foreground">
          {pluginDisplayName}
        </DropdownMenuLabel>
      ) : null}
      <DropdownMenuItem
        disabled={disabled}
        aria-description={item.description}
        onSelect={() => {
          onSelected({
            restoreComposerFocus: () => composer.focus(),
            selectedElement: document.activeElement,
          });
          void run();
        }}
      >
        <PluginIcon pluginId={pluginId} icon={item.icon ?? null} />
        {item.label}
      </DropdownMenuItem>
    </>
  );
}
