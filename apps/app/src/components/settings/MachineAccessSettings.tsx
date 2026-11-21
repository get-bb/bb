import type { ServerAccessStatus } from "@bb/server-contract";
import { MANUAL_SERVER_ACCESS_PROVIDER_ID, type AppSettings } from "@bb/domain";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Switch } from "@bb/shared-ui/switch";
import { COARSE_POINTER_INPUT_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { isNonImeKey } from "@bb/shared-ui/lib/ime-keyboard";

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

type ServerAccessProvider = ServerAccessStatus["providers"][number];

export interface MachineAccessRoute {
  provider: ServerAccessProvider;
  enabled: boolean;
}

export interface MachineAccessState {
  access: ServerAccessStatus | undefined;
  routes: MachineAccessRoute[];
  disabled: boolean;
  draft: string | null;
  error: string | null;
  saving: boolean;
  value: string;
  editDraft: (next: string) => void;
  commitUrl: () => Promise<void>;
  setRouteEnabled: (providerId: string, enabled: boolean) => void;
  moveRoute: (providerId: string, offset: -1 | 1) => void;
}

const LOCAL_NETWORK_TRUST_WARNING =
  "Anyone on this network can use bb; only enable on a network you trust.";

function machineAccessRoutes(
  access: ServerAccessStatus | undefined,
  settings:
    | Pick<AppSettings, "serverAccessOrder" | "disabledServerAccessProviderIds">
    | undefined,
): MachineAccessRoute[] {
  const providers = access?.providers ?? [];
  if (settings === undefined)
    return providers.map((provider) => ({
      provider,
      enabled: provider.enabled,
    }));
  const order = settings.serverAccessOrder;
  const rank = (id: string) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return providers
    .map((provider) => ({
      provider,
      enabled: !settings.disabledServerAccessProviderIds.includes(provider.id),
    }))
    .sort((left, right) => rank(left.provider.id) - rank(right.provider.id));
}

function useMachineAccess(): MachineAccessState {
  const config = useSystemConfig();
  const update = useUpdateGeneralSettings();
  const settings = config.data?.generalSettings;
  const access = config.data?.serverAccess;
  const value = settings?.machineServerUrl ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routes = machineAccessRoutes(access, settings);
  return {
    access,
    routes,
    disabled: !settings,
    draft,
    error,
    saving: update.isPending,
    value,
    editDraft: (next: string) => {
      setDraft(next);
      setError(null);
    },
    setRouteEnabled: (providerId, enabled) => {
      if (!settings) return;
      const others = settings.disabledServerAccessProviderIds.filter(
        (id) => id !== providerId,
      );
      update.mutate({
        disabledServerAccessProviderIds: enabled
          ? others
          : [...others, providerId],
      });
    },
    moveRoute: (providerId, offset) => {
      if (!settings) return;
      const ids = routes.map((route) => route.provider.id);
      const from = ids.indexOf(providerId);
      const to = from + offset;
      if (from === -1 || to < 0 || to >= ids.length) return;
      ids.splice(from, 1);
      ids.splice(to, 0, providerId);
      update.mutate({ serverAccessOrder: ids });
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
      const machineServerUrl = url || null;
      try {
        await update.mutateAsync({ machineServerUrl });
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
  title = "How devices reach this server",
}: {
  children?: (pluginId: string) => ReactNode;
  title?: string;
}) {
  const machineAccess = useMachineAccess();
  return (
    <MachineAccessSettingsContent
      machineAccess={machineAccess}
      title={title}
      renderPluginSettings={children}
    />
  );
}

export function MachineAccessSettingsContent({
  machineAccess,
  renderPluginSettings,
  title = "How devices reach this server",
}: {
  machineAccess: MachineAccessState;
  renderPluginSettings?: ((pluginId: string) => ReactNode) | undefined;
  title?: string;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-subtle-foreground">
          Machines and devices can use every route that is on, preferring the
          ones higher in the list.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-4 py-3">
          <MachineAccessRouteList
            machineAccess={machineAccess}
            renderPluginSettings={renderPluginSettings}
          />
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
    <MachineAccessRouteList
      machineAccess={machineAccess}
      onNavigate={onNavigate}
    />
  );
}

function MachineAccessRouteList({
  machineAccess,
  onNavigate,
  renderPluginSettings,
}: {
  machineAccess: MachineAccessState;
  onNavigate?: (() => void) | undefined;
  renderPluginSettings?: ((pluginId: string) => ReactNode) | undefined;
}) {
  if (machineAccess.access === undefined) {
    return (
      <p
        role="status"
        className="flex h-8 items-center gap-2 text-xs text-subtle-foreground"
      >
        <Icon name="Spinner" className="size-3.5 animate-spin" />
        Loading connection settings…
      </p>
    );
  }
  const { routes } = machineAccess;
  return (
    <ol aria-label="Routes" className="divide-y divide-border">
      {routes.map((route, index) => (
        <li
          key={route.provider.id}
          aria-label={route.provider.displayName}
          className="space-y-3 py-3 first:pt-0 last:pb-0"
        >
          <MachineAccessRouteRow
            machineAccess={machineAccess}
            route={route}
            first={index === 0}
            last={index === routes.length - 1}
            onNavigate={onNavigate}
          />
          {route.provider.id === MANUAL_SERVER_ACCESS_PROVIDER_ID && (
            <ManualAddressInput machineAccess={machineAccess} />
          )}
          {route.enabled &&
            route.provider.pluginId !== null &&
            renderPluginSettings?.(route.provider.pluginId)}
        </li>
      ))}
    </ol>
  );
}

function MachineAccessRouteRow({
  machineAccess,
  route,
  first,
  last,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  route: MachineAccessRoute;
  first: boolean;
  last: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const { provider, enabled } = route;
  const { disabled } = machineAccess;
  const localNetwork = provider.routeKind === "local-network";
  const alreadyListening =
    localNetwork &&
    !enabled &&
    machineAccess.access?.localNetwork.bindHost === "0.0.0.0";
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm text-foreground">{provider.displayName}</p>
        {localNetwork ? (
          <p className="text-xs text-warning-text">
            {LOCAL_NETWORK_TRUST_WARNING}
          </p>
        ) : (
          <p className="text-xs text-subtle-foreground/75">
            {provider.description}
          </p>
        )}
        {alreadyListening && (
          <p className="text-xs text-subtle-foreground">
            This server was started listening on every network, so devices on
            this network can already reach it.
          </p>
        )}
        <MachineAccessRouteStatus route={route} onNavigate={onNavigate} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-subtle-foreground"
          aria-label={`Move ${provider.displayName} up`}
          disabled={disabled || first}
          onClick={() => machineAccess.moveRoute(provider.id, -1)}
        >
          <Icon name="ChevronUp" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-subtle-foreground"
          aria-label={`Move ${provider.displayName} down`}
          disabled={disabled || last}
          onClick={() => machineAccess.moveRoute(provider.id, 1)}
        >
          <Icon name="ChevronDown" />
        </Button>
        <Switch
          className="ml-2"
          checked={enabled}
          disabled={disabled}
          aria-label={`Use ${provider.displayName}`}
          onCheckedChange={(next) =>
            machineAccess.setRouteEnabled(provider.id, next)
          }
        />
      </div>
    </div>
  );
}

function MachineAccessRouteStatus({
  route,
  onNavigate,
}: {
  route: MachineAccessRoute;
  onNavigate?: (() => void) | undefined;
}) {
  const { provider, enabled } = route;
  const { availability } = provider;
  const ready = enabled && availability.status === "available";
  const label = !enabled
    ? "Off"
    : availability.status === "available"
      ? "Ready"
      : availability.status === "setup-required"
        ? "Needs setup"
        : "Unavailable";
  const detail = !enabled
    ? null
    : availability.status === "available"
      ? provider.urls.length > 0
        ? provider.urls.join(", ")
        : "Ready to connect devices."
      : availability.message;
  const setup = availability.status === "setup-required";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
      <p className="inline-flex shrink-0 items-center gap-1.5 font-medium">
        {ready ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-success"
            aria-hidden="true"
          />
        ) : null}
        {label}
      </p>
      {detail !== null && (
        <p className="min-w-0 break-words text-subtle-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      )}
      {provider.pluginId !== null && (
        <Link
          className="shrink-0 text-subtle-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={onNavigate}
          to={getPluginConfigurationRoutePath({ pluginId: provider.pluginId })}
        >
          {setup ? `Set up ${provider.displayName}` : "Manage"}
        </Link>
      )}
    </div>
  );
}

function ManualAddressInput({
  machineAccess,
}: {
  machineAccess: MachineAccessState;
}) {
  const { access, disabled, draft, error, saving, value } = machineAccess;
  return (
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
            if (isNonImeKey(event, "Enter")) void machineAccess.commitUrl();
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
  );
}
