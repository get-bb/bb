import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_Icon as PluginIcon,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { DatabaseRestoreIcon } from "./icons/database-restore.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { storageRpc, State, Policy, Preview } from "./src/contract.js";
import {
  LARGE_FILE_MIN_BYTES,
  LARGE_FILE_NUDGE_MIN_BYTES,
} from "./src/rules.js";

type HostReport = import("./src/storage-types.js").HostStorageResponse;
type Hosts = import("./src/storage-types.js").HostStorageListResponse["hosts"];
type LargeFileTotals = NonNullable<HostReport["report"]>["archivedLargeFiles"];
type Machine = Awaited<
  ReturnType<ReturnType<typeof useSdk>["hosts"]["list"]>
>[number];
const PANEL = "storage";
const ARCHIVE_PRESETS = [7, 14, 30, 60, 90, 180, 365];
const DELETE_PRESETS = [7, 30, 90, 180, 365];
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${Number((value / 1024 ** index).toFixed(1))} ${["B", "KB", "MB", "GB", "TB"][index]}`;
}
function ago(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
function duration(days: number) {
  if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
  if (days % 7 === 0 && days <= 28)
    return days === 7 ? "1 week" : `${days / 7} weeks`;
  return days === 1 ? "1 day" : `${days} days`;
}
function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type StorageData = {
  state: State;
  hosts: Hosts;
  machines: Record<string, Machine>;
  primaryHostId: string | null;
};

function StoragePanel(props: PluginNavPanelProps) {
  const rpc = useRpc<typeof storageRpc>();
  const sdk = useSdk();
  const [data, setData] = useState<StorageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [state, reports, machines, config] = await Promise.all([
        rpc.call("state", null),
        rpc.call("hosts", null),
        sdk.hosts.list({ type: "persistent" }),
        sdk.system.config(),
      ]);
      setData({
        state,
        hosts: reports.hosts,
        machines: Object.fromEntries(machines.map((host) => [host.id, host])),
        primaryHostId: config.primaryHostId,
      });
      setLoadError(null);
    } catch (error) {
      setLoadError(message(error));
    }
  }, [rpc, sdk]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("changed", refresh);
  useEffect(() => {
    const hosts = sdk.subscribe({
      event: "host:changed",
      callback: () => {
        void refresh();
      },
    });
    const connection = sdk.subscribe({
      event: "realtime:connection",
      callback: (event) => {
        if (event.state === "connected") void refresh();
      },
    });
    return () => {
      hosts();
      connection();
    };
  }, [sdk, refresh]);
  return (
    <StoragePage
      key={props.subPath}
      hostId={props.subPath || null}
      data={data}
      loadError={loadError}
      refresh={refresh}
    />
  );
}

function StoragePage({
  hostId,
  data,
  loadError,
  refresh,
}: {
  hostId: string | null;
  data: StorageData | null;
  loadError: string | null;
  refresh: () => Promise<void>;
}) {
  const rpc = useRpc<typeof storageRpc>();
  const navigate = useBbNavigate();
  const state = data?.state ?? null;
  const hosts = data?.hosts ?? [];
  const machines = data?.machines ?? {};
  const primaryHostId = data?.primaryHostId ?? null;
  const detail = hosts.find((host) => host.hostId === hostId) ?? null;
  const [actionError, setError] = useState<string | null>(null);
  const [actionScope, setActionScope] = useState<"storage" | "retention">(
    "storage",
  );
  const error = actionError ?? loadError;
  const [actionBusy, setBusy] = useState(false);
  const busy =
    actionBusy ||
    hosts.some((host) => host.largeFileCleanup.state === "running");
  const [threadClears, setThreadClears] = useState<
    Record<string, { state: "clearing" } | { state: "failed"; message: string }>
  >({});
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const policy = draft ?? state?.policy ?? null;
  const [confirmation, setConfirmation] = useState<{
    policy: Policy;
    preview: Preview;
  } | null>(null);
  const [cleanup, setCleanup] = useState<{
    key: string;
    title: string;
    detail: string;
    action: string;
    run: () => Promise<string>;
  } | null>(null);
  async function perform<T>(
    work: () => Promise<T>,
    success?: (result: T) => string,
    scope: "storage" | "retention" = "storage",
  ) {
    setActionScope(scope);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await work();
      await refresh();
      if (success) setNotice(success(result));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function preview(policy: Policy) {
    setConfirmation(null);
    await perform(
      async () => {
        setConfirmation({ policy, preview: await rpc.call("preview", policy) });
      },
      undefined,
      "retention",
    );
  }
  async function clearThread(threadId: string) {
    if (threadClears[threadId]?.state === "clearing") return;
    setThreadClears((current) => ({
      ...current,
      [threadId]: { state: "clearing" },
    }));
    try {
      await rpc.call("clearThread", { threadId });
      await refresh();
      setThreadClears((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
    } catch (error) {
      setThreadClears((current) => ({
        ...current,
        [threadId]: { state: "failed", message: message(error) },
      }));
    }
  }
  const retentionOn =
    state !== null &&
    (state.policy.archiveAfterDays !== null ||
      state.policy.deleteAfterDays !== null);
  const report = detail?.report;
  const scanning = detail?.scan.state === "scanning";
  const machine = hostId ? machines[hostId] : undefined;
  const offline = machine !== undefined && machine.status !== "connected";
  const clearingThreads = Object.values(threadClears).some(
    (clear) => clear.state === "clearing",
  );
  const locked = busy || scanning || offline || clearingThreads;
  const changed =
    state !== null &&
    policy !== null &&
    (policy.archiveAfterDays !== state.policy.archiveAfterDays ||
      policy.deleteAfterDays !== state.policy.deleteAfterDays);
  function largeFilesCleanup(target: string | null, totals: LargeFileTotals) {
    return {
      key: "large-files",
      action: "Delete large files",
      title: `Delete ${totals.fileCount.toLocaleString()} large ${totals.fileCount === 1 ? "file" : "files"} (${bytes(totals.bytes)})?`,
      detail: `Delete files of ${bytes(LARGE_FILE_MIN_BYTES)} or more from ${plural(totals.threadCount, "archived thread")}. Smaller files and conversation history will be kept. Pinned threads are skipped. This can’t be undone.`,
      run: async () => {
        await rpc.call("startClearLargeFiles", { hostId: target });
        return "";
      },
    };
  }
  const scannable = hosts.filter(
    (host) =>
      machines[host.hostId]?.status === "connected" &&
      host.scan.state !== "scanning",
  );
  const archivedLargeFiles = hosts.reduce<LargeFileTotals>(
    (totals, host) =>
      host.report && machines[host.hostId]?.status === "connected"
        ? {
            threadCount:
              totals.threadCount + host.report.archivedLargeFiles.threadCount,
            fileCount:
              totals.fileCount + host.report.archivedLargeFiles.fileCount,
            bytes: totals.bytes + host.report.archivedLargeFiles.bytes,
          }
        : totals,
    { threadCount: 0, fileCount: 0, bytes: 0 },
  );
  const cleanupStatuses = hosts.filter((host) => {
    const status = host.largeFileCleanup;
    return (
      (hostId === null || host.hostId === hostId) &&
      status.state !== "idle" &&
      (status.state !== "completed" || status.clearedFiles > 0)
    );
  });
  const cleanupRunning = cleanupStatuses.some(
    (host) => host.largeFileCleanup.state === "running",
  );
  const cleanupStatus = cleanupStatuses.length > 0 && (
    <div className="space-y-2 border-t border-border pt-3">
      {cleanupStatuses.map((host) => {
        const status = host.largeFileCleanup;
        if (status.state === "idle") return null;
        return (
          <p
            key={host.hostId}
            role={status.state === "failed" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-2 text-xs",
              status.state === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {status.state === "running" ? (
              <Icon name="Spinner" className="size-3.5 shrink-0 animate-spin" />
            ) : status.state === "completed" ? (
              <Icon name="Check" className="size-3.5 shrink-0" />
            ) : null}
            {hostId === null &&
              `${machines[host.hostId]?.name ?? host.hostId}: `}
            {status.state === "running"
              ? "Deleting large files…"
              : status.state === "failed"
                ? status.message
                : `Deleted ${plural(status.clearedFiles, "large file")} · ${bytes(status.clearedBytes)} freed`}
          </p>
        );
      })}
    </div>
  );
  const suggestions =
    archivedLargeFiles.bytes >= LARGE_FILE_NUDGE_MIN_BYTES ||
    cleanupStatuses.length > 0
      ? [
          {
            title: cleanupRunning
              ? "Deleting large files"
              : archivedLargeFiles.bytes >= LARGE_FILE_NUDGE_MIN_BYTES
                ? `Free up ${bytes(archivedLargeFiles.bytes)} from archived threads`
                : "Large-file cleanup",
            description:
              cleanupRunning ||
              archivedLargeFiles.bytes < LARGE_FILE_NUDGE_MIN_BYTES
                ? "Smaller files and conversation history are kept."
                : `${plural(archivedLargeFiles.fileCount, "file")} of ${bytes(LARGE_FILE_MIN_BYTES)} or more sit in the thread storage of ${plural(archivedLargeFiles.threadCount, "archived thread")}. Deleting them keeps smaller files like reports, and conversation history isn’t affected.`,
            action: "Delete large files",
            cleanup: largeFilesCleanup(null, archivedLargeFiles),
          },
        ]
      : [];
  const cleanupConfirmation = cleanup && (
    <div
      role="region"
      aria-label="Confirm cleanup"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{cleanup.title}</p>
        <p className="text-xs leading-snug text-subtle-foreground/75">
          {cleanup.detail}
        </p>
      </div>
      {actionError && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setCleanup(null)}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() =>
            void perform(
              async () => {
                const done = await cleanup.run();
                setCleanup(null);
                return done;
              },
              (done) => done,
            )
          }
        >
          {busy ? "Removing…" : cleanup.action}
        </Button>
      </div>
    </div>
  );
  const scanNotice = scanning && (
    <p role="status" className="text-xs leading-snug text-subtle-foreground/75">
      Scanning in the background. Large directories may take a few minutes.
    </p>
  );
  const storageInfo = (
    <aside
      aria-label="What is thread storage?"
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
    >
      <Icon
        name="Info"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 space-y-1">
        <h2 className="text-sm font-medium">What is thread storage?</h2>
        <p className="text-xs leading-snug text-subtle-foreground/75">
          A place for your agent to keep things that don’t belong in the repo,
          like plans, reports, and scratch files you don’t want to commit.
          Clearing it removes those files for good. Your conversation history
          and uploaded attachments are kept separately.
        </p>
      </div>
    </aside>
  );
  return (
    <div className="h-full w-full overflow-y-auto">
      <div
        className={cn(
          "mx-auto w-full max-w-3xl px-4 pb-10 pt-4 md:px-5 md:pt-5",
          hostId ? "space-y-6" : "space-y-10",
        )}
      >
        {hostId && state && (
          <header className="space-y-3">
            <button
              className="inline-flex items-center gap-1.5 text-xs leading-snug text-subtle-foreground/75 hover:text-foreground"
              onClick={() => navigate.toPluginPanel(PANEL)}
            >
              <Icon name="ArrowLeft" className="size-4" />
              All machines
            </button>
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <h1 className="min-w-0 break-words text-base font-semibold">
                    {machine?.name ?? "Machine storage"}
                  </h1>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {hostId === primaryHostId && <Pill>server</Pill>}
                    {machine && <MachineStatus machine={machine} />}
                  </div>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                  Review stored files and free up space on this machine.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={locked || !detail}
                onClick={() =>
                  void perform(() => rpc.call("scanHost", { hostId }))
                }
              >
                <Icon
                  name="RotateCcw"
                  className={scanning ? "animate-spin" : ""}
                />
                {scanning
                  ? "Scanning…"
                  : report
                    ? "Rescan machine"
                    : "Scan machine"}
              </Button>
            </div>
          </header>
        )}
        {error &&
          !(actionError && (cleanup || actionScope === "retention")) && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <p>{error}</p>
              {loadError && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refresh()}
                >
                  Try again
                </Button>
              )}
            </div>
          )}
        {notice && actionScope === "storage" && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Icon name="Check" className="size-4" />
            {notice}
          </p>
        )}
        {!state ? (
          !loadError && (
            <DelayedLoading>
              <StorageSkeleton detail={hostId !== null} />
            </DelayedLoading>
          )
        ) : hostId ? (
          <div className="space-y-6">
            {storageInfo}
            {offline && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-snug text-subtle-foreground"
              >
                <Icon name="CloudOff" className="mt-px size-3.5 shrink-0" />
                <p>
                  This machine is offline. Scanning and cleanup are available
                  once it reconnects.
                </p>
              </div>
            )}
            {detail?.scan.state === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                Scan failed: {detail.scan.message}
              </p>
            )}
            {!report ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <PluginIcon
                  name="DatabaseRestore"
                  className="size-8 text-muted-foreground"
                />
                <h2 className="text-base font-medium">
                  {scanning
                    ? "Scanning this machine"
                    : "See what’s taking up space"}
                </h2>
                {scanning ? (
                  scanNotice
                ) : (
                  <p className="max-w-sm text-xs leading-snug text-subtle-foreground/75">
                    Scan this machine to measure thread files and find storage
                    you can clean up. Nothing is removed during a scan.
                  </p>
                )}
              </div>
            ) : (
              <>
                <section
                  className="space-y-4 rounded-lg border border-border bg-card px-4 py-3.5"
                  aria-label="Storage breakdown"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">Thread storage</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bytes(
                        report.activeThreadBytes + report.archivedThreadBytes,
                      )}
                    </p>
                  </div>
                  <StorageBreakdown report={report} />
                  <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    {report.disk && (
                      <p className="tabular-nums">
                        Disk space: {bytes(report.disk.freeBytes)} free of{" "}
                        {bytes(report.disk.totalBytes)}
                      </p>
                    )}
                    <p>Scanned {new Date(report.scannedAt).toLocaleString()}</p>
                    {scanNotice}
                  </div>
                </section>
                <ProjectWorktrees report={report} />
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">Clean up</h2>
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            All files in archived threads{" "}
                            <StorageSize value={report.archivedFiles.bytes} />
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            Clear stored files of any size from{" "}
                            {plural(
                              report.archivedFiles.threadCount,
                              "archived thread",
                            )}
                            . Pinned and running threads are skipped.
                            Conversations and uploaded attachments are kept.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked ||
                            report.archivedFiles.threadCount === 0 ||
                            cleanup !== null
                          }
                          onClick={() =>
                            setCleanup({
                              key: "archived-files",
                              title: "Clear all archived thread files?",
                              action: "Clear archived files",
                              detail: `Delete ${bytes(report.archivedFiles.bytes)} of stored files from ${plural(report.archivedFiles.threadCount, "archived thread")} on this machine. This includes small files. Conversations and uploaded attachments will be kept. Pinned and running threads are skipped. This can’t be undone.`,
                              run: async () => {
                                const result = await rpc.call(
                                  "clearArchivedFiles",
                                  { hostId: report.hostId },
                                );
                                return `Cleared ${bytes(result.clearedBytes)} from ${plural(result.clearedThreads, "archived thread")}.`;
                              },
                            })
                          }
                        >
                          Clear archived files
                        </Button>
                      </div>
                      {cleanup?.key === "archived-files" && cleanupConfirmation}
                    </div>
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-normal">
                            Large files in archived threads{" "}
                            <StorageSize
                              value={report.archivedLargeFiles.bytes}
                            />
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            {report.archivedLargeFiles.fileCount
                              ? `${plural(report.archivedLargeFiles.fileCount, "file")} of ${bytes(LARGE_FILE_MIN_BYTES)} or more across ${plural(report.archivedLargeFiles.threadCount, "archived thread")}. Smaller files and conversation history are kept.`
                              : `No files of ${bytes(LARGE_FILE_MIN_BYTES)} or more in archived threads.`}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked ||
                            report.archivedLargeFiles.fileCount === 0 ||
                            cleanup !== null
                          }
                          onClick={() =>
                            setCleanup(
                              largeFilesCleanup(
                                report.hostId,
                                report.archivedLargeFiles,
                              ),
                            )
                          }
                        >
                          Delete large files
                        </Button>
                      </div>
                      {cleanup?.key === "large-files" && cleanupConfirmation}
                      {cleanupStatus}
                    </div>
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-normal">
                            Orphaned storage{" "}
                            <StorageSize value={report.orphanBytes} />
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            Files left behind by deleted threads. BB cleans
                            these up automatically while idle.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked ||
                            report.orphanCount === 0 ||
                            cleanup !== null
                          }
                          onClick={() =>
                            setCleanup({
                              key: "orphans",
                              action: "Remove orphans",
                              title: `Remove ${bytes(report.orphanBytes)} of orphaned storage?`,
                              detail:
                                "Delete folders no longer attached to a thread. Existing threads and their files will be kept. This can’t be undone.",
                              run: async () => {
                                const removed = await rpc.call(
                                  "removeOrphans",
                                  { hostId: report.hostId },
                                );
                                return `Removed ${bytes(removed.removedBytes)} of orphaned storage.`;
                              },
                            })
                          }
                        >
                          Remove orphans
                        </Button>
                      </div>
                      {cleanup?.key === "orphans" && cleanupConfirmation}
                    </div>
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-normal">
                            Leftover worktrees{" "}
                            <StorageSize value={report.leftoverWorktreeBytes} />
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            Checkouts BB could not remove after their threads
                            were archived. BB retries automatically.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked || report.leftoverWorktrees.length === 0
                          }
                          onClick={() =>
                            void perform(
                              async () => {
                                await rpc.call("retryWorktreeCleanup", {
                                  hostId,
                                });
                              },
                              () =>
                                "Cleanup requested. Rescan after it finishes to update usage.",
                            )
                          }
                        >
                          Retry cleanup
                        </Button>
                      </div>
                      {report.leftoverWorktrees.length > 0 && (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            {plural(
                              report.leftoverWorktrees.length,
                              "checkout",
                            )}{" "}
                            awaiting removal
                          </summary>
                          <div className="mt-2 space-y-2">
                            {report.leftoverWorktrees.map((worktree) => (
                              <div
                                key={worktree.environmentId}
                                className="space-y-1 border-l border-border pl-3"
                              >
                                <p className="break-all">{worktree.path}</p>
                                <p className="mt-1 text-muted-foreground">
                                  {bytes(worktree.sizeBytes)}
                                  {worktree.teardownMessage &&
                                    ` · ${worktree.teardownMessage}`}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                </section>
                <section className="space-y-3">
                  <SectionHeading
                    title="Threads using the most storage"
                    description="Clear files permanently removes a stopped thread’s stored files, including small files. Conversation history is kept."
                  />
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    {report.largestThreads.length === 0 && (
                      <p className="p-6 text-center text-xs leading-snug text-subtle-foreground/75">
                        No thread files found in the last scan.
                      </p>
                    )}
                    {report.largestThreads.map((thread) => {
                      const clear = threadClears[thread.threadId];
                      return (
                        <div
                          key={thread.threadId}
                          className="flex flex-col gap-2 px-4 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
                            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:flex-1">
                              <button
                                className="line-clamp-2 min-w-0 text-left text-sm font-normal hover:underline sm:truncate"
                                title={thread.title}
                                onClick={() =>
                                  navigate.toThread(thread.threadId)
                                }
                              >
                                {thread.title}
                              </button>
                              {thread.hidden && <Pill>hidden</Pill>}
                              {thread.running ? (
                                <Pill>running</Pill>
                              ) : thread.archivedAt !== null ? (
                                <Pill>archived</Pill>
                              ) : null}
                            </div>
                            <span className="mr-auto shrink-0 text-xs tabular-nums text-muted-foreground sm:mr-0">
                              {bytes(thread.sizeBytes)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              disabled={
                                busy ||
                                scanning ||
                                offline ||
                                thread.running ||
                                cleanup !== null ||
                                clear?.state === "clearing"
                              }
                              onClick={() => void clearThread(thread.threadId)}
                            >
                              {clear?.state === "clearing" ? (
                                <>
                                  <Icon
                                    name="Spinner"
                                    className="size-4 animate-spin"
                                  />
                                  Clearing…
                                </>
                              ) : clear?.state === "failed" ? (
                                "Retry"
                              ) : (
                                "Clear files"
                              )}
                            </Button>
                          </div>
                          {clear?.state === "failed" && (
                            <p
                              role="alert"
                              className="pb-2 text-xs text-destructive"
                            >
                              {clear?.message}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                {report.developerStorage && (
                  <DeveloperStorage storage={report.developerStorage} />
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.cleanup.key}
                className="space-y-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
              >
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <Icon
                    name="Clean"
                    className="hidden size-4 shrink-0 text-subtle-foreground sm:block"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-normal">{suggestion.title}</p>
                    <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                      {suggestion.description}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={
                      busy ||
                      cleanup !== null ||
                      archivedLargeFiles.fileCount === 0
                    }
                    onClick={() => setCleanup(suggestion.cleanup)}
                  >
                    {suggestion.action}
                  </Button>
                </div>
                {cleanup?.key === suggestion.cleanup.key && cleanupConfirmation}
                {cleanupStatus}
              </div>
            ))}
            <section className="space-y-3">
              <SectionHeading
                title="Machine storage"
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || scannable.length === 0}
                    onClick={() =>
                      void perform(() => rpc.call("scanAll", null))
                    }
                  >
                    <Icon name="RotateCcw" />
                    Scan all
                  </Button>
                }
              />
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {hosts.length === 0 && (
                  <div className="space-y-2 p-6 text-center">
                    <p className="text-sm font-normal">
                      No machines connected yet
                    </p>
                    <p className="text-xs leading-snug text-subtle-foreground/75">
                      Add a persistent machine in Settings → Machines to inspect
                      its storage.
                    </p>
                  </div>
                )}
                {hosts.map((host) => (
                  <MachineRow
                    key={host.hostId}
                    host={host}
                    machine={machines[host.hostId]}
                    server={host.hostId === primaryHostId}
                    busy={busy}
                    onOpen={() =>
                      navigate.toPluginPanel(PANEL, { subPath: host.hostId })
                    }
                    onScan={() =>
                      void perform(() =>
                        rpc.call("scanHost", { hostId: host.hostId }),
                      )
                    }
                  />
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <SectionHeading
                title="Automatic retention"
                description="Archive or delete inactive threads across all projects. You’ll see what changes before anything is saved."
                badge={retentionOn ? "Checks hourly" : "Off"}
              />
              <div
                role="note"
                className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-snug text-subtle-foreground"
              >
                <Icon name="Pin" className="mt-px size-3.5 shrink-0" />
                <p>
                  <span className="text-foreground">
                    Pinned threads are never archived or deleted.
                  </span>{" "}
                  Automation targets aren’t protected on their own, so pin the
                  ones you want to keep.
                </p>
              </div>
              {actionError && actionScope === "retention" && !confirmation && (
                <p role="alert" className="text-xs text-destructive">
                  {actionError}
                </p>
              )}
              {notice && actionScope === "retention" && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Icon name="Check" className="size-3.5" />
                  {notice}
                </p>
              )}
              {policy && (
                <div className="divide-y divide-border rounded-lg border border-border bg-card">
                  <RetentionField
                    label="Archive inactive threads"
                    description="After this long with no activity."
                    presets={ARCHIVE_PRESETS}
                    value={policy.archiveAfterDays}
                    disabled={busy || confirmation !== null}
                    onChange={(archiveAfterDays) => {
                      setDraft({ ...policy, archiveAfterDays });
                      setNotice(null);
                    }}
                  />
                  <RetentionField
                    label="Delete archived threads"
                    description="Permanently, after this long in the archive."
                    presets={DELETE_PRESETS}
                    value={policy.deleteAfterDays}
                    disabled={busy || confirmation !== null}
                    onChange={(deleteAfterDays) => {
                      setDraft({ ...policy, deleteAfterDays });
                      setNotice(null);
                    }}
                  />
                  {(changed || state.lastRun || retentionOn) && (
                    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">
                        {changed
                          ? "Unsaved changes"
                          : state.lastRun
                            ? `Last checked ${ago(state.lastRun.ranAt)} · ${state.lastRun.archivedCount} archived · ${state.lastRun.deletedCount} deleted${state.lastRun.failedCount ? ` · ${state.lastRun.failedCount} failed` : ""}`
                            : "The first check runs within the hour."}
                      </p>
                      {changed && (
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || confirmation !== null}
                            onClick={() => setDraft(null)}
                          >
                            Discard
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || confirmation !== null}
                            onClick={() => void preview(policy)}
                          >
                            {busy ? "Working…" : "Preview changes"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {confirmation && (
                <div
                  role="region"
                  aria-label="Confirm retention policy"
                  className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
                >
                  <h3 className="text-sm font-semibold">
                    Review retention changes
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">
                        {confirmation.preview.archiveCount}{" "}
                        <span className="text-sm font-normal">to archive</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {confirmation.policy.archiveAfterDays === null
                          ? "Never archive automatically"
                          : `After ${duration(confirmation.policy.archiveAfterDays)} inactive`}
                      </p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">
                        {confirmation.preview.deleteCount}{" "}
                        <span className="text-sm font-normal">to delete</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {confirmation.policy.deleteAfterDays === null
                          ? "Never delete automatically"
                          : `After ${duration(confirmation.policy.deleteAfterDays)} archived`}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-snug text-subtle-foreground/75">
                    Counts reflect threads that qualify now. Archiving can
                    remove worktrees and uncommitted changes. Deleting
                    permanently removes history and files.
                  </p>
                  {actionError && actionScope === "retention" && (
                    <p role="alert" className="text-xs text-destructive">
                      {actionError}
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmation(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          async () => {
                            await rpc.call("configure", confirmation.policy);
                            setDraft(null);
                            setConfirmation(null);
                          },
                          () => "Retention policy saved.",
                          "retention",
                        )
                      }
                    >
                      Save policy
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StorageSkeleton({ detail }: { detail: boolean }) {
  const rows = (count: number) => (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-2 px-4 py-3.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-56" />
        </div>
      ))}
    </div>
  );
  return (
    <div role="status" aria-label="Loading storage" className="space-y-10">
      {detail ? (
        <>
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
          <div className="space-y-4 rounded-lg border border-border bg-card px-4 py-3.5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-1.5 w-full" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-8" />
              ))}
            </div>
          </div>
          {rows(2)}
        </>
      ) : (
        <>
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            {rows(3)}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full rounded-lg" />
            {rows(2)}
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
      {children}
    </span>
  );
}

function SectionHeading({
  title,
  description,
  badge,
  action,
}: {
  title: string;
  description?: string;
  badge?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge && <Pill>{badge}</Pill>}
        </div>
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function StorageSize({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className="ml-2 inline-flex rounded-md bg-muted/50 px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">
      {bytes(value)}
    </span>
  );
}

function MachineStatus({ machine }: { machine: Machine }) {
  const online = machine.status === "connected";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-subtle-foreground/75">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          online ? "bg-success" : "border border-muted-foreground",
        )}
      />
      {online
        ? "Online"
        : machine.lastSeenAt
          ? `Offline · last seen ${ago(machine.lastSeenAt)}`
          : "Offline"}
    </span>
  );
}

function MachineRow({
  host,
  machine,
  server,
  busy,
  onOpen,
  onScan,
}: {
  host: Hosts[number];
  machine: Machine | undefined;
  server: boolean;
  busy: boolean;
  onOpen: () => void;
  onScan: () => void;
}) {
  const report = host.report;
  const scanning = host.scan.state === "scanning";
  const details = [
    ...(report
      ? [
          `${(report.threadsWithStorageCount - report.archivedThreadCount).toLocaleString()} active`,
          `${report.archivedThreadCount.toLocaleString()} archived`,
        ]
      : []),
    scanning
      ? "scanning…"
      : host.scan.state === "failed"
        ? "scan failed"
        : report
          ? `scanned ${ago(report.scannedAt)}`
          : "not scanned",
  ];
  return (
    <div
      className="group flex w-full cursor-pointer flex-col items-stretch gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button") !== null
        )
          return;
        onOpen();
      }}
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            name="Laptop"
            className="size-3.5 shrink-0 text-subtle-foreground"
          />
          <button
            className="min-w-0 truncate rounded-sm text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onOpen}
          >
            {machine?.name ?? host.hostId}
          </button>
          {server && <Pill>server</Pill>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-subtle-foreground/75">
          {machine && <MachineStatus machine={machine} />}
          {details.map((detail) => (
            <span key={detail} className="shrink-0">
              {detail}
            </span>
          ))}
        </span>
      </span>
      <span className="flex items-center gap-3">
        {report && (
          <span className="mr-auto shrink-0 text-left sm:mr-0 sm:text-right">
            <span className="block text-sm font-normal tabular-nums">
              {bytes(threadStorageBytes(report))}
            </span>
            {report.disk && (
              <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                {bytes(report.disk.freeBytes)} free
              </span>
            )}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          aria-label={`Scan ${machine?.name ?? host.hostId}`}
          disabled={busy || scanning || machine?.status !== "connected"}
          onClick={onScan}
        >
          {scanning ? "Scanning" : report ? "Rescan" : "Scan"}
        </Button>
        <Icon
          name="ChevronRight"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </span>
    </div>
  );
}

function RetentionField({
  label,
  description,
  presets,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  presets: number[];
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  const options =
    value === null || presets.includes(value)
      ? presets
      : [...presets, value].sort((a, b) => a - b);
  return (
    <div className="flex flex-col items-start justify-between gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-normal">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
          {description}
        </p>
      </div>
      <Select
        disabled={disabled}
        value={value === null ? "never" : String(value)}
        onValueChange={(next) =>
          onChange(next === "never" ? null : Number(next))
        }
      >
        <SelectTrigger aria-label={label} className="h-8 w-40 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="never">Never</SelectItem>
          {options.map((days) => (
            <SelectItem key={days} value={String(days)}>
              After {duration(days)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function ProjectWorktrees({
  report,
}: {
  report: NonNullable<HostReport["report"]>;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Worktrees by project"
        description="Managed worktrees BB tracks on this machine. Projects with a source here are included even when they have no worktrees. These counts are separate from thread files."
      />
      <div className="rounded-lg border border-border bg-card px-4 py-2">
        {report.projectWorktrees.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">
            No projects with sources or managed worktrees on this machine.
          </p>
        ) : (
          <table className="w-full text-xs">
            <caption className="sr-only">
              Project worktree counts on this machine
            </caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-2 text-left font-normal">
                  Project
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-normal">
                  Worktrees
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-normal">
                  Awaiting cleanup
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.projectWorktrees.map((project) => (
                <tr key={project.projectId}>
                  <th scope="row" className="py-3 text-left font-normal">
                    {project.projectName}
                  </th>
                  <td className="py-3 pl-3 text-right font-normal tabular-nums">
                    {project.worktreeCount.toLocaleString()}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums text-muted-foreground">
                    {project.cleanupPendingCount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

type DeveloperEntry = NonNullable<
  NonNullable<HostReport["report"]>["developerStorage"]
>["entries"][number];

function developerEntryLabel(entry: DeveloperEntry) {
  const parts = entry.sourcePath?.split(/[\\/]/).filter(Boolean);
  if (parts?.length)
    return parts.at(-1) === "bb" ? (parts.at(-2) ?? "bb") : parts.at(-1)!;
  return (
    entry.name.match(/thr_[a-zA-Z0-9]+(?:-\d+)?/)?.[0] ??
    entry.name.replace(/-[a-f0-9]{12}$/, "")
  );
}

function DeveloperStorage({
  storage,
}: {
  storage: NonNullable<NonNullable<HostReport["report"]>["developerStorage"]>;
}) {
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [copyStatus, setCopyStatus] = useState<{
    text: string;
    failed: boolean;
  } | null>(null);
  const missing = storage.entries.filter(
    (entry) => entry.sourcePathState === "missing",
  );
  const unlinked = storage.entries.filter(
    (entry) => entry.sourcePath !== null && entry.threads.length === 0,
  );
  const unresolved = storage.entries.filter(
    (entry) => entry.sourcePath === null,
  );
  const filtered =
    filter === "missing"
      ? missing
      : filter === "unlinked"
        ? unlinked
        : filter === "unresolved"
          ? unresolved
          : storage.entries;
  const entries = expanded ? filtered : filtered.slice(0, 5);
  const groups = [
    {
      title: "Linked threads",
      all: filtered.filter((entry) => entry.threads.length > 0),
      entries: entries.filter((entry) => entry.threads.length > 0),
    },
    {
      title: "Other instances",
      all: filtered.filter(
        (entry) => entry.sourcePath !== null && entry.threads.length === 0,
      ),
      entries: entries.filter(
        (entry) => entry.sourcePath !== null && entry.threads.length === 0,
      ),
    },
    {
      title: "Unidentified sources",
      all: filtered.filter((entry) => entry.sourcePath === null),
      entries: entries.filter((entry) => entry.sourcePath === null),
    },
  ];
  const copyPath = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus({ text: `${label} copied`, failed: false });
    } catch {
      setCopyStatus({
        text: `Could not copy ${label.toLowerCase()}`,
        failed: true,
      });
    }
  };
  return (
    <section className="space-y-3">
      <SectionHeading
        title="BB development storage"
        description="Databases, logs, and thread files from local development instances in ~/.bb-dev."
      />
      <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-lg font-medium tabular-nums">
            {bytes(storage.sizeBytes)}
          </p>
          <Select
            value={filter}
            onValueChange={(value) => {
              setFilter(value);
              setExpanded(false);
              setCopyStatus(null);
            }}
          >
            <SelectTrigger
              aria-label="Filter development storage"
              className="h-8 w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">
                All entries ({storage.entries.length})
              </SelectItem>
              <SelectItem value="missing">
                Missing checkouts ({missing.length})
              </SelectItem>
              <SelectItem value="unlinked">
                Other instances ({unlinked.length})
              </SelectItem>
              <SelectItem value="unresolved">
                Unidentified source ({unresolved.length})
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {bytes(
              missing.reduce((total, entry) => total + entry.sizeBytes, 0),
            )}{" "}
            in {missing.length.toLocaleString()}{" "}
            {missing.length === 1 ? "entry" : "entries"} whose source checkout
            no longer exists.
          </p>
        )}
        <div className="divide-y divide-border border-t border-border">
          {groups
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <div key={group.title} className="py-3">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group.title}{" "}
                  <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                    ({group.all.length.toLocaleString()})
                  </span>
                </h3>
                <div className="mt-2 space-y-3">
                  {group.entries.map((entry) => {
                    const label =
                      entry.threads[0]?.title ?? developerEntryLabel(entry);
                    return (
                      <div
                        key={entry.name}
                        className="flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          {entry.threads.length > 0 ? (
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {entry.threads.map((thread) => (
                                <button
                                  key={thread.threadId}
                                  className="text-left text-sm hover:underline"
                                  onClick={() =>
                                    navigate.toThread(thread.threadId)
                                  }
                                >
                                  {thread.title}
                                  {thread.archived && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                      archived
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="truncate text-sm">{label}</p>
                          )}
                          {entry.sourcePathState === "missing" && (
                            <p className="text-xs text-muted-foreground">
                              Checkout no longer exists
                            </p>
                          )}
                          {entry.sourcePath !== null &&
                            entry.sourcePathState === "unknown" && (
                              <p className="text-xs text-muted-foreground">
                                Could not check whether the checkout exists
                              </p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-normal tabular-nums text-muted-foreground">
                            {bytes(entry.sizeBytes)}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="-my-1.5 size-7"
                                aria-label={`Actions for ${label}`}
                              >
                                <Icon
                                  name="MoreHorizontal"
                                  className="size-4"
                                />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {entry.threads.map((thread) => (
                                <DropdownMenuItem
                                  key={thread.threadId}
                                  onSelect={() =>
                                    navigate.toThread(thread.threadId)
                                  }
                                >
                                  Open thread
                                  {entry.threads.length > 1
                                    ? `: ${thread.title}`
                                    : ""}
                                </DropdownMenuItem>
                              ))}
                              {entry.threads.length > 0 && (
                                <DropdownMenuSeparator />
                              )}
                              {entry.sourcePath !== null && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void copyPath(
                                      entry.sourcePath!,
                                      "Source checkout path",
                                    )
                                  }
                                >
                                  Copy source checkout path
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onSelect={() =>
                                  void copyPath(
                                    `${storage.path}/${entry.name}`,
                                    "Dev data path",
                                  )
                                }
                              >
                                Copy dev data path
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
        {entries.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            No entries in this category.
          </p>
        )}
        {filtered.length > 5 && (
          <div>
            <button
              className="rounded-sm text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? "Show fewer entries"
                : `Show all ${filtered.length.toLocaleString()} entries`}
            </button>
          </div>
        )}
        {copyStatus && (
          <p
            role={copyStatus.failed ? "alert" : "status"}
            className={cn(
              "text-xs",
              copyStatus.failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {copyStatus.text}
          </p>
        )}
        <p className="border-t border-border pt-3 text-xs leading-snug text-subtle-foreground/75">
          Other instances have no matching thread in this BB. Missing checkouts
          are candidates for cleanup. Stop the development server before
          removing its data.
        </p>
      </div>
    </section>
  );
}

function threadStorageBytes(report: NonNullable<HostReport["report"]>) {
  return (
    report.activeThreadBytes + report.archivedThreadBytes + report.orphanBytes
  );
}
function categories(report: NonNullable<HostReport["report"]>) {
  return [
    {
      label: "Active",
      value: report.activeThreadBytes,
      count: report.threadsWithStorageCount - report.archivedThreadCount,
    },
    {
      label: "Archived",
      value: report.archivedThreadBytes,
      count: report.archivedThreadCount,
    },
  ];
}

function StorageBreakdown({
  report,
}: {
  report: NonNullable<HostReport["report"]>;
}) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Thread storage by category</caption>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="pb-2 text-left font-normal">
            Category
          </th>
          <th scope="col" className="pb-2 pl-3 text-right font-normal">
            Count
          </th>
          <th scope="col" className="pb-2 pl-3 text-right font-normal">
            Size
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {categories(report).map((category) => (
          <tr key={category.label}>
            <th scope="row" className="py-2 text-left font-normal">
              {category.label}
            </th>
            <td className="py-2 pl-3 text-right tabular-nums text-muted-foreground">
              {category.count.toLocaleString()}
            </td>
            <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">
              {bytes(category.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({
    name: "DatabaseRestore",
    component: DatabaseRestoreIcon,
  });
  app.slots.navPanel({
    id: PANEL,
    title: "Storage & retention",
    icon: "DatabaseRestore",
    path: PANEL,
    component: StoragePanel,
  });
});
