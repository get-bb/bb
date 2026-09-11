import type { ServerAccessStatus } from "@bb/server-contract";
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
import { machineServerAccessBlockedReason } from "@/components/machines/machine-server-access";

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export interface MachineAccessState {
  access: ServerAccessStatus | undefined;
  disabled: boolean;
  draft: string | null;
  error: string | null;
  effective: ServerAccessStatus["providers"][number] | undefined;
  configurationMessage: string | null;
  saving: boolean;
  selected: string;
  value: string;
  editDraft: (next: string) => void;
  selectProvider: (providerId: string) => void;
  commitUrl: () => Promise<void>;
}

function useMachineAccess(): MachineAccessState {
  const config = useSystemConfig();
  const update = useUpdateGeneralSettings();
  const settings = config.data?.generalSettings;
  const access = config.data?.serverAccess;
  const value = settings?.machineServerUrl ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = !settings || update.isPending;
  const savedProviderId = access?.defaultProviderId ?? "direct";
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
  return {
    access,
    disabled,
    draft,
    error,
    effective,
    configurationMessage: machineServerAccessBlockedReason(access, selected),
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

export function MachineAccessSettings() {
  const machineAccess = useMachineAccess();
  return <MachineAccessSettingsContent machineAccess={machineAccess} />;
}

export function MachineAccessSettingsContent({
  machineAccess,
}: {
  machineAccess: MachineAccessState;
}) {
  return (
    <SettingsSection
      title="Machine access"
      description="Choose how new machines connect to the bb server."
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
    <MachineAccessControlsContent
      machineAccess={machineAccess}
      onNavigate={onNavigate}
    />
  );
}

export function MachineAccessControlsContent({
  machineAccess,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  onNavigate?: () => void;
}) {
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
  machineAccess: MachineAccessState;
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
      options={(access?.providers ?? []).map((provider) => ({
        value: provider.id,
        label: provider.displayName,
        description: provider.description,
      }))}
      onChange={machineAccess.selectProvider}
    />
  );
}

function MachineAccessDetails({
  machineAccess,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  onNavigate?: () => void;
}) {
  const {
    access,
    configurationMessage,
    disabled,
    draft,
    effective,
    error,
    saving,
    selected,
    value,
  } = machineAccess;
  const ready = configurationMessage === null;
  return (
    <>
      {selected !== "direct" && effective !== undefined && (
        <div className="@container">
          <div className="flex flex-col gap-4 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-3">
            <div className="min-w-0 space-y-1 @lg:flex-1">
              <p className="flex items-center gap-2 text-xs font-medium">
                {ready ? (
                  <span
                    className="size-2 shrink-0 rounded-full bg-success"
                    aria-hidden="true"
                  />
                ) : null}
                {ready
                  ? "Ready"
                  : effective.availability?.status === "unavailable"
                    ? "Unavailable"
                    : "Needs configuration"}
              </p>
              <p className="text-xs text-subtle-foreground">
                {configurationMessage ??
                  (effective.availability?.status === "available"
                    ? effective.availability.serverUrl
                    : null) ??
                  "Ready to add machines."}
              </p>
            </div>
            {effective.pluginId !== null && (
              <Button
                variant={ready ? "outline" : "default"}
                size="sm"
                className="w-full @lg:w-auto"
                asChild
              >
                <Link
                  onClick={onNavigate}
                  to={getPluginConfigurationRoutePath({
                    pluginId: effective.pluginId,
                  })}
                >
                  {ready ? "Manage" : `Set up ${effective.displayName}`}
                  <Icon name="ArrowRight" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {selected !== "direct" && effective === undefined && (
        <p className="text-xs text-subtle-foreground">
          This connection method is not installed.
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
