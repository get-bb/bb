import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { cn } from "@bb/shared-ui/lib/utils";
import type { SystemSnapshot, pcControlRpcContract } from "../contract.js";
import {
  freshnessDotClass,
  freshnessLabel,
  snapshotFreshness,
  type ReadingState,
} from "./freshness.js";
import { levelBarClass, loadLevel } from "./load-thresholds.js";

const PILL_REFRESH_MS = 2_000;
const FRESHNESS_TICK_MS = 1_000;

function percentText(percent: number | null): string {
  return percent === null ? "—" : `${Math.round(percent)}%`;
}

function barClass(kind: "cpu" | "ram", percent: number | null): string {
  if (percent === null) return "bg-muted-foreground/40";
  const level = loadLevel(percent);
  if (level !== "normal") return levelBarClass(level);
  return kind === "cpu" ? "bg-primary" : "bg-emerald-500";
}

function edgeFillColor(percent: number | null): string {
  if (percent === null) return "bg-muted-foreground/40";
  const level = loadLevel(percent);
  if (level === "critical") return "bg-destructive";
  if (level === "warning") return "bg-warning";
  return "bg-emerald-500";
}

function PillMetric({
  label,
  kind,
  percent,
  dimmed,
  testId,
}: {
  label: string;
  kind: "cpu" | "ram";
  percent: number | null;
  dimmed: boolean;
  testId: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "flex min-w-10 flex-col gap-1 transition-opacity",
        dimmed && "opacity-60",
      )}
    >
      <span className="flex items-baseline justify-between gap-1 text-[10px] leading-none text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {percentText(percent)}
        </span>
      </span>
      <span className="block h-[3px] w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500",
            barClass(kind, percent),
          )}
          style={{
            width: `${percent === null ? 2 : Math.max(percent, 2)}%`,
          }}
        />
      </span>
    </span>
  );
}

export function PcControlPill() {
  const rpc = useRpc<typeof pcControlRpcContract>();
  const navigate = useBbNavigate();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refreshInFlight = useRef(false);

  useEffect(() => {
    const handle = setInterval(() => {
      setNowMs(Date.now());
    }, FRESHNESS_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const result = await rpc.call("overview", null);
      if (result.error === null && result.snapshot !== null) {
        setSnapshot(result.snapshot);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      refreshInFlight.current = false;
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    const handle = setInterval(() => {
      void refresh();
    }, PILL_REFRESH_MS);
    return () => clearInterval(handle);
  }, [refresh]);

  const cpu = snapshot?.cpuPercent ?? null;
  const ram = snapshot?.memoryUsedPercent ?? null;

  let state: ReadingState;
  if (failed) {
    state = "error";
  } else if (snapshot === null) {
    state = "measuring";
  } else {
    state = snapshotFreshness(snapshot.collectedAt, nowMs);
  }
  const dimmed = state === "stale" || state === "error";
  const summary = `CPU ${percentText(cpu)} · RAM ${percentText(ram)} · ${freshnessLabel(state)}`;

  return (
    <>
      <button
        type="button"
        data-testid="pc-pill"
        onClick={() => {
          navigate.openThreadPanel({ actionId: "pc-control" });
        }}
        title={`PC Control — открыть панель · ${summary}${
          snapshot !== null
            ? ` (${new Date(snapshot.collectedAt).toLocaleTimeString()})`
            : ""
        }`}
        aria-label="PC Control — открыть панель"
        className="fixed bottom-3 right-3 z-40 hidden items-center gap-2 rounded-full border border-border bg-background/90 px-2.5 py-1.5 shadow-lg backdrop-blur transition-colors hover:bg-accent/40 lg:flex"
      >
        <span
          aria-hidden="true"
          data-testid="pc-pill-freshness"
          data-state={state}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            freshnessDotClass(state),
          )}
        />
        <PillMetric
          label="CPU"
          kind="cpu"
          percent={cpu}
          dimmed={dimmed}
          testId="pc-pill-cpu"
        />
        <PillMetric
          label="RAM"
          kind="ram"
          percent={ram}
          dimmed={dimmed}
          testId="pc-pill-ram"
        />
      </button>
      <button
        type="button"
        data-testid="pc-pill-edge"
        onClick={() => {
          navigate.openThreadPanel({ actionId: "pc-control" });
        }}
        title={`PC Control — открыть панель · ${summary}`}
        aria-label={`PC Control — открыть панель · ${summary}`}
        className={cn(
          "fixed bottom-1 left-3 z-40 flex h-4 items-center gap-1.5 rounded-md lg:hidden",
          dimmed && "opacity-60",
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="block h-[3px] w-[20vw] overflow-hidden rounded-full bg-muted">
            <span
              data-testid="pc-pill-edge-cpu"
              className={cn(
                "block h-full rounded-full transition-[width] duration-500",
                edgeFillColor(cpu),
              )}
              style={{
                width: `${cpu === null ? 2 : Math.max(cpu, 2)}%`,
              }}
            />
          </span>
          <span className="block h-[3px] w-[20vw] overflow-hidden rounded-full bg-muted">
            <span
              data-testid="pc-pill-edge-ram"
              className={cn(
                "block h-full rounded-full transition-[width] duration-500",
                edgeFillColor(ram),
              )}
              style={{
                width: `${ram === null ? 2 : Math.max(ram, 2)}%`,
              }}
            />
          </span>
        </span>
        <span
          aria-hidden="true"
          data-testid="pc-pill-edge-freshness"
          data-state={state}
          className={cn(
            "size-1 shrink-0 rounded-full",
            freshnessDotClass(state),
          )}
        />
      </button>
    </>
  );
}
