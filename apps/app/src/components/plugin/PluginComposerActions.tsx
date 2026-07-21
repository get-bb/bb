import { useMemo } from "react";
import type {
  ComposerPlusMenuItem,
  ComposerView,
  PluginComposerScope,
} from "@bb/plugin-sdk";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@bb/shared-ui/dropdown-menu";
import { appToast } from "@/components/ui/app-toast";
import { useComposer, useComposerView } from "@/lib/plugin-sdk-hooks";
import {
  usePluginSlots,
  type PluginComposerCustomizationSlot,
} from "@/lib/plugin-slots";
import { PluginIcon } from "./PluginIcon";
import { PluginSlotMount } from "./PluginSlotMount";
import { composerScopeIdentity } from "./plugin-composer-host";

export interface PluginComposerPlusMenuContribution {
  pluginId: string;
  customizationId: string;
  generation: number;
  item: ComposerPlusMenuItem;
}

function matchesScope(
  customization: PluginComposerCustomizationSlot,
  scope: PluginComposerScope,
): boolean {
  return (
    customization.scopes === undefined ||
    customization.scopes.includes(scope.kind)
  );
}

export function usePluginComposerPlusMenuContributions(
  view: ComposerView,
): readonly PluginComposerPlusMenuContribution[] {
  const { composerCustomizations } = usePluginSlots();
  return useMemo(
    () =>
      composerCustomizations.flatMap((customization) =>
        matchesScope(customization, view.scope)
          ? (customization.plusMenu ?? []).map((item) => ({
              pluginId: customization.pluginId,
              customizationId: customization.id,
              generation: customization.generation,
              item,
            }))
          : [],
      ),
    [composerCustomizations, view.scope],
  );
}

export function PluginComposerActions({ view }: { view: ComposerView }) {
  const { composerCustomizations } = usePluginSlots();
  const scopeKey = composerScopeIdentity(view.scope);
  const actions = composerCustomizations.flatMap((customization) =>
    matchesScope(customization, view.scope)
      ? (customization.actions ?? []).map((action) => ({
          pluginId: customization.pluginId,
          customizationId: customization.id,
          generation: customization.generation,
          action,
        }))
      : [],
  );

  return actions.map(({ pluginId, customizationId, generation, action }) => (
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
  ));
}

export function PluginComposerPlusMenuEntry({
  contribution,
  showPluginLabel,
  onSelected,
}: {
  contribution: PluginComposerPlusMenuContribution;
  showPluginLabel: boolean;
  onSelected(): void;
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
  onSelected(): void;
}) {
  const composer = useComposer();
  const view = useComposerView();
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
          {pluginId}
        </DropdownMenuLabel>
      ) : null}
      <DropdownMenuItem
        disabled={disabled}
        aria-description={item.description}
        onSelect={() => {
          onSelected();
          void run();
        }}
      >
        <PluginIcon pluginId={pluginId} icon={item.icon ?? null} />
        {item.label}
      </DropdownMenuItem>
    </>
  );
}
