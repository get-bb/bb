import type { ServerAccessStatus } from "@bb/server-contract";
import { MANUAL_SERVER_ACCESS_PROVIDER_ID, type AppSettings } from "@bb/domain";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { COARSE_POINTER_INPUT_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { isNonImeKey } from "@bb/shared-ui/lib/ime-keyboard";
import { getSettingsTargetPath } from "@/components/settings/settings-sections";
import { cn } from "@bb/shared-ui/lib/utils";
import { reorderStoredOrder } from "@/lib/stored-order";
import {
  SortableSettingsRowList,
  useSortableSettingsRow,
} from "./sortable-settings-rows";

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
  reorderRoute: (activeId: string, overId: string) => void;
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
    reorderRoute: (activeId, overId) => {
      if (!settings) return;
      const next = reorderStoredOrder({
        order: routes.map((route) => route.provider.id),
        visibleIds: routes
          .filter((route) => route.enabled)
          .map((route) => route.provider.id),
        activeId,
        overId,
      });
      if (next === null) return;
      update.mutate({ serverAccessOrder: next });
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

export function MachineAccessSettings() {
  const machineAccess = useMachineAccess();
  return <MachineAccessSettingsContent machineAccess={machineAccess} />;
}

export function MachineAccessSettingsContent({
  machineAccess,
}: {
  machineAccess: MachineAccessState;
}) {
  const manualRoute = machineAccess.routes.find(
    (route) => route.provider.id === MANUAL_SERVER_ACCESS_PROVIDER_ID,
  );
  const manualOn = manualRoute !== undefined && isRouteOn(manualRoute);
  const [addingManual, setAddingManual] = useState(
    hasManualEdit(machineAccess),
  );
  const addable = machineAccess.routes.filter((route) => !isRouteOn(route));
  return (
    <SettingsSection
      title="How devices reach this server"
      description="Other machines and your phone connect to bb over these routes."
      action={
        machineAccess.access !== undefined && addable.length > 0 ? (
          <AddRouteMenu
            machineAccess={machineAccess}
            routes={addable}
            onAddManual={() => setAddingManual(true)}
          />
        ) : undefined
      }
    >
      {machineAccess.access === undefined ? (
        <MachineAccessLoading />
      ) : (
        <div className="space-y-3">
          <RoutesOn
            machineAccess={machineAccess}
            emptyMessage="Only this computer can reach bb right now. Add a route so other machines and your phone can connect."
          />
          {addingManual && !manualOn && (
            <div
              className="space-y-1 border-t border-border pt-3"
              aria-label="New manual address"
              role="group"
            >
              <div className="flex min-h-8 items-center justify-between gap-2">
                <p className="text-sm text-foreground">Manual</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddingManual(false)}
                >
                  Cancel
                </Button>
              </div>
              <ManualAddressInput machineAccess={machineAccess} />
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function AddRouteMenu({
  machineAccess,
  routes,
  onAddManual,
}: {
  machineAccess: MachineAccessState;
  routes: MachineAccessRoute[];
  onAddManual: () => void;
}) {
  const navigate = useNavigate();
  const add = ({ provider, enabled }: MachineAccessRoute) => {
    if (!enabled) machineAccess.setRouteEnabled(provider.id, true);
    if (provider.availability.status !== "setup-required") return;
    if (provider.id === MANUAL_SERVER_ACCESS_PROVIDER_ID) onAddManual();
    else if (provider.pluginId !== null)
      void navigate(getSettingsTargetPath({ pluginId: provider.pluginId }));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={machineAccess.disabled}>
          <Icon name="Plus" className="size-3.5" />
          Add a route
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {routes.map((route) => {
          const localNetwork = route.provider.routeKind === "local-network";
          return (
            <DropdownMenuItem
              key={route.provider.id}
              className="flex-col items-start gap-0.5"
              onSelect={() => add(route)}
            >
              <span className="text-sm text-foreground">
                {route.provider.displayName}
              </span>
              <span
                className={cn(
                  "text-xs",
                  localNetwork ? "text-warning-text" : "text-subtle-foreground",
                )}
              >
                {localNetwork
                  ? LOCAL_NETWORK_TRUST_WARNING
                  : route.provider.description}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  if (machineAccess.access === undefined) return <MachineAccessLoading />;
  const onRoutes = machineAccess.routes.filter(isRouteOn);
  const addable = machineAccess.routes.filter((route) => !isRouteOn(route));
  return (
    <div className="space-y-3">
      {onRoutes.length > 0 && (
        <RoutesOn
          machineAccess={machineAccess}
          emptyMessage={null}
          onNavigate={onNavigate}
        />
      )}
      {addable.length > 0 && (
        <div
          className={cn(onRoutes.length > 0 && "border-t border-border pt-3")}
        >
          <div role="list" aria-label="Routes to add">
            <SettingsRowList>
              {addable.map((route) => (
                <AddRouteRow
                  key={route.provider.id}
                  machineAccess={machineAccess}
                  route={route}
                  onNavigate={onNavigate}
                />
              ))}
            </SettingsRowList>
          </div>
        </div>
      )}
    </div>
  );
}

function MachineAccessLoading() {
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

function isRouteOn(route: MachineAccessRoute): boolean {
  return (
    route.enabled && route.provider.availability.status !== "setup-required"
  );
}

function hasManualEdit(machineAccess: MachineAccessState): boolean {
  return machineAccess.draft !== null || machineAccess.error !== null;
}

function RoutesOn({
  machineAccess,
  emptyMessage,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  emptyMessage: string | null;
  onNavigate?: (() => void) | undefined;
}) {
  const onRoutes = machineAccess.routes.filter(isRouteOn);
  const sortable = onRoutes.length > 1;
  if (onRoutes.length === 0)
    return emptyMessage === null ? null : (
      <p className="text-sm text-subtle-foreground">{emptyMessage}</p>
    );
  return (
    <div className="space-y-2">
      {sortable && (
        <p className="text-xs text-subtle-foreground">
          Devices try these from the top. Drag to reorder.
        </p>
      )}
      <div role="list" aria-label="Routes">
        <SortableSettingsRowList
          ids={onRoutes.map((route) => route.provider.id)}
          disabled={machineAccess.disabled || !sortable}
          onReorder={machineAccess.reorderRoute}
        >
          {onRoutes.map((route) => (
            <RouteRow
              key={route.provider.id}
              machineAccess={machineAccess}
              route={route}
              sortable={sortable}
              onNavigate={onNavigate}
            />
          ))}
        </SortableSettingsRowList>
      </div>
    </div>
  );
}

function RouteRow({
  machineAccess,
  route,
  sortable,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  route: MachineAccessRoute;
  sortable: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const { provider } = route;
  const { availability } = provider;
  const { disabled } = machineAccess;
  const manual = provider.id === MANUAL_SERVER_ACCESS_PROVIDER_ID;
  const broken = availability.status === "unavailable";
  const [editing, setEditing] = useState(
    manual && hasManualEdit(machineAccess),
  );
  const { setNodeRef, style, isDragging, handle } = useSortableSettingsRow({
    id: provider.id,
    disabled: disabled || !sortable,
    label: provider.displayName,
  });
  return (
    <SettingsRow
      ref={setNodeRef}
      style={style}
      role="listitem"
      aria-label={provider.displayName}
      className={cn(
        "items-start",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lift",
      )}
    >
      {sortable && handle}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-h-8 min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{provider.displayName}</p>
            <p
              className={cn(
                "truncate text-xs",
                broken ? "text-destructive-text" : "text-subtle-foreground",
              )}
            >
              {availability.status === "unavailable"
                ? availability.message
                : provider.urls.length > 0
                  ? provider.urls.join(", ")
                  : provider.description}
            </p>
          </div>
          {manual ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-expanded={editing}
              onClick={() => setEditing((open) => !open)}
            >
              Edit address
            </Button>
          ) : provider.pluginId !== null ? (
            <Link
              className={buttonVariants({
                variant: broken ? "outline" : "ghost",
                size: "sm",
              })}
              onClick={onNavigate}
              to={getSettingsTargetPath({ pluginId: provider.pluginId })}
            >
              {broken ? "Fix" : "Manage"}
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Turn off ${provider.displayName}`}
            onClick={() => machineAccess.setRouteEnabled(provider.id, false)}
          >
            Turn off
          </Button>
        </div>
        {provider.routeKind === "local-network" && !broken && (
          <p className="text-xs text-warning-text">
            {LOCAL_NETWORK_TRUST_WARNING}
          </p>
        )}
        {manual && editing && (
          <div className="pb-1">
            <ManualAddressInput machineAccess={machineAccess} />
          </div>
        )}
      </div>
    </SettingsRow>
  );
}

function AddRouteRow({
  machineAccess,
  route,
  onNavigate,
}: {
  machineAccess: MachineAccessState;
  route: MachineAccessRoute;
  onNavigate?: (() => void) | undefined;
}) {
  const { provider, enabled } = route;
  const { disabled } = machineAccess;
  const manual = provider.id === MANUAL_SERVER_ACCESS_PROVIDER_ID;
  const localNetwork = provider.routeKind === "local-network";
  const [editing, setEditing] = useState(
    manual && hasManualEdit(machineAccess),
  );
  const alreadyListening =
    localNetwork && machineAccess.access?.localNetwork.bindHost === "0.0.0.0";
  const action = !enabled ? (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-label={`Turn on ${provider.displayName}`}
      onClick={() => machineAccess.setRouteEnabled(provider.id, true)}
    >
      Turn on
    </Button>
  ) : manual ? (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      aria-expanded={editing}
      onClick={() => setEditing((open) => !open)}
    >
      Add address
    </Button>
  ) : provider.pluginId !== null ? (
    <Link
      className={buttonVariants({ variant: "outline", size: "sm" })}
      onClick={onNavigate}
      to={getSettingsTargetPath({ pluginId: provider.pluginId })}
    >
      Set up
    </Link>
  ) : null;
  return (
    <SettingsRow
      role="listitem"
      aria-label={provider.displayName}
      className="items-start"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-h-8 min-w-0 items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{provider.displayName}</p>
            <p
              className={cn(
                "text-xs",
                localNetwork ? "text-warning-text" : "text-subtle-foreground",
              )}
            >
              {localNetwork
                ? LOCAL_NETWORK_TRUST_WARNING
                : provider.description}
            </p>
            {alreadyListening && (
              <p className="text-xs text-subtle-foreground">
                This server already listens on every network, so devices here
                can reach it now.
              </p>
            )}
          </div>
          {action}
        </div>
        {manual && editing && (
          <div className="pb-1">
            <ManualAddressInput machineAccess={machineAccess} />
          </div>
        )}
      </div>
    </SettingsRow>
  );
}

export function MobileServerAccess({
  renderPluginSettings,
}: {
  renderPluginSettings: (pluginId: string) => ReactNode;
}) {
  const machineAccess = useMachineAccess();
  return (
    <MobileServerAccessContent
      machineAccess={machineAccess}
      renderPluginSettings={renderPluginSettings}
    />
  );
}

export function MobileServerAccessContent({
  machineAccess,
  renderPluginSettings,
}: {
  machineAccess: MachineAccessState;
  renderPluginSettings: (pluginId: string) => ReactNode;
}) {
  const title = "Connect your phone";
  const onRoutes = machineAccess.routes.filter((route) => route.enabled);
  const readyRoutes = onRoutes.filter(
    (route) => route.provider.availability.status === "available",
  );
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-subtle-foreground">
          Your phone reaches bb over the same routes as your machines.{" "}
          <Link
            className="underline underline-offset-2 hover:text-foreground"
            to={getSettingsTargetPath({ section: "machines" })}
          >
            Change routes
          </Link>
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-4 py-3">
          {machineAccess.access === undefined ? (
            <MachineAccessLoading />
          ) : readyRoutes.length === 0 ? (
            <p className="text-sm text-subtle-foreground">
              No route is ready yet. Set one up in{" "}
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                to={getSettingsTargetPath({ section: "machines" })}
              >
                Settings → Machines
              </Link>
              .
            </p>
          ) : (
            <ul aria-label="Ready routes" className="space-y-2">
              {readyRoutes.map(({ provider }) => (
                <li
                  key={provider.id}
                  aria-label={provider.displayName}
                  className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm"
                >
                  <span className="shrink-0 text-foreground">
                    {provider.displayName}
                  </span>
                  <span className="min-w-0 break-words text-xs text-subtle-foreground [overflow-wrap:anywhere]">
                    {provider.urls.length > 0
                      ? provider.urls.join(", ")
                      : provider.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {onRoutes.map(({ provider }) =>
            provider.pluginId === null ? null : (
              <Fragment key={provider.id}>
                {renderPluginSettings(provider.pluginId)}
              </Fragment>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function ManualAddressInput({
  machineAccess,
}: {
  machineAccess: MachineAccessState;
}) {
  const { access, disabled, draft, error, saving, value } = machineAccess;
  return (
    <div className="space-y-1.5 pt-1">
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
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive-text">
          {error}
        </p>
      ) : (
        <p className="text-xs text-subtle-foreground">
          Your devices must be able to reach this address; localhost won’t work.
        </p>
      )}
    </div>
  );
}
