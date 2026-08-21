import type { AppSettings, ProviderInfo } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";

interface ProvidersSettingsSectionProps {
  disabled: boolean;
  generalSettings: AppSettings;
  onGeneralSettingsChange: (next: AppSettings) => void;
}

/**
 * The generic provider directory: every registered provider in picker order.
 * Order and the default are user settings; each provider's own options
 * (memory, native subagents, …) live on its plugin's settings page, never
 * here — core knows no provider by name.
 */
export function ProvidersSettingsSection({
  disabled,
  generalSettings,
  onGeneralSettingsChange,
}: ProvidersSettingsSectionProps) {
  const providersQuery = useSystemProviders();
  // The server already applies `providerOrder`; the list arrives in the
  // order the picker shows.
  const providers: ProviderInfo[] = providersQuery.data ?? [];
  const ids = providers.map((provider) => provider.id);

  const move = (providerId: string, delta: -1 | 1): void => {
    const index = ids.indexOf(providerId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    next.splice(index, 1);
    next.splice(target, 0, providerId);
    onGeneralSettingsChange({ ...generalSettings, providerOrder: next });
  };

  return (
    <SettingsSection
      title="Providers"
      description="The agents bb can run a thread on, in picker order. Each provider's own options live on its plugin page under Plugins."
    >
      {providersQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading providers…</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agent provider is enabled. Enable a provider plugin under Plugins.
        </p>
      ) : (
        <SettingsRowList>
          {providers.map((provider, index) => {
            const ProviderIcon = getProviderIconInfo(
              provider.id,
              provider.logoUrl,
            )?.icon;
            const isDefault =
              generalSettings.defaultProviderId === provider.id ||
              (generalSettings.defaultProviderId === null && index === 0);
            return (
              <SettingsRow key={provider.id}>
                <span className="flex size-5 items-center justify-center">
                  {ProviderIcon ? (
                    <ProviderIcon
                      className={cn(
                        COARSE_POINTER_ICON_SIZE_CLASS,
                        getProviderIconColorClass(provider.id),
                      )}
                    />
                  ) : (
                    <Icon name="Zap" className="text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {provider.displayName}
                </span>
                {!provider.available ? (
                  <SettingsBadge>Unavailable</SettingsBadge>
                ) : null}
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
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${provider.displayName} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(provider.id, -1)}
                >
                  <Icon name="ChevronUp" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${provider.displayName} down`}
                  disabled={disabled || index === providers.length - 1}
                  onClick={() => move(provider.id, 1)}
                >
                  <Icon name="ChevronDown" />
                </Button>
              </SettingsRow>
            );
          })}
        </SettingsRowList>
      )}
    </SettingsSection>
  );
}
