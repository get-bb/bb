import { useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  AppSettings,
  CompletedTurnDisplay,
  ProviderInfo,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
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
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { ProviderIconMark } from "./ProviderIconMark";
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

function ProviderRowIcon({ provider }: { provider: ProviderInfo }) {
  const ProviderIcon = getProviderIconInfo(
    "agent",
    provider.id,
    provider,
  )?.icon;
  return (
    <span className="flex size-5 items-center justify-center">
      {ProviderIcon ? (
        <ProviderIconMark
          provider={provider}
          icon={ProviderIcon}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      ) : (
        <Icon name="Zap" className="text-muted-foreground" />
      )}
    </span>
  );
}

interface SortableProviderRowProps {
  disabled: boolean;
  generalSettings: AppSettings;
  index: number;
  onGeneralSettingsChange: ProvidersSettingsSectionProps["onGeneralSettingsChange"];
  provider: ProviderInfo;
}

function SortableProviderRow({
  disabled,
  generalSettings,
  index,
  onGeneralSettingsChange,
  provider,
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
      {!provider.available ? <SettingsBadge>Unavailable</SettingsBadge> : null}
      {isDefault ? (
        <SettingsBadge>Default</SettingsBadge>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !provider.available}
          onClick={() =>
            onGeneralSettingsChange({
              ...generalSettings,
              defaultProviderId: provider.id,
            })
          }
        >
          Make default
        </Button>
      )}
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
        description="Set the default agent and its order in provider pickers. Configure each provider on its plugin page under Plugins."
      >
        {providersQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent provider is enabled. Enable a provider plugin under
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
                disabled={disabled}
                generalSettings={generalSettings}
                index={index}
                onGeneralSettingsChange={onGeneralSettingsChange}
                provider={provider}
              />
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
                keep the final answer visible. Turn a provider off to keep every
                step of its finished turns visible.
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
