import type { ServerAccessStatus } from "@bb/server-contract";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { useEffect, useState, type ReactNode } from "react";
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
import { SettingsWithControl } from "@/components/ui/settings-section";
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

export function MachineAccessSettings({
  children,
  title = "Machine access",
}: {
  children?: (pluginId: string | null) => ReactNode;
  title?: string;
}) {
  const machineAccess = useMachineAccess();
  return (
    <MachineAccessSettingsContent machineAccess={machineAccess} title={title}>
      {children?.(
        machineAccess.selected === "direct"
          ? null
          : (machineAccess.effective?.pluginId ?? null),
      )}
    </MachineAccessSettingsContent>
  );
}

export function MachineAccessSettingsContent({
  machineAccess,
  children,
  title = "Machine access",
}: {
  machineAccess: MachineAccessState;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-subtle-foreground">
          Choose how your devices reach this bb server.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-4 py-3">
          {machineAccess.access === undefined ? (
            <p
              role="status"
              className="flex h-8 items-center gap-2 text-xs text-subtle-foreground"
            >
              <Icon name="Spinner" className="size-3.5 animate-spin" />
              Loading connection settings…
            </p>
          ) : (
            <>
              {machineAccess.selected !== "direct" &&
              machineAccess.effective ? (
                <MachineAccessStatus
                  machineAccess={machineAccess}
                  methodPicker={
                    <MachineAccessMethodPicker
                      machineAccess={machineAccess}
                      align="start"
                    />
                  }
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex">
                    <MachineAccessMethodPicker
                      machineAccess={machineAccess}
                      align="start"
                    />
                  </div>
                  <MachineAccessDetails machineAccess={machineAccess} />
                </div>
              )}
              {children}
            </>
          )}
        </div>
      </div>
    </section>
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
  align = "end",
}: {
  machineAccess: MachineAccessState;
  align?: "start" | "end";
}) {
  const { access, disabled, selected } = machineAccess;
  return (
    <OptionPicker
      modal={false}
      label="Connection method"
      value={selected}
      displayOverride={
        access && !machineAccess.effective
          ? { label: "Unavailable method" }
          : undefined
      }
      disabled={disabled}
      showChevronWhenDisabled
      align={align}
      className={align === "start" ? "-ml-1" : undefined}
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
  const { access, disabled, draft, effective, error, saving, selected, value } =
    machineAccess;
  return (
    <>
      {selected !== "direct" && effective !== undefined && (
        <MachineAccessStatus
          machineAccess={machineAccess}
          onNavigate={onNavigate}
        />
      )}
      {selected !== "direct" && effective === undefined && (
        <p className="text-xs text-subtle-foreground">
          This connection method is not installed. Choose another method above.
        </p>
      )}
      {selected === "direct" && (
        <SettingsWithControl
          label="Server address"
          description="Use your own domain or an address on a shared network. Your devices must be able to reach this address; localhost won’t work."
          controlPlacement="below"
        >
          <div className="flex flex-wrap items-center gap-2">
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
          {error !== null && (
            <p role="alert" className="mt-2 text-xs text-destructive-text">
              {error}
            </p>
          )}
        </SettingsWithControl>
      )}
    </>
  );
}

function MachineAccessStatus({
  machineAccess,
  onNavigate,
  methodPicker,
}: {
  machineAccess: MachineAccessState;
  onNavigate?: () => void;
  methodPicker?: ReactNode;
}) {
  const { effective, configurationMessage } = machineAccess;
  if (!effective) return null;
  const ready = configurationMessage === null;
  const setup =
    effective.availability?.status === "setup-required" &&
    effective.pluginId !== null;
  return (
    <div className="space-y-0">
      <div
        className={
          setup
            ? "flex flex-col items-start gap-2"
            : "flex min-h-7 items-center justify-between gap-3"
        }
      >
        {methodPicker}
        {setup && (
          <p className="max-w-xl text-xs text-subtle-foreground">
            {effective.description} {configurationMessage}
          </p>
        )}
        {effective.pluginId !== null && (
          <Button
            variant={setup ? "default" : "link"}
            size="sm"
            className={
              setup
                ? "shrink-0"
                : "h-7 shrink-0 px-3 font-normal text-subtle-foreground/75 no-underline hover:text-subtle-foreground hover:no-underline"
            }
            asChild
          >
            <Link
              onClick={onNavigate}
              to={getPluginConfigurationRoutePath({
                pluginId: effective.pluginId,
              })}
            >
              {setup ? (
                <>
                  Set up {effective.displayName}
                  <Icon name="ArrowRight" />
                </>
              ) : (
                "Manage"
              )}
            </Link>
          </Button>
        )}
      </div>
      {!setup && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
          <p className="inline-flex shrink-0 items-center gap-1.5 font-medium">
            {ready ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-success"
                aria-hidden="true"
              />
            ) : null}
            {ready ? "Ready" : "Unavailable"}
          </p>
          <p className="min-w-0 break-words text-subtle-foreground [overflow-wrap:anywhere]">
            {configurationMessage ??
              (effective.availability?.status === "available"
                ? effective.availability.serverUrl
                : null) ??
              "Ready to connect devices."}
          </p>
        </div>
      )}
    </div>
  );
}
