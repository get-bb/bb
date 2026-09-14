import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginNewThreadPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  AppProfileInput,
  ProcessSample,
  ProfileWithStatus,
  SystemSnapshot,
  pcControlRpcContract,
} from "./contract.js";
import { formatBytes, formatUptime } from "./components/format.js";
import { UsageRing } from "./components/usage-indicators.js";
import {
  freshnessDotClass,
  freshnessLabel,
  snapshotFreshness,
  type ReadingState,
} from "./components/freshness.js";
import { ProcessTable } from "./components/process-table.js";
import { AppProfiles } from "./components/app-profiles.js";
import { PcControlPill } from "./components/pill-overlay.js";

const OVERVIEW_REFRESH_MS = 2_000;
const PROFILES_REFRESH_MS = 10_000;
const PROCESS_LIMIT = 40;

type PanelTab = "overview" | "processes" | "apps";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PcControlPanelBody() {
  const rpc = useRpc<typeof pcControlRpcContract>();
  const [tab, setTab] = useState<PanelTab>("overview");

  const [snapshotState, setSnapshotState] = useState<SystemSnapshot | null>(
    null,
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [hostLabel, setHostLabel] = useState<string | null>(null);

  const [processesState, setProcessesState] = useState<{
    processes: ProcessSample[];
    totalMatched: number;
    truncated: boolean;
  } | null>(null);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [processesError, setProcessesError] = useState<string | null>(null);

  const [profilesState, setProfilesState] = useState<{
    profiles: ProfileWithStatus[];
    error: string | null;
  } | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => clearInterval(handle);
  }, []);

  const overviewInFlight = useRef(false);

  const refreshOverview = useCallback(async () => {
    if (overviewInFlight.current) return;
    overviewInFlight.current = true;
    try {
      const result = await rpc.call("overview", null);
      setHostLabel(`${result.host.name} · ${result.host.status}`);
      if (result.error !== null || result.snapshot === null) {
        setOverviewError(
          result.error ?? "No snapshot was collected from this PC.",
        );
      } else {
        setOverviewError(null);
        setSnapshotState(result.snapshot);
      }
    } catch (error) {
      setOverviewError(errorText(error));
    } finally {
      overviewInFlight.current = false;
    }
  }, [rpc]);

  const refreshProcesses = useCallback(async () => {
    setProcessesLoading(true);
    try {
      const result = await rpc.call("processes", {
        sortBy: "cpu",
        limit: PROCESS_LIMIT,
      });
      setProcessesState({
        processes: result.processes,
        totalMatched: result.totalMatched,
        truncated: result.truncated,
      });
      setProcessesError(result.hostError);
    } catch (error) {
      setProcessesError(errorText(error));
    } finally {
      setProcessesLoading(false);
    }
  }, [rpc]);

  const refreshProfiles = useCallback(async () => {
    try {
      const result = await rpc.call("profiles", null);
      setProfilesState({ profiles: result.profiles, error: result.error });
    } catch (error) {
      setProfilesState({
        profiles: [],
        error: errorText(error),
      });
    } finally {
      setProfilesLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refreshOverview();
    const handle = setInterval(() => {
      void refreshOverview();
    }, OVERVIEW_REFRESH_MS);
    return () => clearInterval(handle);
  }, [refreshOverview]);

  useEffect(() => {
    if (tab !== "processes") return;
    void refreshProcesses();
  }, [tab, refreshProcesses]);

  useEffect(() => {
    void refreshProfiles();
    const handle = setInterval(() => {
      void refreshProfiles();
    }, PROFILES_REFRESH_MS);
    return () => clearInterval(handle);
  }, [refreshProfiles]);

  const handleSaveProfile = useCallback(
    async (input: AppProfileInput) => {
      setSavingProfile(true);
      try {
        await rpc.call("saveProfile", input);
        toast.success(
          input.id === undefined
            ? "Program profile created"
            : "Program profile updated",
        );
        await refreshProfiles();
      } catch (error) {
        toast.error("Could not save the profile", {
          description: errorText(error),
        });
      } finally {
        setSavingProfile(false);
      }
    },
    [rpc, refreshProfiles],
  );

  const handleDeleteProfile = useCallback(
    async (profile: ProfileWithStatus) => {
      setPendingAction(`${profile.id}:delete`);
      try {
        await rpc.call("deleteProfile", { id: profile.id });
        toast.success(`Deleted ${profile.name}`);
        await refreshProfiles();
      } catch (error) {
        toast.error("Could not delete the profile", {
          description: errorText(error),
        });
      } finally {
        setPendingAction(null);
      }
    },
    [rpc, refreshProfiles],
  );

  const handleStartProfile = useCallback(
    async (profile: ProfileWithStatus) => {
      setPendingAction(`${profile.id}:start`);
      try {
        const started = await rpc.call("startProfile", { id: profile.id });
        toast.success(`Started ${profile.name}`, {
          description: `pid ${started.pid}`,
        });
        await refreshProfiles();
      } catch (error) {
        toast.error(`Could not start ${profile.name}`, {
          description: errorText(error),
        });
      } finally {
        setPendingAction(null);
      }
    },
    [rpc, refreshProfiles],
  );

  const handleStopProfile = useCallback(
    async (profile: ProfileWithStatus) => {
      setPendingAction(`${profile.id}:stop`);
      try {
        const stopped = await rpc.call("stopProfile", { id: profile.id });
        if (stopped.stoppedCount > 0) {
          toast.success(`Stopped ${profile.name}`, {
            description: `${stopped.stoppedCount} process${
              stopped.stoppedCount === 1 ? "" : "es"
            } terminated`,
          });
        } else {
          toast.info(`${profile.name} was not running`);
        }
        await refreshProfiles();
      } catch (error) {
        toast.error(`Could not stop ${profile.name}`, {
          description: errorText(error),
        });
      } finally {
        setPendingAction(null);
      }
    },
    [rpc, refreshProfiles],
  );

  const handleRestartProfile = useCallback(
    async (profile: ProfileWithStatus) => {
      setPendingAction(`${profile.id}:restart`);
      try {
        const restarted = await rpc.call("restartProfile", { id: profile.id });
        toast.success(`Restarted ${profile.name}`, {
          description: `pid ${restarted.pid}`,
        });
        await refreshProfiles();
      } catch (error) {
        toast.error(`Could not restart ${profile.name}`, {
          description: errorText(error),
        });
      } finally {
        setPendingAction(null);
      }
    },
    [rpc, refreshProfiles],
  );

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "processes", label: "Processes" },
    { id: "apps", label: "Programs" },
  ];

  const overviewState: ReadingState = (() => {
    if (overviewError !== null) return "error";
    if (snapshotState === null) return "measuring";
    return snapshotFreshness(snapshotState.collectedAt, nowMs);
  })();

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pc-control-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "true" : undefined}
            data-testid={`pc-tab-${entry.id}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === entry.id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
        <span className="flex-1" />
        {hostLabel !== null ? (
          <span
            className="hidden max-w-40 truncate text-[11px] text-muted-foreground sm:inline"
            title={hostLabel}
            data-testid="pc-host-label"
          >
            {hostLabel}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {tab === "overview" ? (
          <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto" data-testid="pc-overview">
            {overviewError !== null ? (
              <p
                className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                data-testid="pc-overview-error"
              >
                {overviewError}
              </p>
            ) : null}
            {snapshotState !== null ? (
              <p
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                data-testid="pc-overview-freshness"
                data-state={overviewState}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    freshnessDotClass(overviewState),
                  )}
                />
                {freshnessLabel(overviewState)}
                {overviewState === "stale"
                  ? ` · обновлено ${new Date(snapshotState.collectedAt).toLocaleTimeString()}`
                  : ""}
              </p>
            ) : null}
            {snapshotState !== null ? (
              <div
                data-testid="pc-overview-values"
                className={cn(
                  "flex flex-col gap-4 transition-opacity",
                  overviewState !== "fresh" && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-start justify-center gap-4">
                  <UsageRing
                    label="CPU"
                    percent={snapshotState.cpuPercent}
                    detail={`${snapshotState.cpuCores} cores`}
                    data-testid="pc-ring-cpu"
                  />
                  <UsageRing
                    label="Memory"
                    percent={snapshotState.memoryUsedPercent}
                    detail={`${formatBytes(snapshotState.memoryUsedBytes)} / ${formatBytes(snapshotState.memoryTotalBytes)}`}
                    data-testid="pc-ring-memory"
                  />
                  <div className="flex w-24 shrink-0 flex-col items-center gap-1">
                    <span className="flex h-[84px] items-center text-sm font-semibold tabular-nums">
                      {formatUptime(snapshotState.uptimeSeconds)}
                    </span>
                    <span className="text-xs font-medium text-foreground">Uptime</span>
                    <span className="text-[11px] text-muted-foreground">
                      since boot
                    </span>
                  </div>
                </div>
              </div>
            ) : overviewError === null ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                Collecting the first snapshot…
              </p>
            ) : null}
            <p className="mt-auto text-[11px] text-muted-foreground">
              Auto-refreshes every {OVERVIEW_REFRESH_MS / 1000}s on this PC.
            </p>
          </div>
        ) : null}
        {tab === "processes" ? (
          <ProcessTable
            processes={processesState?.processes ?? []}
            loading={processesLoading}
            error={processesError}
            totalMatched={processesState?.totalMatched ?? 0}
            truncated={processesState?.truncated ?? false}
            onRefresh={() => void refreshProcesses()}
          />
        ) : null}
        {tab === "apps" ? (
          <AppProfiles
            profiles={profilesState?.profiles ?? []}
            loading={profilesLoading}
            error={profilesState?.error ?? null}
            saving={savingProfile}
            pendingAction={pendingAction}
            onSave={handleSaveProfile}
            onDelete={handleDeleteProfile}
            onStart={handleStartProfile}
            onStop={handleStopProfile}
            onRestart={handleRestartProfile}
            onRetry={() => void refreshProfiles()}
          />
        ) : null}
      </div>
    </div>
  );
}

function PcControlThreadPanel({
  threadId: _threadId,
  params: _params,
}: PluginThreadPanelProps) {
  return <PcControlPanelBody />;
}

function PcControlNewThreadPanel({
  projectId: _projectId,
  params: _params,
}: PluginNewThreadPanelProps) {
  return <PcControlPanelBody />;
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "pc-control",
    title: "PC Control",
    icon: "Laptop",
    component: PcControlThreadPanel,
    layout: "flush",
  });
  app.slots.experimental_newThreadPanelAction({
    id: "pc-control",
    title: "PC Control",
    icon: "Laptop",
    component: PcControlNewThreadPanel,
    layout: "flush",
  });
  app.slots.experimental_appOverlay({
    id: "pc-control-pill",
    component: PcControlPill,
  });
});
