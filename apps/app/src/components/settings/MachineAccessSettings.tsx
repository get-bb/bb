import { useState } from "react";
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
  const selected = settings?.defaultMachineAccess;
  const effective = access?.providers.find(
    (provider) => provider.id === access.defaultProviderId,
  );
  return (
    <SettingsSection
      title="Machine access"
      description="Choose how other machines connect to the server."
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
          selected
            ? effective?.availability.status === "available"
              ? "New machines use this access provider."
              : (effective?.availability.message ??
                "This access provider is not installed.")
            : `Uses bb Cloud when paired, otherwise Direct URL. ${effective ? `Currently: ${effective.displayName}.` : "Pair bb Cloud or configure a direct server URL to get started."}`
        }
      >
        <OptionPicker
          label="Default machine access"
          value={selected ?? "automatic"}
          disabled={disabled}
          align="end"
          options={[
            {
              value: "automatic",
              label: "Automatic",
              description: "Use bb Cloud when paired, otherwise Direct URL.",
            },
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
                defaultMachineAccess:
                  providerId === "automatic" ? null : providerId,
              });
          }}
        />
      </SettingsWithControl>
      <div className="border-t border-border pt-5">
        <SettingsWithControl
          label="Server URL reachable by machines"
          description={
            error ??
            "Used only by Direct URL access. Enter an address where other machines can already reach the server, such as a LAN address or your own domain. This does not set up networking; bb Cloud supplies its own address."
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
    </SettingsSection>
  );
}
