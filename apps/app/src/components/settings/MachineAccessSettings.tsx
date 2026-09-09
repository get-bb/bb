import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { COARSE_POINTER_INPUT_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function useMachineAccess() {
  const config = useSystemConfig();
  const update = useUpdateGeneralSettings();
  const settings = config.data?.generalSettings;
  const access = config.data?.serverAccess;
  const value = settings?.machineServerUrl ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = !settings || update.isPending;
  const savedProviderId = access?.defaultProviderId ?? "connect";
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (selectedProviderId === savedProviderId) setSelectedProviderId(null);
  }, [savedProviderId, selectedProviderId]);
  const selected = selectedProviderId ?? savedProviderId;
  return {
    access,
    disabled,
    draft,
    error,
    effective: access?.providers.find((provider) => provider.id === selected),
    saving: update.isPending,
    selected,
    value,
    editDraft: (next: string) => {
      setDraft(next);
      setError(null);
    },
    selectProvider: (providerId: string) => {
      if (!settings || providerId === selected) return;
      setSelectedProviderId(providerId);
      update.mutate(
        { ...settings, defaultMachineAccess: providerId },
        { onError: () => setSelectedProviderId(null) },
      );
    },
    commitUrl: async () => {
      if (!settings || draft === null) return;
      const url = draft.trim();
      if (url) {
        const parsed = parseUrl(url);
        if (
          parsed === null ||
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        ) {
          setError("Enter a valid HTTP or HTTPS URL without credentials");
          return;
        }
        if (isLocalOnlyUrl(url)) {
          setError(
            "Other machines cannot reach localhost. Use a domain or shared-network address.",
          );
          return;
        }
      }
      try {
        await update.mutateAsync({
          ...settings,
          machineServerUrl: url || null,
        });
      } catch (saveError) {
        setError(
          getMutationErrorMessage({
            error: saveError,
            fallbackMessage: "Couldn't save the address.",
          }),
        );
        return;
      }
      setDraft(null);
      setError(null);
    },
  };
}

type MachineAccess = ReturnType<typeof useMachineAccess>;

export function MachineAccessSettings() {
  const machineAccess = useMachineAccess();
  return (
    <SettingsSection
      title="Machine access"
      description="Choose how new machines connect to the server."
      action={<MachineAccessMethodPicker machineAccess={machineAccess} />}
      bodyClassName="space-y-3"
    >
      <MachineAccessDetails machineAccess={machineAccess} />
    </SettingsSection>
  );
}

export function MachineAccessControls({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const machineAccess = useMachineAccess();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-normal text-foreground">
          Connection method
        </span>
        <MachineAccessMethodPicker machineAccess={machineAccess} />
      </div>
      <MachineAccessDetails
        machineAccess={machineAccess}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function MachineAccessMethodPicker({
  machineAccess,
}: {
  machineAccess: MachineAccess;
}) {
  const { access, disabled, selected } = machineAccess;
  return (
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
      onChange={machineAccess.selectProvider}
    />
  );
}

function MachineAccessDetails({
  machineAccess,
  onNavigate,
}: {
  machineAccess: MachineAccess;
  onNavigate?: () => void;
}) {
  const { access, disabled, draft, effective, error, saving, selected, value } =
    machineAccess;
  const connected = effective?.availability.status === "available";
  return (
    <>
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
        <div className="@container">
          <div className="flex flex-col gap-4 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-3">
            <div className="min-w-0 space-y-1 @lg:flex-1">
              {(connected ||
                effective?.availability.status === "unavailable") && (
                <p className="flex items-center gap-2 text-xs font-medium">
                  {connected && (
                    <span
                      className="size-2 shrink-0 rounded-full bg-success"
                      aria-hidden="true"
                    />
                  )}
                  {connected ? "Connected" : "Unavailable"}
                </p>
              )}
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
                  "bb connect gives this server a private address your machines can reach."
                )}
              </p>
            </div>
            <Button
              variant={connected ? "outline" : "default"}
              size="sm"
              className="w-full @lg:w-auto"
              asChild
            >
              <Link
                onClick={onNavigate}
                to={getPluginConfigurationRoutePath({ pluginId: "connect" })}
              >
                {connected ? "Manage" : "Set up bb connect"}
                <Icon name="ArrowRight" />
              </Link>
            </Button>
          </div>
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
        <SettingsWithControl
          label="Server address"
          description={
            error === null ? (
              "Use your own domain or an address on a shared network. Every machine you add must be able to reach this address; localhost won’t work."
            ) : (
              <span role="alert" className="text-destructive-text">
                {error}
              </span>
            )
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
              onChange={(event) => machineAccess.editDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void machineAccess.commitUrl();
              }}
            />
            <Button
              variant="outline"
              className={COARSE_POINTER_INPUT_HEIGHT_CLASS}
              disabled={disabled || draft === null || draft.trim() === value}
              onClick={() => void machineAccess.commitUrl()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </SettingsWithControl>
      )}
    </>
  );
}
