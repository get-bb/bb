import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { Input } from "@bb/shared-ui/input";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import {
  SettingsBadge,
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
      bodyClassName="space-y-4"
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
      <SettingsWithControl label="Connection method">
        <OptionPicker
          label="Connection method"
          value={selected}
          disabled={disabled}
          align="end"
          options={[
            ...(!access?.providers.some((provider) => provider.id === "connect")
              ? [
                  {
                    value: "connect",
                    label: "bb connect",
                    description: "Use a private getbb.app address.",
                  },
                ]
              : []),
            ...(access?.providers ?? []).map((provider) => ({
              value: provider.id,
              label: provider.displayName,
              description:
                provider.id === "connect"
                  ? "Use a private getbb.app address."
                  : provider.id === "direct"
                    ? "Use your own domain or network address."
                    : provider.availability.status !== "available"
                      ? provider.availability.message
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
      {selected === "connect" && (
        <div className="space-y-3 rounded-md bg-muted/30 p-3">
          <p className="text-xs leading-relaxed text-subtle-foreground">
            bb connect gives this server a private getbb.app address that your
            other machines can reach.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <SettingsBadge>
                {effective?.availability.status === "available"
                  ? "Connected"
                  : effective?.availability.status === "unavailable"
                    ? "Unavailable"
                    : "Not connected"}
              </SettingsBadge>
              <p className="text-xs text-subtle-foreground">
                {effective?.availability.status === "available"
                  ? "Ready to add machines."
                  : effective?.availability.status === "unavailable"
                    ? effective.availability.message
                    : "Link this server to your getbb.app account to get started."}
              </p>
            </div>
            {effective?.availability.status !== "available" && (
              <Button variant="outline" size="sm" asChild>
                <Link
                  to={getPluginConfigurationRoutePath({ pluginId: "connect" })}
                >
                  Set up bb connect
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {selected !== "connect" &&
        selected !== "direct" &&
        effective?.availability.status !== "available" && (
          <p className="text-xs text-subtle-foreground">
            {effective?.availability.message ??
              "This connection method is not installed."}
          </p>
        )}
      {selected === "direct" && (
        <div className="space-y-3 rounded-md bg-muted/30 p-3">
          <SettingsWithControl
            label="Server address"
            description={
              error ??
              "Use your own domain or an address on a shared network. Every machine you add must be able to reach this address; localhost won’t work."
            }
            controlPlacement="below"
          >
            <Input
              className="max-w-lg"
              aria-label="Server address"
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
      <p className="text-xs text-subtle-foreground">
        Changing this affects new machines only. Existing machines keep their
        current connection.
      </p>
    </SettingsSection>
  );
}
