import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@bb/plugin-sdk/app";
import type { PluginRpcResult } from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server.js";

type SystemStats = PluginRpcResult<(typeof rpcContract)["stats"]>;

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}

function meterTone(percent: number): string {
  if (percent >= 90) return "bg-destructive";
  if (percent >= 75) return "bg-attention";
  return "bg-primary";
}

function UsageCard({
  label,
  percent,
  detail,
  note,
}: {
  label: string;
  percent: number;
  detail: string;
  note: string;
}) {
  return (
    <article className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            {percent.toFixed(1)}%
          </p>
        </div>
        <span className="rounded-full bg-surface-recessed px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {detail}
        </span>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-recessed">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${meterTone(percent)}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{note}</p>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-recessed p-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-base font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function SystemMonitorPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const next = await rpc.call("stats", null);
        if (!cancelled) {
          setStats(next);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rpc]);

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto size-3 animate-pulse rounded-full bg-primary" />
          <p className="mt-4 text-sm font-medium">
            {error
              ? "Could not read system metrics"
              : "Sampling system metrics"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error ?? "Measuring CPU activity over a short interval..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <header className="mb-5 flex flex-col gap-3 pt-12 sm:flex-row sm:items-end sm:justify-between md:pt-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]" />
              <p className="text-sm font-medium">{stats.hostname}</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              bb server host / {stats.platform} {stats.release} /{" "}
              {stats.architecture}
            </p>
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            Updated {new Date(stats.sampledAt).toLocaleTimeString()}
            {error ? " / refresh delayed" : " / refreshes every 5s"}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <UsageCard
            label="CPU"
            percent={stats.cpu.usagePercent}
            detail={`${stats.cpu.logicalCores} cores / ${stats.cpu.speedMHz === null ? "speed unavailable" : `${(stats.cpu.speedMHz / 1000).toFixed(2)} GHz`}`}
            note={stats.cpu.model}
          />
          <UsageCard
            label="Memory"
            percent={stats.memory.usedPercent}
            detail={`${formatBytes(stats.memory.availableBytes)} free`}
            note={`${formatBytes(stats.memory.usedBytes)} used of ${formatBytes(stats.memory.totalBytes)}`}
          />
          <UsageCard
            label="Disk"
            percent={stats.disk.usedPercent}
            detail={`${formatBytes(stats.disk.availableBytes)} free`}
            note={`${formatBytes(stats.disk.usedBytes)} used of ${formatBytes(stats.disk.totalBytes)}`}
          />
        </section>

        <section className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">System</h2>
              <p className="text-sm text-muted-foreground">
                Load averages and host details from the current snapshot.
              </p>
            </div>
            <code className="mt-2 max-w-full truncate rounded-md bg-surface-recessed px-2 py-1 text-xs text-muted-foreground sm:mt-0">
              {stats.disk.path}
            </code>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Load average"
              value={stats.loadAverage
                .map((value) => value.toFixed(2))
                .join(" / ")}
            />
            <Stat label="Uptime" value={formatUptime(stats.uptimeSeconds)} />
            <Stat label="Kernel" value={`${stats.platform} ${stats.release}`} />
            <Stat label="Architecture" value={stats.architecture} />
          </dl>
        </section>
      </main>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "system-monitor",
    title: "System Monitor",
    icon: "ChartColumn",
    path: "stats",
    component: SystemMonitorPanel,
  });
});
