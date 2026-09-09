import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { useEffect, useState } from "react";
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

export function MachineAccessSettings({
  onNavigate,
  presentation = "settings",
}: {
  onNavigate?: () => void;
  presentation?: "settings" | "dialog";
}) {
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
        if (isLocalOnlyUrl(url)) {
          setError(
            "Other machines cannot reach localhost. Use a domain or shared-network address.",
          );
          return;
        }
      }
      await update.mutateAsync({ ...settings, machineServerUrl: url || null });
      setDraft(null);
      setError(null);
    } catch {
      setError("Enter a valid HTTP or HTTPS URL without credentials");
    }
  };
  const savedProviderId = access?.defaultProviderId ?? "connect";
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (selectedProviderId === savedProviderId) setSelectedProviderId(null);
  }, [savedProviderId, selectedProviderId]);
  const selected = selectedProviderId ?? savedProviderId;
  const effective = access?.providers.find(
    (provider) => provider.id === selected,
  );
  return (
    <SettingsSection
      title={presentation === "dialog" ? "Connection method" : "Machine access"}
      description={
        presentation === "dialog"
          ? undefined
          : "Choose how new machines connect to the server."
      }
      action={
        <OptionPicker
          modal={false}
          label="Connection method"
          value={selected}
          disabled={disabled}
          showChevronWhenDisabled
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
            if (!settings || providerId === selected) return;
            setSelectedProviderId(providerId);
            update.mutate(
              { ...settings, defaultMachineAccess: providerId },
              { onError: () => setSelectedProviderId(null) },
            );
          }}
        />
      }
      bodyClassName={
        presentation === "dialog"
          ? "space-y-3 border-0 bg-transparent p-0"
          : "space-y-3"
      }
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
      {selected === "connect" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              {effective?.availability.status === "available" && (
                <span
                  className="size-2 shrink-0 rounded-full bg-success"
                  aria-hidden="true"
                />
              )}
              {effective?.availability.status === "available"
                ? "Connected"
                : effective?.availability.status === "unavailable"
                  ? "Unavailable"
                  : "Not connected"}
            </p>
            <p className="text-xs text-subtle-foreground">
              {effective?.availability.status === "available" ? (
                effective.availability.serverUrl ? (
                  <a
                    href={effective.availability.serverUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all underline decoration-border underline-offset-4 hover:text-foreground"
                  >
                    {effective.availability.serverUrl}
                  </a>
                ) : (
                  "Ready to add machines."
                )
              ) : effective?.availability.status === "unavailable" ? (
                effective.availability.message
              ) : (
                "bb connect gives the server a private address your machines can reach. Connect your getbb.app account to get started."
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link
              onClick={onNavigate}
              to={getPluginConfigurationRoutePath({ pluginId: "connect" })}
            >
              {effective?.availability.status === "available"
                ? "Manage"
                : "Set up bb connect"}
            </Link>
          </Button>
        </div>
      )}
      {selected !== "connect" && selected !== "direct" && (
        <p className="text-xs text-subtle-foreground">
          {effective?.availability.status === "available"
            ? "Ready to connect new machines."
            : (effective?.availability.message ??
              "This connection method is not installed.")}
        </p>
      )}
      {selected === "direct" && (
        <div className="space-y-3">
          <SettingsWithControl
            label="Server address"
            description={
              error ??
              "Use your own domain or an address on a shared network. Every machine you add must be able to reach this address; localhost won’t work."
            }
            controlPlacement="below"
          >
            <div className="flex max-w-xl flex-wrap items-center gap-2">
              <Input
                className="min-w-0 flex-1 basis-48"
                aria-label="Server address"
                aria-invalid={error !== null}
                value={draft ?? value}
                placeholder={access?.effectiveUrl ?? "https://bb.example.com"}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitUrl();
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || draft === null || draft.trim() === value}
                onClick={() => void commitUrl()}
              >
                {update.isPending ? "Saving…" : "Save address"}
              </Button>
            </div>
          </SettingsWithControl>
        </div>
      )}
    </SettingsSection>
  );
}
