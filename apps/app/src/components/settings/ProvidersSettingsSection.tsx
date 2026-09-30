import { useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  AppSettings,
  CompletedTurnDisplay,
  ProviderInfo,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import { useSetProviderEnabled } from "@/hooks/mutations/provider-mutations";
import {
  useSystemProviderCatalog,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import {
  SortableSettingsRowList,
  useSortableSettingsRow,
} from "./sortable-settings-rows";

interface ProvidersSettingsSectionProps {
  disabled: boolean;
  generalSettings: AppSettings;
  onGeneralSettingsChange: (next: AppSettings) => Promise<unknown> | void;
}

function applyProviderOrder(
  providers: readonly ProviderInfo[],
  ids: readonly string[] | null,
): readonly ProviderInfo[] {
  if (
    ids === null ||
    providers.length !== ids.length ||
    providers.some((provider) => !ids.includes(provider.id))
  ) {
    return providers;
  }
  const providersById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  return ids.flatMap((id) => {
    const provider = providersById.get(id);
    return provider === undefined ? [] : [provider];
  });
}

export function reorderProviderIds(
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] | null {
  const activeIndex = ids.indexOf(activeId);
  const overIndex = ids.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return null;
  }
  return arrayMove([...ids], activeIndex, overIndex);
}

function withProviderCompletedTurnDisplay(
  settings: AppSettings,
  provider: ProviderInfo,
  display: CompletedTurnDisplay,
): AppSettings {
  const overrides = Object.fromEntries(
    Object.entries(settings.providerCompletedTurnDisplay).filter(
      ([providerId]) => providerId !== provider.id,
    ),
  );
  return {
    ...settings,
    providerCompletedTurnDisplay:
      display === provider.completedTurnDisplay
        ? overrides
        : { ...overrides, [provider.id]: display },
  };
}

function ProviderRowIcon({
  provider,
}: {
  provider: Pick<ProviderInfo, "id" | "logoUrl"> &
    Partial<Pick<ProviderInfo, "icon" | "strings">>;
}) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <ProviderIcon
        providerKind="agent"
        provider={provider}
        className={COARSE_POINTER_ICON_SIZE_CLASS}
      />
    </span>
  );
}

function ProviderActionsMenu({
  provider,
  enabled,
  isDefault,
  disabled,
  onToggle,
  onMakeDefault,
}: {
  provider: Pick<ProviderInfo, "displayName">;
  enabled: boolean;
  isDefault: boolean;
  disabled: boolean;
  onToggle: () => void;
  onMakeDefault: (() => void) | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground"
          aria-label={`Actions for ${provider.displayName}`}
        >
          <Icon name="MoreHorizontal" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle={provider.displayName}>
        {enabled ? (
          <DropdownMenuCheckboxItem
            checked={isDefault}
            disabled={disabled || onMakeDefault === null}
            onCheckedChange={(checked) => {
              if (checked) onMakeDefault?.();
            }}
          >
            Default
          </DropdownMenuCheckboxItem>
        ) : null}
        <DropdownMenuItem
          disabled={disabled}
          onSelect={onToggle}
          variant={enabled ? "destructive" : "default"}
        >
          {enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SortableProviderRowProps {
  disabled: boolean;
  generalSettings: AppSettings;
  index: number;
  onGeneralSettingsChange: ProvidersSettingsSectionProps["onGeneralSettingsChange"];
  provider: ProviderInfo;
  onDisable: () => void;
}

function SortableProviderRow({
  disabled,
  generalSettings,
  index,
  onGeneralSettingsChange,
  provider,
  onDisable,
}: SortableProviderRowProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableSettingsRow({
    id: provider.id,
    disabled,
    label: provider.displayName,
  });
  const isDefault =
    generalSettings.defaultProviderId === provider.id ||
    (generalSettings.defaultProviderId === null && index === 0);

  return (
    <SettingsRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/provider-row",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lift",
      )}
    >
      {handle}
      <ProviderRowIcon provider={provider} />
      <span className="min-w-0 flex-1 truncate font-medium">
        {provider.displayName}
      </span>
      {!provider.available ? (
        <SettingsBadge>Unavailable</SettingsBadge>
      ) : isDefault ? (
        <SettingsBadge>Default</SettingsBadge>
      ) : null}
      <ProviderActionsMenu
        provider={provider}
        enabled
        isDefault={isDefault}
        disabled={disabled}
        onToggle={onDisable}
        onMakeDefault={
          provider.available
            ? () => {
                void onGeneralSettingsChange({
                  ...generalSettings,
                  defaultProviderId: provider.id,
                });
              }
            : null
        }
      />
    </SettingsRow>
  );
}

interface CompletedTurnDisplayRowProps {
  disabled: boolean;
  generalSettings: AppSettings;
  onGeneralSettingsChange: ProvidersSettingsSectionProps["onGeneralSettingsChange"];
  provider: ProviderInfo;
}

function CompletedTurnDisplayRow({
  disabled,
  generalSettings,
  onGeneralSettingsChange,
  provider,
}: CompletedTurnDisplayRowProps) {
  const display =
    generalSettings.providerCompletedTurnDisplay[provider.id] ??
    provider.completedTurnDisplay;
  return (
    <SettingsRow>
      <ProviderRowIcon provider={provider} />
      <span className="min-w-0 flex-1 truncate font-medium">
        {provider.displayName}
      </span>
      <Switch
        checked={display === "collapse"}
        disabled={disabled}
        aria-label={`Collapse finished ${provider.displayName} turns`}
        onCheckedChange={(checked) =>
          onGeneralSettingsChange(
            withProviderCompletedTurnDisplay(
              generalSettings,
              provider,
              checked ? "collapse" : "flat",
            ),
          )
        }
      />
    </SettingsRow>
  );
}

export function ProvidersSettingsSection({
  disabled,
  generalSettings,
  onGeneralSettingsChange,
}: ProvidersSettingsSectionProps) {
  const providersQuery = useSystemProviders();
  const catalogQuery = useSystemProviderCatalog();
  const setEnabled = useSetProviderEnabled();
  const catalog = catalogQuery.data ?? [];
  const disabledProviders = catalog.filter(
    (provider) => !provider.enabled || !provider.pluginEnabled,
  );
  const controlsDisabled = disabled || setEnabled.isPending;
  const serverProviders: ProviderInfo[] = providersQuery.data ?? [];
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const providers = applyProviderOrder(serverProviders, optimisticOrder);
  const ids = providers.map((provider) => provider.id);

  const handleReorder = (activeId: string, overId: string): void => {
    const next = reorderProviderIds(ids, activeId, overId);
    if (next === null) return;
    setOptimisticOrder(next);
    let write: Promise<unknown> | void;
    try {
      write = onGeneralSettingsChange({
        ...generalSettings,
        providerOrder: next,
      });
    } catch {
      setOptimisticOrder(null);
      return;
    }
    void Promise.resolve(write)
      .catch(() => undefined)
      .finally(() => setOptimisticOrder(null));
  };

  return (
    <>
      <SettingsSection
        title="Providers"
        description="Choose which agents you use in BB. Drag to reorder them in provider pickers."
      >
        {providersQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading providers…</p>
        ) : providers.length === 0 && disabledProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No providers available. Install a provider plugin in Settings →
            Plugins.
          </p>
        ) : (
          <SortableSettingsRowList
            ids={ids}
            disabled={disabled}
            onReorder={handleReorder}
          >
            {providers.map((provider, index) => (
              <SortableProviderRow
                key={provider.id}
                disabled={controlsDisabled}
                onDisable={() =>
                  setEnabled.mutate({ providerId: provider.id, enabled: false })
                }
                generalSettings={generalSettings}
                index={index}
                onGeneralSettingsChange={onGeneralSettingsChange}
                provider={provider}
              />
            ))}
            {disabledProviders.map((provider) => (
              <SettingsRow key={provider.id} className="text-muted-foreground">
                <span className="-ml-2 w-7 shrink-0" aria-hidden="true" />
                <span className="shrink-0 opacity-60 grayscale">
                  <ProviderRowIcon provider={provider.info ?? provider} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {provider.displayName}
                </span>
                <SettingsBadge>Disabled</SettingsBadge>
                <ProviderActionsMenu
                  provider={provider}
                  enabled={false}
                  isDefault={false}
                  disabled={controlsDisabled}
                  onToggle={() =>
                    setEnabled.mutate({
                      providerId: provider.id,
                      enabled: true,
                    })
                  }
                  onMakeDefault={null}
                />
              </SettingsRow>
            ))}
          </SortableSettingsRowList>
        )}
      </SettingsSection>
      <SettingsSection title="Configuration">
        <SettingsWithControl
          label="Allow fast service tier"
          description="Turn this off to use the default service tier for all new turns, including those from queued messages and automations."
        >
          <Switch
            checked={generalSettings.allowFastServiceTier}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              onGeneralSettingsChange({
                ...generalSettings,
                allowFastServiceTier: enabled,
              })
            }
            aria-label="Allow fast service tier"
          />
        </SettingsWithControl>
        {providers.length === 0 ? null : (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Collapse finished turns
              </h3>
              <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                When a turn finishes, fold its work into one Worked for row and
                keep the final answer visible. Turn off collapsing to keep every
                step of a finished turn visible.
              </p>
            </div>
            <SettingsRowList>
              {providers.map((provider) => (
                <CompletedTurnDisplayRow
                  key={provider.id}
                  disabled={disabled}
                  generalSettings={generalSettings}
                  onGeneralSettingsChange={onGeneralSettingsChange}
                  provider={provider}
                />
              ))}
            </SettingsRowList>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
