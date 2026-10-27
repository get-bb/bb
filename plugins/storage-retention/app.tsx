import { toast } from "sonner";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  definePluginApp,
  experimental_Icon as PluginIcon,
  experimental_copyToClipboard,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { DatabaseRestoreIcon } from "./icons/database-restore.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EntryCleanupInput } from "./src/storage-types.js";
import type { storageRpc, State, Policy } from "./src/contract.js";
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
function plural(count: number, noun: string, nouns = `${noun}s`) {
  return `${count.toLocaleString()} ${count === 1 ? noun : nouns}`;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type CleanupCompletion = {
  description: string;
  freedBytes: number | null;
  removedInstances: number | null;
};
type NotifySuccess = (
  title: string,
  result: string | CleanupCompletion,
) => void;

function useStorageSuccessToast(): NotifySuccess {
  const current = useRef<{
    id: string | number;
    lastAt: number;
    count: number;
    freedBytes: number | null;
    removedInstances: number | null;
    titles: Set<string>;
  } | null>(null);
  return useCallback((title, result) => {
    const completion =
      typeof result === "string"
        ? { description: result, freedBytes: null, removedInstances: null }
        : result;
    const now = Date.now();
    const batch = current.current;
    if (batch === null || now - batch.lastAt >= 5000) {
      const next = {
        id: toast.success(title, {
          description: completion.description,
          duration: 5000,
          onDismiss: () => {
            if (current.current === next) current.current = null;
          },
          onAutoClose: () => {
            if (current.current === next) current.current = null;
          },
        }),
        lastAt: now,
        count: 1,
        freedBytes: completion.freedBytes,
        removedInstances: completion.removedInstances,
        titles: new Set([title]),
      };
      current.current = next;
      return;
    }
    batch.lastAt = now;
    batch.count++;
    batch.titles.add(title);
    batch.freedBytes =
      batch.freedBytes === null && completion.freedBytes === null
        ? null
        : (batch.freedBytes ?? 0) + (completion.freedBytes ?? 0);
    batch.removedInstances =
      batch.removedInstances === null || completion.removedInstances === null
        ? null
        : batch.removedInstances + completion.removedInstances;
    toast.success(
      batch.removedInstances === null
        ? `${plural(batch.count, "storage action")} completed`
        : `${plural(batch.removedInstances, "instance")} deleted`,
      {
        id: batch.id,
        duration: 5000,
        description: [
          ...(batch.removedInstances === null ? [...batch.titles] : []),
          ...(batch.freedBytes === null
            ? []
            : [`${bytes(batch.freedBytes)} freed`]),
        ].join(" · "),
      },
    );
  }, []);
}

type ActionFeedback = {
  completed: string;
  failed: string;
  description: string;
  id?: string;
  background?: boolean;
};
function cleanupFeedback(
  kind:
    | "development"
    | "orphans"
    | "worktrees"
    | "externalWorktrees"
    | "largeFileCleanup"
    | "archivedFileCleanup",
  hostId: string | null,
  description: string,
): ActionFeedback {
  const titles = {
    development: [
      "Development data deleted",
      "Couldn’t delete development data",
    ],
    orphans: ["Orphaned files deleted", "Couldn’t delete orphaned files"],
    worktrees: ["Checkout cleanup retried", "Couldn’t clean up checkouts"],
    externalWorktrees: ["Worktrees removed", "Couldn’t remove worktrees"],
    largeFileCleanup: [
      "Large archived files deleted",
      "Couldn’t delete large archived files",
    ],
    archivedFileCleanup: [
      "Archived thread files deleted",
      "Couldn’t delete archived thread files",
    ],
  } as const;
  const [completed, failed] = titles[kind];
  return {
    completed,
    failed,
    description,
    background: true,
    id: `storage:${hostId ?? "all"}:${kind}`,
  };
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
  const notifySuccess = useStorageSuccessToast();
  const [data, setData] = useState<StorageData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stateRevision = useRef(0);
  const refreshRevision = useRef(0);
  const updateState = useCallback((state: State) => {
    stateRevision.current++;
    setData((current) => (current === null ? null : { ...current, state }));
  }, []);
  const refresh = useCallback(async () => {
    const revision = stateRevision.current;
    const request = ++refreshRevision.current;
    try {
      const [state, reports, machines, config] = await Promise.all([
        rpc.call("state", null),
        rpc.call("hosts", null),
        sdk.hosts.list({ type: "persistent" }),
        sdk.system.config(),
      ]);
      if (request !== refreshRevision.current) return;
      setData((current) => ({
        state:
          revision === stateRevision.current || current === null
            ? state
            : current.state,
        hosts: reports.hosts,
        machines: Object.fromEntries(machines.map((host) => [host.id, host])),
        primaryHostId: config.primaryHostId,
      }));
      setLoadError(null);
    } catch (error) {
      if (request === refreshRevision.current) setLoadError(message(error));
    }
  }, [rpc, sdk]);
  const previousScans = useRef(
    new Map<string, { scannedAt: number | undefined; status: string }>(),
  );
  const previousJobs = useRef(new Map<string, string>());
  const observedHosts = useRef(new Set<string>());
  const previousRemovals = useRef(new Map<string, Map<string, string>>());
  useEffect(() => {
    for (const host of data?.hosts ?? []) {
      const previousScan = previousScans.current.get(host.hostId);
      if (previousScan) {
        const description = data?.machines[host.hostId]?.name ?? host.hostId;
        if (host.scan.state === "failed" && previousScan.status !== "failed")
          toast.error("Storage scan failed", {
            description: `${description} · ${host.scan.message}`,
          });
        else if (
          host.scan.state === "idle" &&
          host.report &&
          previousScan.scannedAt !== host.report.scannedAt
        )
          notifySuccess("Storage scan completed", description);
      }
      previousScans.current.set(host.hostId, {
        scannedAt: host.report?.scannedAt,
        status: host.scan.state,
      });
      const statuses = [
        { kind: "largeFileCleanup" as const, job: host.largeFileCleanup },
        { kind: "archivedFileCleanup" as const, job: host.archivedFileCleanup },
        ...host.maintenanceJobs.map((job) => ({
          kind: "maintenance" as const,
          job,
        })),
      ];
      for (const { kind, job } of statuses) {
        const key = `${host.hostId}:${"kind" in job ? job.kind : kind}`;
        const signature = JSON.stringify(job);
        const previous = previousJobs.current.get(key);
        if (
          observedHosts.current.has(host.hostId) &&
          previous !== signature &&
          job.state !== "idle"
        ) {
          const machine = data?.machines[host.hostId]?.name ?? host.hostId;
          const feedback = cleanupFeedback(
            "kind" in job
              ? job.kind
              : kind === "largeFileCleanup"
                ? "largeFileCleanup"
                : "archivedFileCleanup",
            host.hostId,
            machine,
          );
          if (job.state === "failed")
            toast.error(feedback.failed, {
              id: feedback.id,
              description: `${machine} · ${job.message}`,
            });
          if (job.state === "completed")
            notifySuccess(feedback.completed, {
              description: `${machine} · ${"message" in job ? job.message : `${bytes(job.clearedBytes)} freed`}`,
              freedBytes: "clearedBytes" in job ? job.clearedBytes : null,
              removedInstances: null,
            });
        }
        previousJobs.current.set(key, signature);
      }
      const seen = previousRemovals.current.get(host.hostId);
      const next = new Map<string, string>();
      for (const removal of host.externalWorktreeRemovals) {
        const signature = JSON.stringify(removal);
        next.set(removal.path, signature);
        if (seen === undefined || seen.get(removal.path) === signature)
          continue;
        const id = worktreeRemovalToastId(host.hostId, removal.path);
        if (removal.state === "completed")
          notifySuccess("Worktree removed", {
            description: `${removal.path} · ${bytes(removal.removedBytes)} freed`,
            freedBytes: removal.removedBytes,
            removedInstances: null,
          });
        else if (removal.state === "skipped" || removal.state === "failed")
          toast.error("Couldn’t remove worktree", {
            id,
            description: `${removal.path} · ${
              removal.state === "skipped"
                ? EXTERNAL_WORKTREE_SKIP_REASONS[removal.reasons[0]!]
                : removal.message
            }`,
          });
      }
      previousRemovals.current.set(host.hostId, next);
      observedHosts.current.add(host.hostId);
    }
  }, [data, notifySuccess]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("changed", refresh);
  useRealtime("policy-changed", async () => {
    const revision = stateRevision.current;
    try {
      const state = await rpc.call("state", null);
      if (revision === stateRevision.current) updateState(state);
    } catch (error) {
      toast.error("Couldn’t refresh retention settings", {
        description: message(error),
      });
    }
  });
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
        if (event.state === "connected" && event.reconnected) void refresh();
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
      notifySuccess={notifySuccess}
      updateState={updateState}
    />
  );
}

function StoragePage({
  hostId,
  data,
  loadError,
  refresh,
  updateState,
  notifySuccess,
}: {
  hostId: string | null;
  data: StorageData | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  updateState: (state: State) => void;
  notifySuccess: NotifySuccess;
}) {
  const rpc = useRpc<typeof storageRpc>();
  const navigate = useBbNavigate();
  const state = data?.state ?? null;
  const hosts = data?.hosts ?? [];
  const machines = data?.machines ?? {};
  const primaryHostId = data?.primaryHostId ?? null;
  const detail = hosts.find((host) => host.hostId === hostId) ?? null;
  const [savingSetting, setSavingSetting] = useState(false);
  const settingSavePending = useRef(false);
  const pendingActions = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  function setPendingAction(id: string, active: boolean) {
    if (active) pendingActions.current.add(id);
    else pendingActions.current.delete(id);
    setPending(new Set(pendingActions.current));
  }
  const busyActions = new Set(pending);
  for (const host of hosts) {
    const jobs = [
      { kind: "largeFileCleanup", job: host.largeFileCleanup },
      { kind: "archivedFileCleanup", job: host.archivedFileCleanup },
      ...host.maintenanceJobs.flatMap((job) =>
        "kind" in job ? [{ kind: job.kind, job }] : [],
      ),
    ];
    for (const { kind, job } of jobs) {
      if (job.state === "queued" || job.state === "running") {
        busyActions.add(`storage:${host.hostId}:${kind}`);
        busyActions.add(`storage:all:${kind}`);
      }
    }
    for (const removal of host.externalWorktreeRemovals) {
      if (removal.state === "queued" || removal.state === "running")
        busyActions.add(worktreeRemovalToastId(host.hostId, removal.path));
    }
  }
  const cleanupBusy = (kind: string) =>
    busyActions.has(`storage:${hostId ?? "all"}:${kind}`);
  const [expandedThreadsHostId, setExpandedThreadsHostId] = useState<
    string | null
  >(null);
  const policy = state?.policy ?? null;
  const [cleanup, setCleanupState] = useState<{
    key: string;
    title: string;
    detail: string;
    action: string;
    run: () => Promise<string | CleanupCompletion>;
    feedback: ActionFeedback;
  } | null>(null);
  function setCleanup(value: typeof cleanup) {
    setCleanupState(value);
  }
  async function perform<T>(
    work: () => Promise<T>,
    feedback: ActionFeedback = {
      id: `scan:${hostId ?? "all"}`,
      background: true,

      completed: "Storage scan started",
      failed: "Couldn’t start storage scan",
      description: hostId
        ? (machines[hostId]?.name ?? hostId)
        : "Online machines",
    },
    success?: (result: T) => string | CleanupCompletion,
  ) {
    const id = feedback.id ?? `scan:${hostId ?? "all"}`;
    if (pendingActions.current.has(id)) return;
    setPendingAction(id, true);
    try {
      const result = await work();
      if (!feedback.background)
        notifySuccess(
          feedback.completed,
          success?.(result) || feedback.description,
        );
      await refresh();
    } catch (error) {
      toast.error(feedback.failed, {
        id,
        description: `${feedback.description} · ${message(error)}`,
      });
    } finally {
      setPendingAction(id, false);
    }
  }
  async function runEntryCleanup(input: EntryCleanupInput) {
    const { id } = await rpc.call("startEntryCleanup", input);
    for (;;) {
      const status = await rpc.call("entryCleanup", { id });
      if (status.state === "failed") throw new Error(status.message);
      if (status.state === "completed") return status.result;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async function removeDevelopment(input: {
    hostId: string;
    names: string[];
    stopRunning: boolean;
  }) {
    const result = await runEntryCleanup({ kind: "development", ...input });
    if (result.kind !== "development")
      throw new Error("Unexpected cleanup result");
    return result;
  }
  async function saveSetting<K extends keyof Policy>(key: K, value: Policy[K]) {
    if (state === null || settingSavePending.current) return;
    const previous = state;
    const next = { ...state, policy: { ...state.policy, [key]: value } };
    settingSavePending.current = true;
    setSavingSetting(true);
    updateState(next);
    const description = {
      archiveAfterDays: "Archive inactive threads",
      deleteAfterDays: "Delete archived threads",
      deleteStorageOnArchive: "Delete thread storage on archive",
      deleteDevDataOnCheckoutRemoval:
        "Delete development data when its checkout is removed",
    }[key];
    try {
      updateState(await rpc.call("configure", next.policy));
    } catch (error) {
      updateState(previous);
      toast.error("Couldn’t save setting", {
        description: `${description} · ${message(error)}`,
      });
    } finally {
      settingSavePending.current = false;
      setSavingSetting(false);
    }
  }
  async function runRowAction(
    key: string,
    feedback: ActionFeedback,
    work: () => Promise<string | CleanupCompletion | null>,
  ) {
    const id = feedback.id ?? key;
    if (pendingActions.current.has(id)) return;
    setPendingAction(id, true);
    try {
      const description = await work();
      if (description !== null && !feedback.background)
        notifySuccess(feedback.completed, description || feedback.description);
      await refresh();
    } catch (error) {
      toast.error(feedback.failed, {
        id,
        description: `${feedback.description} · ${message(error)}`,
      });
    } finally {
      setPendingAction(id, false);
    }
  }
  const retentionOn =
    state !== null &&
    (state.policy.archiveAfterDays !== null ||
      state.policy.deleteAfterDays !== null);
  const report = detail?.report;
  const missingDev =
    report?.developerStorage?.entries.filter(
      (entry) => entry.sourcePathState === "missing" && !entry.current,
    ) ?? [];
  const externalBytes =
    report?.externalWorktrees.reduce(
      (total, worktree) => total + worktree.sizeBytes,
      0,
    ) ?? 0;
  const missingDevBytes = missingDev.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  );
  const threadsExpanded = hostId !== null && expandedThreadsHostId === hostId;
  const scanning =
    detail?.scan.state === "scanning" || pending.has(`scan:${hostId}`);
  const scanningAll =
    pending.has("scan:all") ||
    hosts.some((host) => host.scan.state === "scanning");
  const machine = hostId ? machines[hostId] : undefined;
  const offline = machine !== undefined && machine.status !== "connected";
  const locked = offline;
  function devInstancesCleanup(target: string, count: number, size: number) {
    return {
      key: "dev-instances",
      feedback: cleanupFeedback(
        "development",
        target,
        machines[target]?.name ?? target,
      ),
      action: "Remove instances",
      title: `Remove ${plural(count, "development instance")} (${bytes(size)})?`,
      detail:
        "Delete the databases, logs, and thread files of development instances whose source checkout no longer exists. Development servers still running from those checkouts are stopped first. This can’t be undone.",
      run: async () => {
        await rpc.call("startCleanup", { hostId: target, kind: "development" });
        return "Development storage cleanup started in the background.";
      },
    };
  }
  function largeFilesCleanup(target: string | null, totals: LargeFileTotals) {
    return {
      key: "large-files",
      feedback: cleanupFeedback(
        "largeFileCleanup",
        target,
        target ? (machines[target]?.name ?? target) : "All online machines",
      ),
      action: "Delete large files",
      title: `Delete ${totals.fileCount.toLocaleString()} large ${totals.fileCount === 1 ? "file" : "files"} (${bytes(totals.bytes)})?`,
      detail: `Delete files of ${bytes(LARGE_FILE_MIN_BYTES)} or more from ${plural(totals.threadCount, "archived thread")}. Smaller files and conversation history will be kept. Pinned threads are skipped. This can’t be undone.`,
      run: async () => {
        await rpc.call("startClearLargeFiles", { hostId: target });
        return "Large-file cleanup started in the background.";
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
  const suggestions =
    archivedLargeFiles.bytes >= LARGE_FILE_NUDGE_MIN_BYTES
      ? [
          {
            title: `Free up ${bytes(archivedLargeFiles.bytes)} from archived threads`,
            description: `${plural(archivedLargeFiles.fileCount, "file")} of ${bytes(LARGE_FILE_MIN_BYTES)} or more sit in the thread storage of ${plural(archivedLargeFiles.threadCount, "archived thread")}. Deleting them keeps smaller files like reports, and conversation history isn’t affected.`,
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
          {cleanup.key === "archived-files" && report
            ? `Delete ${bytes(report.archivedFiles.bytes)} of stored files from ${plural(report.archivedFiles.threadCount, "archived thread")} on this machine. Conversations and uploaded attachments are kept. Pinned and running threads are skipped. This can’t be undone.`
            : cleanup.detail}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offline || busyActions.has(cleanup.feedback.id ?? "")}
          onClick={() => setCleanup(null)}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={offline || busyActions.has(cleanup.feedback.id ?? "")}
          onClick={() =>
            void perform(
              async () => {
                const done = await cleanup.run();
                setCleanup(null);
                return done;
              },
              cleanup.feedback,
              (done) => done,
            )
          }
        >
          {busyActions.has(cleanup.feedback.id ?? "") && (
            <Icon name="Spinner" className="animate-spin" />
          )}
          {cleanup.action}
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
                disabled={scanning || offline || !detail}
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
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <p>{loadError}</p>
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
                    <p className="text-sm font-medium">
                      {report.developerStorage ? "Total" : "Thread storage"}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {bytes(
                        categories(report).reduce(
                          (total, category) => total + category.value,
                          0,
                        ),
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
                    <p title={new Date(report.scannedAt).toLocaleString()}>
                      Scanned {ago(report.scannedAt)}
                    </p>
                    {scanNotice}
                  </div>
                </section>
                <ProjectWorktrees report={report} />
                <section className="space-y-3">
                  <SectionHeading title="Clean up" />
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    <CleanupRow
                      title="All files in archived threads"
                      size={report.archivedFiles.bytes}
                      description={`Clear stored files of any size from ${plural(report.archivedFiles.threadCount, "archived thread")}. Pinned and running threads are skipped. Conversations and uploaded attachments are kept.`}
                      action="Clear archived files"
                      busy={cleanupBusy("archivedFileCleanup")}
                      disabled={
                        locked || report.archivedFiles.threadCount === 0
                      }
                      onAction={() =>
                        setCleanup({
                          key: "archived-files",
                          feedback: cleanupFeedback(
                            "archivedFileCleanup",
                            report.hostId,
                            machine?.name ?? report.hostId,
                          ),
                          title: "Clear all archived thread files?",
                          action: "Clear archived files",
                          detail: `Delete ${bytes(report.archivedFiles.bytes)} of stored files from ${plural(report.archivedFiles.threadCount, "archived thread")} on this machine. This includes small files. Conversations and uploaded attachments will be kept. Pinned and running threads are skipped. This can’t be undone.`,
                          run: async () => {
                            await rpc.call("startClearArchivedFiles", {
                              hostId: report.hostId,
                            });
                            return "Archived-file cleanup started in the background.";
                          },
                        })
                      }
                    >
                      {cleanup?.key === "archived-files" && cleanupConfirmation}
                    </CleanupRow>
                    <CleanupRow
                      title="Large files in archived threads"
                      size={report.archivedLargeFiles.bytes}
                      description={
                        report.archivedLargeFiles.fileCount
                          ? `${plural(report.archivedLargeFiles.fileCount, "file")} of ${bytes(LARGE_FILE_MIN_BYTES)} or more across ${plural(report.archivedLargeFiles.threadCount, "archived thread")}. Smaller files and conversation history are kept.`
                          : `No files of ${bytes(LARGE_FILE_MIN_BYTES)} or more in archived threads.`
                      }
                      action="Delete large files"
                      busy={cleanupBusy("largeFileCleanup")}
                      disabled={
                        locked || report.archivedLargeFiles.fileCount === 0
                      }
                      onAction={() =>
                        setCleanup(
                          largeFilesCleanup(
                            report.hostId,
                            report.archivedLargeFiles,
                          ),
                        )
                      }
                    >
                      {cleanup?.key === "large-files" && cleanupConfirmation}
                    </CleanupRow>
                    <CleanupRow
                      title="Orphaned storage"
                      size={report.orphanBytes}
                      description="Files left behind by deleted threads. BB cleans these up automatically while idle."
                      action="Remove orphans"
                      busy={cleanupBusy("orphans")}
                      disabled={locked || report.orphanCount === 0}
                      onAction={() =>
                        setCleanup({
                          key: "orphans",
                          feedback: cleanupFeedback(
                            "orphans",
                            report.hostId,
                            machine?.name ?? report.hostId,
                          ),
                          action: "Remove orphans",
                          title: `Remove ${bytes(report.orphanBytes)} of orphaned storage?`,
                          detail:
                            "Delete folders no longer attached to a thread. Existing threads and their files will be kept. This can’t be undone.",
                          run: async () => {
                            await rpc.call("startCleanup", {
                              kind: "orphans",
                              hostId: report.hostId,
                            });
                            return "Orphan cleanup started in the background.";
                          },
                        })
                      }
                    >
                      {cleanup?.key === "orphans" && cleanupConfirmation}
                    </CleanupRow>
                    <CleanupRow
                      title="Leftover worktrees"
                      size={report.leftoverWorktreeBytes}
                      description="Checkouts BB could not remove after their threads were archived. BB retries automatically."
                      action="Retry cleanup"
                      busy={cleanupBusy("worktrees")}
                      disabled={locked || report.leftoverWorktrees.length === 0}
                      onAction={() =>
                        void perform(
                          async () => {
                            await rpc.call("startCleanup", {
                              kind: "worktrees",
                              hostId,
                            });
                          },
                          cleanupFeedback(
                            "worktrees",
                            hostId,
                            machine?.name ?? hostId ?? "Machine",
                          ),
                        )
                      }
                    >
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
                    </CleanupRow>
                    <CleanupRow
                      title="Worktrees created outside BB"
                      size={externalBytes}
                      description="Git worktrees of your projects that BB didn’t create, such as ones agents added with git worktree add. Removing them keeps their branches. Bulk removal keeps worktrees with uncommitted changes, locked worktrees, and detached worktrees with commits on no branch; remove those one at a time."
                      action="Remove worktrees"
                      busy={cleanupBusy("externalWorktrees")}
                      disabled={locked || report.externalWorktrees.length === 0}
                      onAction={() =>
                        setCleanup({
                          key: "external-worktrees",
                          feedback: cleanupFeedback(
                            "externalWorktrees",
                            report.hostId,
                            machine?.name ?? report.hostId,
                          ),
                          action: "Remove worktrees",
                          title: `Remove ${plural(report.externalWorktrees.length, "worktree")} created outside BB (${bytes(externalBytes)})?`,
                          detail:
                            "Delete these checkouts, including ignored files such as dependencies, build output, and local env files. Branches and commits stay in the repository. Worktrees with uncommitted changes, locked worktrees, and detached worktrees with commits on no branch are kept; remove those one at a time. Make sure no agent is still working in them. This can’t be undone.",
                          run: async () => {
                            await rpc.call("startCleanup", {
                              kind: "externalWorktrees",
                              hostId: report.hostId,
                            });
                            return "Worktree removal started in the background.";
                          },
                        })
                      }
                    >
                      {cleanup?.key === "external-worktrees" &&
                        cleanupConfirmation}
                      {report.externalWorktrees.length > 0 && (
                        <ExternalWorktrees
                          worktrees={report.externalWorktrees}
                          projectNames={
                            new Map(
                              report.projectWorktrees.map((project) => [
                                project.projectId,
                                project.projectName,
                              ]),
                            )
                          }
                          isRemoving={(path) =>
                            busyActions.has(
                              worktreeRemovalToastId(report.hostId, path),
                            )
                          }
                          rowDisabled={locked}
                          confirmationKey={cleanup?.key ?? null}
                          confirmation={cleanupConfirmation}
                          onRemove={(worktree, label) => {
                            const feedback = {
                              completed: "Worktree removed",
                              failed: "Couldn’t remove worktree",
                              description: worktree.path,
                              id: worktreeRemovalToastId(
                                report.hostId,
                                worktree.path,
                              ),
                              background: true,
                            };
                            const start = (force: boolean) =>
                              rpc.call("startRemoveExternalWorktree", {
                                hostId: report.hostId,
                                path: worktree.path,
                                force,
                              });
                            void runRowAction(
                              `worktree:${worktree.path}`,
                              feedback,
                              async () => {
                                const result = await start(false);
                                if (result.state === "started")
                                  return worktree.path;
                                const forceable = result.reasons.filter(
                                  (reason) =>
                                    reason === "locked" ||
                                    reason === "uncommittedChanges" ||
                                    reason === "unsavedCommits",
                                );
                                if (forceable.length !== result.reasons.length)
                                  throw new Error(
                                    EXTERNAL_WORKTREE_SKIP_REASONS[
                                      result.reasons[0]!
                                    ],
                                  );
                                setCleanup({
                                  key: `external-worktree:${worktree.path}`,
                                  feedback,
                                  action: "Remove anyway",
                                  title: `Remove “${label}” anyway (${bytes(worktree.sizeBytes)})?`,
                                  detail: [
                                    ...forceable.map(
                                      (reason) =>
                                        EXTERNAL_WORKTREE_FORCE_WARNINGS[
                                          reason
                                        ],
                                    ),
                                    "The checkout is deleted, including ignored files. Its branch is kept. This can’t be undone.",
                                  ].join(" "),
                                  run: async () => {
                                    const forced = await start(true);
                                    if (forced.state === "skipped")
                                      throw new Error(
                                        EXTERNAL_WORKTREE_SKIP_REASONS[
                                          forced.reasons[0]!
                                        ],
                                      );
                                    return worktree.path;
                                  },
                                });
                                return null;
                              },
                            );
                          }}
                        />
                      )}
                    </CleanupRow>
                    {report.developerStorage && (
                      <CleanupRow
                        title="Development instances without a checkout"
                        size={missingDevBytes}
                        description={`${plural(missingDev.length, "development instance")} in ~/.bb-dev whose source checkout no longer exists. Servers still running from them are stopped before removal.`}
                        action="Remove instances"
                        busy={cleanupBusy("development")}
                        disabled={locked || missingDev.length === 0}
                        onAction={() =>
                          setCleanup(
                            devInstancesCleanup(
                              report.hostId,
                              missingDev.length,
                              missingDevBytes,
                            ),
                          )
                        }
                      >
                        {cleanup?.key === "dev-instances" &&
                          cleanupConfirmation}
                      </CleanupRow>
                    )}
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
                    {(threadsExpanded
                      ? report.largestThreads
                      : report.largestThreads.slice(0, PREVIEW_COUNT)
                    ).map((thread) => {
                      return (
                        <div
                          key={thread.threadId}
                          className="flex items-start justify-between gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <ThreadTitle
                              title={thread.title}
                              pills={[
                                ...(thread.hidden ? ["hidden"] : []),
                                ...(thread.pinned ? ["pinned"] : []),
                                ...(thread.running
                                  ? ["running"]
                                  : thread.archivedAt !== null
                                    ? ["archived"]
                                    : []),
                              ]}
                              onOpen={() => navigate.toThread(thread.threadId)}
                            />
                          </div>
                          <div className="flex h-5 shrink-0 items-center gap-2">
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {bytes(thread.sizeBytes)}
                            </span>
                            <RowActionButton
                              busy={busyActions.has(
                                `storage:thread:${thread.threadId}`,
                              )}
                              label="Clear files"
                              target={thread.title}
                              disabled={locked || thread.running}
                              onClick={() =>
                                void runRowAction(
                                  thread.threadId,
                                  {
                                    id: `storage:thread:${thread.threadId}`,

                                    completed: "Thread files deleted",
                                    failed: "Couldn’t delete thread files",
                                    description: thread.title,
                                  },
                                  async () => {
                                    await runEntryCleanup({
                                      kind: "thread",
                                      threadId: thread.threadId,
                                    });
                                    return thread.title;
                                  },
                                )
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                    {report.largestThreads.length > PREVIEW_COUNT && (
                      <div className="px-4 py-2.5">
                        <ShowMoreToggle
                          expanded={threadsExpanded}
                          total={report.largestThreads.length}
                          onToggle={() =>
                            setExpandedThreadsHostId(
                              threadsExpanded ? null : hostId,
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                </section>
                {report.developerStorage && (
                  <DeveloperStorage
                    storage={report.developerStorage}
                    isRemoving={(name) =>
                      busyActions.has(developmentToastId(report.hostId, [name]))
                    }
                    rowDisabled={locked}
                    confirmationKey={cleanup?.key ?? null}
                    confirmation={cleanupConfirmation}
                    onRemoveSelected={(entries) => {
                      const size = entries.reduce(
                        (total, entry) => total + entry.sizeBytes,
                        0,
                      );
                      const running = entries.filter(
                        (entry) => entry.running,
                      ).length;
                      setCleanup({
                        key: "dev-selected",
                        feedback: {
                          id: developmentToastId(
                            report.hostId,
                            entries.map((entry) => entry.name),
                          ),

                          completed: "Development data deleted",
                          failed: "Couldn’t delete development data",
                          description: plural(
                            entries.length,
                            "development instance",
                          ),
                        },
                        action: "Remove instances",
                        title: `Remove ${plural(entries.length, "development instance")} (${bytes(size)})?`,
                        detail: `Delete their databases, logs, and thread files. Source checkouts are kept.${running > 0 ? ` ${plural(running, "dev server")} running at the last scan ${running === 1 ? "is" : "are"} stopped first.` : ""} This can’t be undone.`,
                        run: async () => {
                          let removedCount = 0;
                          let removedBytes = 0;
                          for (
                            let offset = 0;
                            offset < entries.length;
                            offset += 500
                          ) {
                            const result = await removeDevelopment({
                              hostId: report.hostId,
                              names: entries
                                .slice(offset, offset + 500)
                                .map((entry) => entry.name),
                              stopRunning: true,
                            });
                            removedCount += result.removedCount;
                            removedBytes += result.removedBytes;
                          }

                          return {
                            description: `${plural(removedCount, "instance")} removed · ${bytes(removedBytes)} freed`,
                            freedBytes: removedBytes,
                            removedInstances: removedCount,
                          };
                        },
                      });
                    }}
                    onRemove={(entry, label) =>
                      void runRowAction(
                        `dev:${entry.name}`,
                        {
                          id: developmentToastId(report.hostId, [entry.name]),

                          completed: "Development data deleted",
                          failed: "Couldn’t delete development data",
                          description: `${report.developerStorage!.path}/${entry.name}`,
                        },
                        async () => {
                          const result = await removeDevelopment({
                            hostId: report.hostId,
                            names: [entry.name],
                            stopRunning: false,
                          });
                          if (result.running.length > 0)
                            setCleanup({
                              key: `dev-instance:${entry.name}`,
                              feedback: {
                                id: developmentToastId(report.hostId, [
                                  entry.name,
                                ]),

                                completed: "Development data deleted",
                                failed: "Couldn’t delete development data",
                                description: `${report.developerStorage!.path}/${entry.name}`,
                              },
                              action: "Stop and remove",
                              title: `Stop and remove “${label}” (${bytes(entry.sizeBytes)})?`,
                              detail:
                                "Its dev server is running. BB will stop it, then delete its database, logs, and thread files. The source checkout is kept. This can’t be undone.",
                              run: async () => {
                                const stopped = await removeDevelopment({
                                  hostId: report.hostId,
                                  names: [entry.name],
                                  stopRunning: true,
                                });

                                return {
                                  description: `${report.developerStorage!.path}/${entry.name} · ${bytes(stopped.removedBytes)} freed`,
                                  freedBytes: stopped.removedBytes,
                                  removedInstances: stopped.removedCount,
                                };
                              },
                            });
                          else
                            return {
                              description: `${report.developerStorage!.path}/${entry.name} · ${bytes(result.removedBytes)} freed`,
                              freedBytes: result.removedBytes,
                              removedInstances: result.removedCount,
                            };
                          return null;
                        },
                      )
                    }
                  />
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
                      archivedLargeFiles.fileCount === 0 ||
                      cleanupBusy("largeFileCleanup")
                    }
                    aria-busy={cleanupBusy("largeFileCleanup")}
                    onClick={() => setCleanup(suggestion.cleanup)}
                  >
                    {cleanupBusy("largeFileCleanup") && (
                      <Icon name="Spinner" className="animate-spin" />
                    )}
                    {suggestion.action}
                  </Button>
                </div>
                {cleanup?.key === suggestion.cleanup.key && cleanupConfirmation}
              </div>
            ))}
            <section className="space-y-3">
              <SectionHeading
                title="Machine storage"
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={scannable.length === 0 || scanningAll}
                    onClick={() =>
                      void perform(() => rpc.call("scanAll", null))
                    }
                  >
                    <Icon
                      name="RotateCcw"
                      className={scanningAll ? "animate-spin" : ""}
                    />
                    {scanningAll ? "Scanning…" : "Scan all"}
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
                    pendingScan={
                      pending.has(`scan:${host.hostId}`) ||
                      pending.has("scan:all")
                    }
                    host={host}
                    machine={machines[host.hostId]}
                    server={host.hostId === primaryHostId}
                    onOpen={() =>
                      navigate.toPluginPanel(PANEL, { subPath: host.hostId })
                    }
                    onScan={() =>
                      void perform(
                        () => rpc.call("scanHost", { hostId: host.hostId }),
                        {
                          id: `scan:${host.hostId}`,
                          background: true,

                          completed: "Storage scan started",
                          failed: "Couldn’t start storage scan",
                          description:
                            machines[host.hostId]?.name ?? host.hostId,
                        },
                      )
                    }
                  />
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <SectionHeading
                title="Automatic retention"
                description="Archive or delete inactive threads across all projects. Changes save automatically."
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
              {policy && (
                <div className="divide-y divide-border rounded-lg border border-border bg-card">
                  <RetentionField
                    label="Archive inactive threads"
                    description="After this long with no activity."
                    presets={ARCHIVE_PRESETS}
                    value={policy.archiveAfterDays}
                    disabled={savingSetting}
                    onChange={(value) =>
                      void saveSetting("archiveAfterDays", value)
                    }
                  />
                  <RetentionField
                    label="Delete archived threads"
                    description="Permanently, after this long in the archive."
                    presets={DELETE_PRESETS}
                    value={policy.deleteAfterDays}
                    disabled={savingSetting}
                    onChange={(value) =>
                      void saveSetting("deleteAfterDays", value)
                    }
                  />
                  <label className="flex items-center justify-between gap-4 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">
                        Delete thread storage on archive
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Permanently remove files after archiving. Conversations
                        and uploaded attachments are kept. Pinned threads are
                        skipped.
                      </span>
                    </span>
                    <Switch
                      aria-label="Delete thread storage on archive"
                      checked={policy.deleteStorageOnArchive}
                      disabled={savingSetting}
                      onCheckedChange={(checked) =>
                        void saveSetting("deleteStorageOnArchive", checked)
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 px-4 py-3">
                    <span>
                      <span className="block text-sm font-medium">
                        Delete development data when its checkout is removed
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        After scans, remove ~/.bb-dev folders with missing
                        checkouts and stop their servers. Checks run hourly,
                        including for existing development data.
                      </span>
                    </span>
                    <Switch
                      aria-label="Delete development data when its checkout is removed"
                      checked={policy.deleteDevDataOnCheckoutRemoval}
                      disabled={savingSetting}
                      onCheckedChange={(checked) =>
                        void saveSetting(
                          "deleteDevDataOnCheckoutRemoval",
                          checked,
                        )
                      }
                    />
                  </label>
                  {(state.lastRun || retentionOn) && (
                    <div className="px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">
                        {state.lastRun
                          ? `Last checked ${ago(state.lastRun.ranAt)} · ${state.lastRun.archivedCount} archived · ${state.lastRun.deletedCount} deleted${state.lastRun.failedCount ? ` · ${state.lastRun.failedCount} failed` : ""}`
                          : "The first check runs within the hour."}
                      </p>
                    </div>
                  )}
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

function Pill({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function ThreadTitle({
  title,
  pills,
  onOpen,
}: {
  title: string;
  pills: string[];
  onOpen: () => void;
}) {
  return (
    <button
      className="group min-w-0 break-words text-left text-sm font-normal"
      title={title}
      onClick={onOpen}
    >
      <span className="group-hover:underline">{title}</span>
      {pills.map((pill) => (
        <Fragment key={pill}>
          {" "}
          <Pill className="inline-block whitespace-nowrap align-middle">
            {pill}
          </Pill>
        </Fragment>
      ))}
    </button>
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

function CleanupRow({
  title,
  size,
  description,
  action,
  disabled,
  busy,
  onAction,
  children,
}: {
  title: string;
  size: number;
  description: string;
  action: string;
  disabled: boolean;
  busy: boolean;
  onAction: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-normal">
            {title}
            {size > 0 && " "}
            <StorageSize value={size} />
          </p>
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          aria-busy={busy}
          onClick={onAction}
        >
          {busy && <Icon name="Spinner" className="animate-spin" />}
          {action}
        </Button>
      </div>
      {children}
    </div>
  );
}

function StorageSize({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className="inline-flex whitespace-nowrap rounded-md bg-muted/50 px-1.5 py-0.5 text-xs font-normal tabular-nums text-muted-foreground">
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
  onOpen,
  onScan,
  pendingScan,
}: {
  host: Hosts[number];
  machine: Machine | undefined;
  server: boolean;
  onOpen: () => void;
  onScan: () => void;
  pendingScan: boolean;
}) {
  const report = host.report;
  const scanning = pendingScan || host.scan.state === "scanning";
  const name = machine?.name ?? host.hostId;
  const scanState = scanning
    ? "scanning…"
    : host.scan.state === "failed"
      ? "scan failed"
      : report
        ? `scanned ${ago(report.scannedAt)}`
        : "not scanned";
  const usage = report
    ? [
        `${bytes(threadStorageBytes(report))} in ${plural(report.threadsWithStorageCount, "thread")}`,
        ...(report.developerStorage
          ? [
              `${bytes(report.developerStorage.sizeBytes)} in ${plural(report.developerStorage.entries.length, "dev instance")}`,
            ]
          : []),
        ...(report.disk ? [`${bytes(report.disk.freeBytes)} free`] : []),
      ]
    : [];
  return (
    <div
      className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
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
            {name}
          </button>
          {server && <Pill>server</Pill>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-subtle-foreground/75">
          {machine && <MachineStatus machine={machine} />}
          <span aria-hidden>·</span>
          <span>{scanState}</span>
        </span>
        {usage.length > 0 && (
          <span className="block text-xs tabular-nums text-subtle-foreground/75">
            {usage.map((item, index) => (
              <span key={item}>
                <span className="whitespace-nowrap">
                  {item}
                  {index < usage.length - 1 && "\u00a0·"}
                </span>
                {index < usage.length - 1 && " "}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="-my-1 flex shrink-0 items-center gap-1">
        {report && (
          <span className="mr-1 text-sm font-medium tabular-nums">
            {bytes(
              threadStorageBytes(report) +
                (report.developerStorage?.sizeBytes ?? 0),
            )}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`${report ? "Rescan" : "Scan"} ${name}`}
          disabled={scanning || machine?.status !== "connected"}
          onClick={onScan}
        >
          <Icon
            name="RotateCcw"
            className={cn("size-4", scanning && "animate-spin")}
          />
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
        description="BB worktrees are the managed checkouts BB tracks. Other worktrees were added to the same repositories outside BB, for example by agents running git worktree add. Projects with a source here are included even when they have no worktrees. These counts are separate from thread files."
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-card px-4 py-2">
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
                <th
                  scope="col"
                  className="w-full py-2 text-left align-bottom font-normal"
                >
                  Project
                </th>
                <th
                  scope="col"
                  className="py-2 pl-3 text-right align-bottom font-normal sm:whitespace-nowrap sm:pl-6"
                >
                  BB worktrees
                </th>
                <th
                  scope="col"
                  className="py-2 pl-3 text-right align-bottom font-normal sm:whitespace-nowrap sm:pl-6"
                >
                  Other worktrees
                </th>
                <th
                  scope="col"
                  className="py-2 pl-3 text-right align-bottom font-normal sm:whitespace-nowrap sm:pl-6"
                >
                  Awaiting cleanup
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.projectWorktrees.map((project) => (
                <tr key={project.projectId}>
                  <th
                    scope="row"
                    className="py-3 text-left align-top font-normal break-words"
                  >
                    {project.projectName}
                  </th>
                  <td className="whitespace-nowrap py-3 pl-3 text-right align-top font-normal tabular-nums sm:pl-6">
                    {project.worktreeCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-3 text-right align-top font-normal tabular-nums sm:pl-6">
                    {project.externalCount.toLocaleString()}
                    {project.externalBytes > 0 && (
                      <span className="block text-muted-foreground">
                        {bytes(project.externalBytes)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-3 text-right align-top tabular-nums text-muted-foreground sm:pl-6">
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

type ExternalWorktree = NonNullable<
  HostReport["report"]
>["externalWorktrees"][number];

function developmentToastId(hostId: string, names: string[]) {
  return `storage:${hostId}:dev:${JSON.stringify([...names].sort())}`;
}

function worktreeRemovalToastId(hostId: string, worktreePath: string) {
  return `storage:${hostId}:worktree:${worktreePath}`;
}

const EXTERNAL_WORKTREE_SKIP_REASONS = {
  notWorktree: "It is no longer a worktree of this repository",
  locked: "The worktree is locked",
  uncommittedChanges: "The worktree has uncommitted changes",
  unsavedCommits: "The worktree has commits that are not on any branch",
  inUseByBb: "A BB environment now uses this worktree",
} as const;

const EXTERNAL_WORKTREE_FORCE_WARNINGS = {
  locked:
    "It is locked, which usually means a tool or agent still relies on it.",
  uncommittedChanges: "Its uncommitted and untracked changes are deleted.",
  unsavedCommits:
    "Its commits that aren’t on any branch or tag become unreachable, and git deletes them in a later cleanup.",
} as const;

function externalWorktreeWarnings(worktree: ExternalWorktree) {
  return [
    ...(worktree.changedFileCount
      ? [plural(worktree.changedFileCount, "uncommitted change")]
      : []),
    ...(worktree.unsavedCommitCount
      ? [`${plural(worktree.unsavedCommitCount, "commit")} on no branch`]
      : []),
  ];
}

function ExternalWorktrees({
  worktrees,
  projectNames,
  rowDisabled,
  isRemoving,
  confirmationKey,
  confirmation,
  onRemove,
}: {
  worktrees: ExternalWorktree[];
  projectNames: ReadonlyMap<string, string>;
  rowDisabled: boolean;
  isRemoving: (key: string) => boolean;
  confirmationKey: string | null;
  confirmation: ReactNode;
  onRemove: (worktree: ExternalWorktree, label: string) => void;
}) {
  const navigate = useBbNavigate();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const groups = new Map<string, ExternalWorktree[]>();
  for (const worktree of worktrees)
    groups.set(worktree.repositoryPath, [
      ...(groups.get(worktree.repositoryPath) ?? []),
      worktree,
    ]);
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">
        {plural(worktrees.length, "worktree")} found
      </summary>
      <div className="mt-3 space-y-4">
        {[...groups].map(([repositoryPath, group]) => (
          <div key={repositoryPath} className="space-y-2">
            <h3 className="break-all">
              <span className="font-medium text-foreground">
                {projectNames.get(group[0]!.projectId) ?? "Unknown project"}
              </span>{" "}
              · {repositoryPath}{" "}
              <span className="tabular-nums">({group.length})</span>
            </h3>
            {(expanded.has(repositoryPath)
              ? group
              : group.slice(0, PREVIEW_COUNT)
            ).map((worktree) => {
              const label =
                worktree.branch ??
                worktree.path.split(/[\\/]/).filter(Boolean).at(-1) ??
                worktree.path;
              const thread = worktree.threads[0];
              const warnings = externalWorktreeWarnings(worktree);
              return (
                <div
                  key={worktree.path}
                  className="space-y-3 border-l border-border pl-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm text-foreground">
                        {label}
                        {worktree.locked && (
                          <>
                            {" "}
                            <Pill className="inline-block align-middle">
                              locked
                            </Pill>
                          </>
                        )}
                      </p>
                      <p className="break-all">{worktree.path}</p>
                      {warnings.length > 0 && (
                        <p className="text-foreground">
                          {warnings.join(" · ")}
                        </p>
                      )}
                      {(worktree.lastActivityAt !== null || thread) && (
                        <p>
                          {worktree.lastActivityAt !== null &&
                            `Last git activity ${ago(worktree.lastActivityAt)}`}
                          {worktree.lastActivityAt !== null && thread && " · "}
                          {thread && (
                            <button
                              className="hover:text-foreground hover:underline"
                              onClick={() => navigate.toThread(thread.threadId)}
                            >
                              {thread.title}
                              {thread.archived && " (archived)"}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex h-5 shrink-0 items-center gap-2">
                      <span className="tabular-nums">
                        {bytes(worktree.sizeBytes)}
                      </span>
                      <RowActionButton
                        busy={isRemoving(worktree.path)}
                        label="Remove worktree"
                        target={label}
                        disabled={rowDisabled}
                        onClick={() => onRemove(worktree, label)}
                      />
                    </div>
                  </div>
                  {confirmationKey === `external-worktree:${worktree.path}` &&
                    confirmation}
                </div>
              );
            })}
            {group.length > PREVIEW_COUNT && (
              <ShowMoreToggle
                expanded={expanded.has(repositoryPath)}
                total={group.length}
                onToggle={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (!next.delete(repositoryPath)) next.add(repositoryPath);
                    return next;
                  })
                }
              />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function RowActionButton({
  label,
  target,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  target: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-my-1.5 size-7 text-muted-foreground hover:text-destructive"
            aria-label={`${label}: ${target}`}
            disabled={disabled || busy}
            aria-busy={busy}
            onClick={onClick}
          >
            <Icon
              name={busy ? "Spinner" : "Trash2"}
              className={cn("size-4", busy && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

const PREVIEW_COUNT = 5;

function ShowMoreToggle({
  expanded,
  total,
  onToggle,
  className,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "block rounded-sm text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded
        ? "Show fewer"
        : `Show ${(total - PREVIEW_COUNT).toLocaleString()} more`}
    </button>
  );
}

function DeveloperStorage({
  storage,
  rowDisabled,
  isRemoving,
  confirmationKey,
  confirmation,
  onRemove,
  onRemoveSelected,
}: {
  storage: NonNullable<NonNullable<HostReport["report"]>["developerStorage"]>;
  rowDisabled: boolean;
  isRemoving: (key: string) => boolean;
  confirmationKey: string | null;
  confirmation: ReactNode;
  onRemove: (entry: DeveloperEntry, label: string) => void;
  onRemoveSelected: (entries: DeveloperEntry[]) => void;
}) {
  const navigate = useBbNavigate();
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
  const archived = storage.entries.filter(
    (entry) =>
      entry.threads.length > 0 &&
      entry.threads.every((thread) => thread.archived),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedEntries = storage.entries.filter((entry) =>
    selected.has(entry.name),
  );
  const setSelection = (entries: DeveloperEntry[], checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const entry of entries)
        if (checked && !entry.current) next.add(entry.name);
        else next.delete(entry.name);
      return next;
    });
  const selectable = (entries: DeveloperEntry[]) =>
    entries.filter((entry) => !entry.current);
  const filtered =
    filter === "missing"
      ? missing
      : filter === "archived"
        ? archived
        : filter === "unlinked"
          ? unlinked
          : filter === "unresolved"
            ? unresolved
            : storage.entries;
  const groups = [
    {
      title: "Linked threads",
      description: null,
      entries: filtered.filter((entry) => entry.threads.length > 0),
    },
    {
      title: "Other instances",
      description: "No matching thread in this BB",
      entries: filtered.filter(
        (entry) => entry.sourcePath !== null && entry.threads.length === 0,
      ),
    },
    {
      title: "Unidentified sources",
      description: "Source checkout could not be determined",
      entries: filtered.filter((entry) => entry.sourcePath === null),
    },
  ];
  const toggleGroup = (title: string) =>
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (!next.delete(title)) next.add(title);
      return next;
    });
  const copyPath = async (value: string, label: string) => {
    if (await experimental_copyToClipboard({ text: value })) {
      setCopyStatus({ text: `${label} copied`, failed: false });
    } else {
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
              setExpandedGroups(new Set());
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
              <SelectItem value="archived">
                Archived threads only ({archived.length})
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
        {selectedEntries.length > 0 && (
          <div className="space-y-3">
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
            >
              <p className="text-xs tabular-nums">
                {plural(selectedEntries.length, "instance")} selected ·{" "}
                {bytes(
                  selectedEntries.reduce(
                    (total, entry) => total + entry.sizeBytes,
                    0,
                  ),
                )}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rowDisabled}
                  onClick={() => onRemoveSelected(selectedEntries)}
                >
                  Remove selected
                </Button>
              </div>
            </div>
            {confirmationKey === "dev-selected" && confirmation}
          </div>
        )}
        <div className="divide-y divide-border border-t border-border">
          {groups
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <div key={group.title} className="py-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    aria-label={`Select all ${group.title.toLowerCase()}`}
                    checked={
                      selectable(group.entries).length > 0 &&
                      selectable(group.entries).every((entry) =>
                        selected.has(entry.name),
                      )
                        ? true
                        : group.entries.some((entry) =>
                              selected.has(entry.name),
                            )
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      setSelection(selectable(group.entries), checked === true)
                    }
                    disabled={selectable(group.entries).length === 0}
                  />
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {group.title}{" "}
                    <span className="font-normal tabular-nums text-muted-foreground">
                      ({group.entries.length.toLocaleString()})
                    </span>
                    {group.description && (
                      <span className="font-normal text-subtle-foreground/75">
                        {" "}
                        · {group.description}
                      </span>
                    )}
                  </h3>
                </div>
                <div className="mt-2 space-y-3">
                  {(expandedGroups.has(group.title)
                    ? group.entries
                    : group.entries.slice(0, PREVIEW_COUNT)
                  ).map((entry) => {
                    const primary = entry.threads[0];
                    const label = primary?.title ?? developerEntryLabel(entry);
                    return (
                      <div key={entry.name} className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <Checkbox
                            className="mt-0.5"
                            aria-label={`Select ${label}`}
                            disabled={entry.current}
                            checked={selected.has(entry.name)}
                            onCheckedChange={(checked) =>
                              setSelection([entry], checked === true)
                            }
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            {primary ? (
                              <ThreadTitle
                                title={primary.title}
                                pills={primary.archived ? ["archived"] : []}
                                onOpen={() =>
                                  navigate.toThread(primary.threadId)
                                }
                              />
                            ) : (
                              <p className="truncate text-sm">{label}</p>
                            )}
                            {entry.threads.length > 1 && (
                              <p className="text-xs text-muted-foreground">
                                Also linked to{" "}
                                {plural(
                                  entry.threads.length - 1,
                                  "other thread",
                                )}
                              </p>
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
                            {entry.current ? (
                              <p className="text-xs text-muted-foreground">
                                This BB is running from this instance
                              </p>
                            ) : (
                              entry.running &&
                              entry.sourcePathState !== "missing" && (
                                <p className="text-xs text-muted-foreground">
                                  Dev server running at last scan
                                </p>
                              )
                            )}
                          </div>
                          <div className="flex h-5 shrink-0 items-center gap-2">
                            <span className="text-xs font-normal tabular-nums text-muted-foreground">
                              {bytes(entry.sizeBytes)}
                            </span>
                            <RowActionButton
                              busy={isRemoving(entry.name)}
                              label="Remove instance"
                              target={label}
                              disabled={rowDisabled || entry.current}
                              onClick={() => onRemove(entry, label)}
                            />
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
                        {confirmationKey === `dev-instance:${entry.name}` &&
                          confirmation}
                      </div>
                    );
                  })}
                </div>
                {group.entries.length > PREVIEW_COUNT && (
                  <ShowMoreToggle
                    className="mt-3"
                    expanded={expandedGroups.has(group.title)}
                    total={group.entries.length}
                    onToggle={() => toggleGroup(group.title)}
                  />
                )}
              </div>
            ))}
        </div>
        {filtered.length === 0 && (
          <p className="py-4 text-xs text-muted-foreground">
            No entries in this category.
          </p>
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
  const threads = report.developerStorage ? " threads" : "";
  return [
    {
      label: `Active${threads}`,
      value: report.activeThreadBytes,
      count: report.threadsWithStorageCount - report.archivedThreadCount,
    },
    {
      label: `Archived${threads}`,
      value: report.archivedThreadBytes,
      count: report.archivedThreadCount,
    },
    ...(report.orphanBytes > 0
      ? [
          {
            label: "Orphaned",
            value: report.orphanBytes,
            count: report.orphanCount,
          },
        ]
      : []),
    ...(report.developerStorage
      ? [
          {
            label: "BB development",
            value: report.developerStorage.sizeBytes,
            count: report.developerStorage.entries.length,
          },
        ]
      : []),
  ];
}

function StorageBreakdown({
  report,
}: {
  report: NonNullable<HostReport["report"]>;
}) {
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Storage by category</caption>
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
