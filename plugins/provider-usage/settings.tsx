import { useEffect, useId, useRef, useState } from "react";
import {
  useRpc,
  experimental_ProviderIcon as ProviderIcon,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { cn } from "@bb/shared-ui/lib/utils";
import type { providerUsageRpcContract } from "./server.js";
import {
  selectUsageMachine,
  type UsageMachine,
  type UsageProvider,
  type ProviderUsage,
  type UsageWindow,
} from "./usage-schema.js";
import {
  SettingsSection,
  SettingsBadge,
  SettingsRowList,
} from "./settings-ui.js";

interface ProviderConfig {
  name: string;
  providerId: string;
  signInHint: string;
  expiredHint: string;
  provider: UsageProvider;
}

function barColorClass(usedPercent: number): string {
  if (usedPercent >= 95) {
    return "bg-destructive";
  }
  if (usedPercent >= 80) {
    return "bg-warning";
  }
  return "bg-primary";
}

function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) {
    return null;
  }
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) {
    return null;
  }
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Resetting now";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `Resets in ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    const minutes = diffMinutes % 60;
    return minutes > 0
      ? `Resets in ${diffHours} hr ${minutes} min`
      : `Resets in ${diffHours} hr`;
  }

  const withinWeek = diffMs < 7 * 24 * 60 * 60_000;
  const formatted = reset.toLocaleString(undefined, {
    weekday: withinWeek ? "short" : undefined,
    month: withinWeek ? undefined : "short",
    day: withinWeek ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${formatted}`;
}

function formatUsdCents(cents: number, alwaysShowCents: boolean): string {
  const hasFractionalDollar = cents % 100 !== 0;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: alwaysShowCents || hasFractionalDollar ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function usageWindowValue(window: UsageWindow): string {
  if (!window.cost) {
    return `${window.usedPercent}% used`;
  }
  return `${formatUsdCents(window.cost.usedUsdCents, true)} / ${formatUsdCents(window.cost.limitUsdCents, false)}`;
}

function UsageWindowRow({ window }: { window: UsageWindow }) {
  const reset = formatReset(window.resetsAt);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-foreground">{window.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {usageWindowValue(window)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            barColorClass(window.usedPercent),
          )}
          style={{
            width: `${Math.min(100, Math.max(window.usedPercent, 2))}%`,
          }}
        />
      </div>
      {reset ? <p className="text-xs text-muted-foreground">{reset}</p> : null}
    </div>
  );
}

interface ProviderUsageBlockProps {
  accountLabel?: string;
  config: ProviderConfig;
  usage: ProviderUsage | undefined;
  isLoading: boolean;
  isError: boolean;
}

interface UsageLocation {
  id: string;
  name: string;
  kind: "host" | "source";
  disabled: boolean;
}

function UsageLocationPicker({
  locations,
  selectedLocationId,
  onSelectLocation,
}: {
  locations: readonly UsageLocation[];
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string) => void;
}) {
  const selectedLocation =
    locations.find((location) => location.id === selectedLocationId) ??
    locations[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-48 gap-1.5"
          aria-label="Usage source"
        >
          <Icon
            name={selectedLocation?.kind === "source" ? "Layers" : "Laptop"}
            className="size-3.5 shrink-0"
          />
          <span className="min-w-0 truncate">
            {selectedLocation?.name ?? "Source"}
          </span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle="Usage source">
        {locations.map((location) => {
          const connected = !location.disabled;
          return (
            <DropdownMenuItem
              key={location.id}
              disabled={!connected}
              onSelect={() => onSelectLocation(location.id)}
              className="flex items-center gap-2"
            >
              <Icon
                name={location.kind === "source" ? "Layers" : "Laptop"}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{location.name}</span>
              {location.id === selectedLocation?.id ? (
                <Icon name="Check" className="size-3.5 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderUsageBlock({
  accountLabel,
  config,
  usage,
  isLoading,
  isError,
}: ProviderUsageBlockProps) {
  const planLabel = usage?.status === "ok" ? usage.planLabel : null;
  const accountEmail =
    accountLabel ?? (usage?.status === "ok" ? usage.accountEmail : null);
  const headingId = useId();
  const showsUsageWindows =
    !isError && usage?.status === "ok" && usage.windows.length > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3.5 border-t border-border py-3.5 first:border-t-0 first:pt-0 last:pb-0"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            <ProviderIcon
              providerKind="agent"
              provider={{ ...config.provider, id: config.providerId }}
              className="size-4"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id={headingId}
              className="text-sm font-semibold text-foreground"
            >
              {config.name}
            </h3>
            {accountEmail && accountEmail !== config.name ? (
              <p className="truncate text-xs text-muted-foreground">
                {accountEmail}
              </p>
            ) : null}
            {!showsUsageWindows ? (
              <div className={accountEmail ? "mt-1.5" : undefined}>
                <ProviderUsageBody
                  config={config}
                  usage={usage}
                  isLoading={isLoading}
                  isError={isError}
                />
              </div>
            ) : null}
          </div>
        </div>
        {planLabel ? <SettingsBadge>{planLabel}</SettingsBadge> : null}
      </div>
      {showsUsageWindows ? (
        <div className="pl-6">
          <ProviderUsageBody
            config={config}
            usage={usage}
            isLoading={isLoading}
            isError={isError}
          />
        </div>
      ) : null}
    </section>
  );
}

function UsageResourceGroup({
  config,
  resources,
  isLoading,
  isError,
}: {
  config: ProviderConfig;
  resources: UsageProvider[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      {resources.map((resource) => {
        const email =
          resource.usage?.status === "ok"
            ? (resource.usage.accountEmail ?? resource.accountLabel)
            : resource.accountLabel;
        const usage = resource.usage ?? undefined;
        return (
          <ProviderUsageBlock
            key={resource.id}
            accountLabel={email ?? undefined}
            config={config}
            usage={usage}
            isLoading={isLoading}
            isError={isError && usage === undefined}
          />
        );
      })}
    </div>
  );
}

function ProviderUsageBody({
  config,
  usage,
  isLoading,
  isError,
}: ProviderUsageBlockProps) {
  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t load usage right now. Try reloading usage.
      </p>
    );
  }
  if (!usage) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading usage…" : "Usage not provided."}
      </p>
    );
  }
  switch (usage.status) {
    case "ok":
      if (usage.windows.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">
            No usage limits reported for this plan.
          </p>
        );
      }
      return (
        <div className="space-y-3.5">
          {usage.windows.map((window) => (
            <UsageWindowRow key={window.label} window={window} />
          ))}
        </div>
      );
    case "not_installed":
      return (
        <p className="text-xs text-muted-foreground">
          Not installed on this machine.
        </p>
      );
    case "unauthenticated":
      return (
        <p className="text-xs text-muted-foreground">{config.signInHint}</p>
      );
    case "expired":
      return (
        <p className="text-xs text-muted-foreground">{config.expiredHint}</p>
      );
    case "error":
      return <p className="text-xs text-muted-foreground">{usage.message}</p>;
    default:
      return null;
  }
}

export function UsageSettings() {
  const rpc = useRpc<typeof providerUsageRpcContract>();
  const [machines, setMachines] = useState<UsageMachine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const forceGeneration = useRef(0);
  useEffect(() => {
    let disposed = false;
    let running = false;
    const force = refresh > forceGeneration.current;
    forceGeneration.current = refresh;
    async function load(force: boolean) {
      if (running) return;
      running = true;
      setLoading(true);
      setError(false);
      try {
        const inventory = await rpc.call("getUsage", {
          force: false,
          machineIds: null,
          providerId: null,
          maxAgeMs: 60_000,
        });
        if (disposed) return;
        setMachines(inventory.machines);
        const selected = selectUsageMachine(
          inventory.machines,
          selectedId,
          null,
        );
        if (selected && selected.status === "connected") {
          for (const providerId of new Set(
            selected.providers.map((provider) => provider.providerId),
          )) {
            const result = await rpc.call("getUsage", {
              force,
              machineIds: [selected.id],
              providerId,
              maxAgeMs: 60_000,
            });
            if (disposed) return;
            setMachines(result.machines);
          }
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        running = false;
        if (!disposed) setLoading(false);
      }
    }
    void load(force);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [rpc, selectedId, refresh]);
  const selected = selectUsageMachine(machines, selectedId, null);
  const groups = new Map<string, UsageProvider[]>();
  for (const provider of selected?.providers ?? []) {
    if (provider.usage?.status === "not_installed") continue;
    const group = groups.get(provider.providerId);
    if (group) group.push(provider);
    else groups.set(provider.providerId, [provider]);
  }
  const notice =
    selected?.status === "disconnected"
      ? `${selected.displayName} is offline. Usage will refresh when it reconnects.`
      : error || selected?.error
        ? [...groups.values()].some((accounts) =>
            accounts.some((account) => account.usage !== null),
          )
          ? "Couldn’t refresh usage. Showing the last available update. Try reloading usage."
          : "Couldn’t load usage. Try reloading usage."
        : null;
  return (
    <SettingsSection
      title="Usage limits"
      description="Your provider subscription usage."
      action={
        <div className="flex items-center gap-1">
          {machines.length > 1 ? (
            <UsageLocationPicker
              locations={machines.map((machine) => ({
                id: machine.id,
                name: machine.displayName,
                kind: machine.id.startsWith("source:") ? "source" : "host",
                disabled: machine.status !== "connected",
              }))}
              selectedLocationId={selected?.id ?? null}
              onSelectLocation={setSelectedId}
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
            aria-label={loading ? "Reloading usage data" : "Reload usage data"}
          >
            <Icon
              name="RotateCcw"
              className={cn("size-3.5", loading && "animate-spin")}
            />
          </Button>
        </div>
      }
    >
      {notice ? (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <SettingsRowList>
        {[...groups].map(([id, resources]) => {
          const provider = resources[0]!;
          return (
            <UsageResourceGroup
              key={id}
              config={{
                name: provider.displayName,
                providerId: id,
                signInHint: provider.signInHint,
                expiredHint: provider.expiredHint,
                provider,
              }}
              resources={resources}
              isLoading={loading}
              isError={error || Boolean(selected?.error)}
            />
          );
        })}
        {groups.size === 0 && !notice ? (
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Loading providers and usage…"
              : selected?.id.startsWith("source:")
                ? "No accounts report usage yet. Configure accounts in the source plugin’s settings, or choose a machine."
                : "No providers report usage limits on this machine."}
          </p>
        ) : null}
      </SettingsRowList>
    </SettingsSection>
  );
}
