import { useState } from "react";
import { Input } from "@bb/shared-ui/input";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
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
  const selected = settings?.defaultMachineAccess;
  const effective = access?.providers.find(
    (provider) => provider.id === access.defaultProviderId,
  );
  return (
    <SettingsSection title="Machine access">
      {access?.providers.map((provider) =>
        provider.attention ? (
          <p
            key={provider.id}
            role="status"
            className="text-sm text-destructive-text"
          >
            {provider.displayName}: {provider.attention}
          </p>
        ) : null,
      )}
      <SettingsWithControl
        label="Server URL reachable by machines"
        description={
          error ??
          (access?.effectiveUrl
            ? `${access.effectiveUrl} · ${access.urlSource === "setting" ? "Machines setting" : "BB_EXTERNAL_URL"}`
            : access?.defaultProviderId && access.defaultProviderId !== "direct"
              ? "Only used by Direct URL. The selected access provider supplies its own endpoint."
              : "Set the URL machines use with Direct URL access.")
        }
        controlPlacement="below"
      >
        <Input
          aria-label="Server URL reachable by machines"
          aria-invalid={error !== null}
          value={draft ?? value}
          placeholder="https://bb.example.com"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commitUrl()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitUrl();
          }}
        />
      </SettingsWithControl>
      <SettingsWithControl
        label="Default machine access"
        description={
          selected
            ? effective?.availability.status === "available"
              ? "New machines use this access provider."
              : (effective?.availability.message ??
                "This access provider is not installed.")
            : `Automatic: ${effective?.displayName ?? "configure an access provider"}`
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={disabled}>
              {selected ? (effective?.displayName ?? selected) : "Automatic"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                if (settings)
                  update.mutate({ ...settings, defaultMachineAccess: null });
              }}
            >
              Automatic
            </DropdownMenuItem>
            {access?.providers.map((provider) => (
              <DropdownMenuItem
                key={provider.id}
                onSelect={() => {
                  if (settings)
                    update.mutate({
                      ...settings,
                      defaultMachineAccess: provider.id,
                    });
                }}
              >
                {provider.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsWithControl>
      <SettingsWithControl
        label="Machine Git credentials"
        description={
          config.data?.machineGit.statusMessage ?? "Checking server gh login"
        }
      >
        <span>git: {config.data?.machineGit.status ?? "not configured"}</span>
      </SettingsWithControl>
    </SettingsSection>
  );
}
