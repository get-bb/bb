import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { Input } from "@bb/shared-ui/input";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";

export function MachineAccessSettings() {
  const config = useSystemConfig();
  const update = useUpdateGeneralSettings();
  const settings = config.data?.generalSettings;
  const access = config.data?.serverAccess;
  const value = settings?.machineServerUrl ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = !settings || update.isPending;
  const commitUrl = async () => {
    if (!settings || draft === null) return;
    try {
      const url = draft.trim();
      if (url) {
        const parsed = new URL(url);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw new Error("Enter an HTTP or HTTPS URL without credentials");
      }
      await update.mutateAsync({ ...settings, machineServerUrl: url || null });
      setDraft(null);
      setError(null);
    } catch {
      setError("Enter a valid HTTP or HTTPS URL without credentials");
    }
  };
  const selected = access?.defaultProviderId ?? "connect";
  const effective = access?.providers.find(
    (provider) => provider.id === selected,
  );
  return (
    <SettingsSection
      title="Machine access"
      description="Choose how new machines connect to the server."
      bodyClassName="space-y-5"
    >
      {access?.providers.map((provider) =>
        provider.attention ? (
          <p
            key={provider.id}
            role="status"
            className="rounded-md bg-muted/40 px-3 py-2 text-xs text-destructive-text"
          >
            {provider.displayName}: {provider.attention}
          </p>
        ) : null,
      )}
      <SettingsWithControl
        label="Default machine access"
        description={
          selected === "connect"
            ? "Connect machines without configuring a server URL."
            : selected === "direct"
              ? "Use your own server URL for new machine connections."
              : effective?.availability.status === "available"
                ? "New machines use this access provider."
                : (effective?.availability.message ??
                  "This access provider is not installed.")
        }
      >
        <OptionPicker
          label="Default machine access"
          value={selected}
          disabled={disabled}
          align="end"
          options={[
            ...(!access?.providers.some((provider) => provider.id === "connect")
              ? [
                  {
                    value: "connect",
                    label: "bb connect",
                    description: "Set up remote access.",
                  },
                ]
              : []),
            ...(access?.providers ?? []).map((provider) => ({
              value: provider.id,
              label: provider.displayName,
              description:
                provider.availability.status !== "available"
                  ? provider.availability.message
                  : provider.id === "direct"
                    ? "Use the server address configured below."
                    : "Use this provider for new machine connections.",
            })),
          ]}
          onChange={(providerId) => {
            if (settings)
              update.mutate({
                ...settings,
                defaultMachineAccess: providerId,
              });
          }}
        />
      </SettingsWithControl>
      {selected === "connect" &&
        effective?.availability.status !== "available" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <p className="text-sm text-muted-foreground">
              Set up bb connect before adding a machine.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link
                to={getPluginConfigurationRoutePath({ pluginId: "connect" })}
              >
                Set up bb connect
              </Link>
            </Button>
          </div>
        )}
      {selected === "direct" && (
        <div className="border-t border-border pt-5">
          <SettingsWithControl
            label="Server URL reachable by machines"
            description={
              error ??
              "Enter an HTTP or HTTPS address that new machines can reach, such as a LAN address or your own domain."
            }
            controlPlacement="below"
          >
            <Input
              className="max-w-lg"
              aria-label="Server URL reachable by machines"
              aria-invalid={error !== null}
              value={draft ?? value}
              placeholder={access?.effectiveUrl ?? "https://bb.example.com"}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commitUrl()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitUrl();
              }}
            />
          </SettingsWithControl>
        </div>
      )}
    </SettingsSection>
  );
}
