import { useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  FreshReading,
  Machine,
  MachineProvider,
  Overview,
  RunningThread,
  machineLoadBalancerRpcContract,
} from "./contract.js";
import { isStale, loadPerProcessor } from "./placement.js";

export const AUTO_REFRESH_INTERVAL_MS = 15_000;

type Inspection = {
  overview: Overview | null;
  pending: boolean;
  error: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function loadTone(perProcessor: number): "low" | "elevated" | "high" {
  return perProcessor < 0.7 ? "low" : perProcessor < 1 ? "elevated" : "high";
}

const TONE_CLASS = {
  low: "bg-success",
  elevated: "bg-warning",
  high: "bg-destructive",
} as const;

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LoadBar({ reading }: { reading: FreshReading }) {
  const perProcessor = loadPerProcessor(reading);
  const tone = loadTone(perProcessor);
  return (
    <Hint
      label={`1-minute load ${reading.oneMinuteLoad.toFixed(2)} across ${reading.availableParallelism} processors`}
    >
      <span
        className="flex items-center gap-2"
        role="meter"
        aria-label="Load per processor"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.min(perProcessor, 1)}
        aria-valuetext={`${perProcessor.toFixed(2)} per processor`}
        data-tone={tone}
      >
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${TONE_CLASS[tone]}`}
            style={{ width: `${Math.min(perProcessor, 1) * 100}%` }}
          />
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {perProcessor.toFixed(2)}/CPU
        </span>
      </span>
    </Hint>
  );
}

function ProviderStatus({ provider }: { provider: MachineProvider }) {
  if (provider.readiness.kind === "ready") {
    return (
      <span className="text-muted-foreground">
        {provider.displayName}{" "}
        <span className="text-success-foreground" aria-label="ready">
          ✓
        </span>
      </span>
    );
  }
  return (
    <Hint label={provider.readiness.reason}>
      <span className="text-destructive-text" tabIndex={0}>
        {provider.displayName} <span aria-hidden>✗</span>{" "}
        {provider.readiness.label}
      </span>
    </Hint>
  );
}

function ThreadRows({
  threads,
  now,
}: {
  threads: readonly RunningThread[];
  now: number;
}) {
  const navigate = useBbNavigate();
  return (
    <ul className="space-y-1">
      {threads.map((thread) => (
        <li key={thread.id} className="flex min-w-0 items-center gap-2 text-xs">
          <button
            type="button"
            className="min-w-0 truncate text-left text-foreground hover:text-muted-foreground"
            onClick={() => navigate.toThread(thread.id)}
          >
            {thread.title ?? thread.id}
          </button>
          <span className="shrink-0 rounded-sm bg-muted px-1.5 text-2xs text-muted-foreground">
            {thread.model === null
              ? thread.providerName
              : `${thread.providerName} · ${thread.model}`}
          </span>
          <span className="shrink-0 text-subtle-foreground">{thread.status}</span>
          <span className="ml-auto shrink-0 tabular-nums text-subtle-foreground">
            {formatAge(now - thread.runningSince)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RunningThreads({
  threads,
  now,
}: {
  threads: readonly RunningThread[];
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (threads.length === 0) {
    return <p className="text-xs text-subtle-foreground">No running threads</p>;
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {threads.length} running {threads.length === 1 ? "thread" : "threads"}
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          className="size-3"
          aria-hidden
        />
      </button>
      {expanded ? <ThreadRows threads={threads} now={now} /> : null}
    </div>
  );
}

function MachineRow({
  machine,
  isNextPick,
  now,
}: {
  machine: Machine;
  isNextPick: boolean;
  now: number;
}) {
  const { availability, capacity, load, providers } = machine;
  return (
    <li
      className="space-y-2 border-t border-border py-3"
      aria-label={machine.name}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-foreground">
          {machine.name}
        </span>
        {machine.isServer ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-2xs font-medium">
            server
          </Badge>
        ) : null}
        {isNextPick ? (
          <Badge variant="outline" className="border-success px-1.5 py-0 text-2xs font-medium text-success-foreground">
            Next pick
          </Badge>
        ) : null}
        {capacity.kind === "known" ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {capacity.capacity.availableParallelism} CPU ·{" "}
            {Math.round(capacity.capacity.totalMemoryBytes / 1024 ** 3)} GB
          </span>
        ) : null}
        {availability.kind === "available" && load.kind === "fresh" ? (
          <LoadBar reading={load} />
        ) : null}
      </div>
      {availability.kind === "unavailable" ? (
        <p className="text-xs text-destructive-text">{availability.reason}</p>
      ) : (
        <>
          {load.kind === "unavailable" ? (
            <p className="text-xs text-warning-text">
              Load unavailable: {load.reason}
            </p>
          ) : null}
          {providers.kind === "reported" ? (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {providers.providers.length === 0 ? (
                <span className="text-subtle-foreground">No providers</span>
              ) : (
                providers.providers.map((provider) => (
                  <ProviderStatus key={provider.providerId} provider={provider} />
                ))
              )}
            </p>
          ) : (
            <p className="text-xs text-warning-text">{providers.reason}</p>
          )}
        </>
      )}
      <RunningThreads threads={machine.runningThreads} now={now} />
    </li>
  );
}

function Freshness({
  inspection,
  now,
  autoRefresh,
  onAutoRefresh,
  onRefresh,
}: {
  inspection: Inspection;
  now: number;
  autoRefresh: boolean;
  onAutoRefresh: (next: boolean) => void;
  onRefresh: () => void;
}) {
  const { overview } = inspection;
  const stale = overview !== null && isStale(overview.inspectedAt, now);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span data-stale={stale}>
        {overview === null
          ? inspection.pending
            ? "Measuring machines…"
            : "Not observed yet"
          : `Observed ${formatAge(now - overview.inspectedAt)} ago`}
      </span>
      {stale ? (
        <Hint label="Placement only trusts load readings from the last 30 seconds.">
          <span className="text-warning-text" tabIndex={0}>
            Stale
          </span>
        </Hint>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label="Refresh"
        disabled={inspection.pending}
        onClick={onRefresh}
      >
        <Icon
          name={inspection.pending ? "Spinner" : "RotateCcw"}
          className={inspection.pending ? "animate-spin" : undefined}
          aria-hidden
        />
      </Button>
      <label className="flex items-center gap-2">
        <Switch
          checked={autoRefresh}
          onCheckedChange={onAutoRefresh}
          aria-label="Auto-refresh"
        />
        Auto-refresh
      </label>
      <Hint label="CPU is the machine's available parallelism and GB is total physical memory. Load per processor is the 1-minute OS scheduler load average divided by processors, not CPU percent.">
        <span className="ml-auto" tabIndex={0} aria-label="About these numbers">
          <Icon name="Info" className="size-4" aria-hidden />
        </span>
      </Hint>
    </div>
  );
}

function MachineLoadBalancerSettings() {
  const rpc = useRpc<typeof machineLoadBalancerRpcContract>();
  const [refreshes, setRefreshes] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [inspection, setInspection] = useState<Inspection>({
    overview: null,
    pending: true,
    error: null,
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(
      () => setRefreshes((count) => count + 1),
      AUTO_REFRESH_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    const cancelled = Promise.withResolvers<never>();
    const onAbort = () => cancelled.reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    setInspection((current) => ({ ...current, pending: true }));
    Promise.race([
      rpc.call("inspect", { kind: "all" }, { signal: controller.signal }),
      cancelled.promise,
    ]).then(
      (overview) => {
        controller.signal.removeEventListener("abort", onAbort);
        setNow(Date.now());
        setInspection({ overview, pending: false, error: null });
      },
      (error: unknown) => {
        controller.signal.removeEventListener("abort", onAbort);
        if (!controller.signal.aborted) {
          setInspection((current) => ({
            ...current,
            pending: false,
            error: errorMessage(error),
          }));
        }
      },
    );
    return () => {
      controller.abort();
      controller.signal.removeEventListener("abort", onAbort);
    };
  }, [rpc, refreshes]);

  const { overview } = inspection;
  return (
    <TooltipProvider>
      <div className="w-full space-y-3">
        <Freshness
          inspection={inspection}
          now={now}
          autoRefresh={autoRefresh}
          onAutoRefresh={setAutoRefresh}
          onRefresh={() => setRefreshes((count) => count + 1)}
        />
        {inspection.error === null ? null : (
          <p className="text-sm text-destructive-text">{inspection.error}</p>
        )}
        {overview === null ? null : (
          <>
            {overview.machines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No machines are connected.
              </p>
            ) : (
              <ul>
                {overview.machines.map((machine) => (
                  <MachineRow
                    key={machine.hostId}
                    machine={machine}
                    isNextPick={machine.hostId === overview.nextPickHostId}
                    now={now}
                  />
                ))}
              </ul>
            )}
            {overview.pendingThreads.length > 0 ? (
              <section className="space-y-2 border-t border-border pt-3" aria-label="Pending placement">
                <h4 className="text-xs font-medium text-foreground">
                  Pending placement
                </h4>
                <ThreadRows threads={overview.pendingThreads} now={now} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "machines",
    title: "Machines",
    description:
      "New threads without a chosen machine go to the least-loaded ready machine. Machines are ranked by load per processor.",
    component: MachineLoadBalancerSettings,
  });
});
