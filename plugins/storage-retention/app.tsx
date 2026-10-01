import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { storageRpc, State, Policy, Preview } from "./src/contract.js";

type HostReport = import("./src/storage-types.js").HostStorageResponse;
type Hosts = import("./src/storage-types.js").HostStorageListResponse["hosts"];
type Machine = Awaited<
  ReturnType<ReturnType<typeof useSdk>["hosts"]["list"]>
>[number];
const PANEL = "storage";
const ARCHIVE_PRESETS = [7, 14, 30, 60, 90, 180, 365];
const DELETE_PRESETS = [7, 30, 90, 180, 365];
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** index).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][index]}`;
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
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function StoragePanel(props: PluginNavPanelProps) {
  return <StoragePage key={props.subPath} {...props} />;
}

function StoragePage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof storageRpc>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State | null>(null);
  const [hosts, setHosts] = useState<Hosts>([]);
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [detail, setDetail] = useState<HostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const policy = draft ?? state?.policy ?? null;
  const [confirmation, setConfirmation] = useState<{
    policy: Policy;
    preview: Preview;
  } | null>(null);
  const [cleanup, setCleanup] = useState<{
    threadId: string | null;
    title: string;
  } | null>(null);
  const hostId = subPath || null;
  const refresh = useCallback(async () => {
    try {
      const [next, reports, machines, machine] = await Promise.all([
        rpc.call("state", null),
        rpc.call("hosts", null),
        sdk.hosts.list({ type: "persistent" }),
        hostId ? rpc.call("host", { hostId }) : Promise.resolve(null),
      ]);
      setState(next);
      setHosts(reports.hosts);
      setMachines(Object.fromEntries(machines.map((host) => [host.id, host])));
      setDetail(machine);
    } catch (error) {
      setError(message(error));
    }
  }, [rpc, sdk, hostId]);
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
  async function perform(work: () => Promise<unknown>, success?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await work();
      await refresh();
      if (success) setNotice(success);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function preview(policy: Policy) {
    setConfirmation(null);
    await perform(async () => {
      setConfirmation({ policy, preview: await rpc.call("preview", policy) });
    });
  }
  const report = detail?.report;
  const scanning = detail?.scan.state === "scanning";
  const machine = hostId ? machines[hostId] : undefined;
  const offline = machine !== undefined && machine.status !== "connected";
  const locked = busy || scanning || offline;
  const changed =
    state !== null &&
    policy !== null &&
    (policy.archiveAfterDays !== state.policy.archiveAfterDays ||
      policy.deleteAfterDays !== state.policy.deleteAfterDays);
  const cleanupConfirmation = cleanup && (
    <div
      role="region"
      aria-label="Confirm cleanup"
      className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm font-normal">{cleanup.title}</p>
      <p className="text-xs leading-snug text-subtle-foreground/75">
        Files are permanently removed. This cannot be undone.
        {cleanup.threadId
          ? " The thread and its history are kept."
          : " Storage belonging to existing threads is kept."}
      </p>
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
            void perform(async () => {
              if (cleanup.threadId)
                await rpc.call("clearThread", { threadId: cleanup.threadId });
              else if (hostId) await rpc.call("removeOrphans", { hostId });
              setCleanup(null);
            }, "Storage removed.")
          }
        >
          {busy ? "Removing…" : "Confirm removal"}
        </Button>
      </div>
    </div>
  );
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-5">
        {hostId && (
          <header className="space-y-3">
            <button
              className="inline-flex items-center gap-1.5 text-xs leading-snug text-subtle-foreground/75 hover:text-foreground"
              onClick={() => navigate.toPluginPanel(PANEL)}
            >
              <Icon name="ArrowLeft" className="size-4" />
              All machines
            </button>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h1 className="break-words text-base font-semibold">
                    {machine?.name ?? "Machine storage"}
                  </h1>
                  {machine && <MachineStatus machine={machine} />}
                </div>
                <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                  Review stored files and free up space on this machine.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
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
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {notice && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Icon name="Check" className="size-4" />
            {notice}
          </p>
        )}
        {!state ? (
          <div
            role="status"
            className="rounded-lg border border-border p-8 text-center text-xs leading-snug text-subtle-foreground/75"
          >
            Loading storage…
          </div>
        ) : hostId ? (
          <div className="space-y-6">
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
            {scanning && (
              <p role="status" className="text-xs leading-snug text-subtle-foreground/75">
                Scanning in the background. Large directories may take a few
                minutes.
              </p>
            )}
            {detail?.scan.state === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                Scan failed: {detail.scan.message}
              </p>
            )}
            {!report ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
                <Icon
                  name="FolderOpen"
                  className="size-8 text-muted-foreground"
                />
                <h2 className="text-base font-medium">
                  See what’s taking up space
                </h2>
                <p className="max-w-sm text-xs leading-snug text-subtle-foreground/75">
                  Scan this machine to measure thread files and find storage you
                  can clean up. Nothing is removed during a scan.
                </p>
              </div>
            ) : (
              <>
                <section
                  className="space-y-4 rounded-lg border border-border bg-card px-4 py-3.5"
                  aria-label="Storage breakdown"
                >
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-xs leading-snug text-subtle-foreground/75">
                        Tracked storage
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {bytes(totalBytes(report))}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {report.disk && (
                        <p className="tabular-nums">
                          {bytes(report.disk.freeBytes)} free of{" "}
                          {bytes(report.disk.totalBytes)}
                        </p>
                      )}
                      <p>
                        Scanned{" "}
                        {new Date(report.scannedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <StorageBreakdown report={report} />
                </section>
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold">Clean up</h2>
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-normal">
                            Orphaned storage{" "}
                            <span className="ml-2 whitespace-nowrap font-normal text-muted-foreground">
                              {bytes(report.orphanBytes)}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            {report.orphanCount
                              ? `${report.orphanCount} ${report.orphanCount === 1 ? "directory" : "directories"} no longer attached to existing threads.`
                              : "No orphaned files found in the last scan."}
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
                              threadId: null,
                              title: `Remove ${bytes(report.orphanBytes)} of orphaned storage?`,
                            })
                          }
                        >
                          Remove orphans
                        </Button>
                      </div>
                      {cleanup?.threadId === null && cleanupConfirmation}
                    </div>
                    <div className="space-y-3 px-4 py-3.5">
                      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-normal">
                            Leftover worktrees{" "}
                            <span className="ml-2 whitespace-nowrap font-normal text-muted-foreground">
                              {bytes(report.leftoverWorktreeBytes)}
                            </span>
                          </p>
                          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
                            {report.leftoverWorktrees.length
                              ? "Unused worktrees waiting for cleanup."
                              : "No worktrees waiting for cleanup."}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            locked || report.leftoverWorktrees.length === 0
                          }
                          onClick={() =>
                            void perform(async () => {
                              await rpc.call("retryWorktreeCleanup", {
                                hostId,
                              });
                            }, "Cleanup requested. Rescan after it finishes to update usage.")
                          }
                        >
                          Retry cleanup
                        </Button>
                      </div>
                      {report.leftoverWorktrees.map((worktree) => (
                        <div
                          key={worktree.environmentId}
                          className="rounded-lg bg-muted/40 p-3 text-xs"
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
                  </div>
                </section>
                <section className="space-y-3">
                  <SectionHeading
                    title="Largest threads"
                    description="Clear files from stopped threads without deleting their conversation history."
                  />
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    {report.largestThreads.length === 0 && (
                      <p className="p-6 text-center text-xs leading-snug text-subtle-foreground/75">
                        No thread files found in the last scan.
                      </p>
                    )}
                    {report.largestThreads.map((thread) => (
                      <div key={thread.threadId} className="space-y-3 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                            <button
                              className="block max-w-full truncate text-left text-sm font-normal hover:underline"
                              onClick={() => navigate.toThread(thread.threadId)}
                            >
                              {thread.title}
                            </button>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {thread.running
                                ? "Running · stop the thread to clear files"
                                : thread.archivedAt === null
                                  ? "Active thread"
                                  : "Archived thread"}
                            </p>
                          </div>
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {bytes(thread.sizeBytes)}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={
                              locked || thread.running || cleanup !== null
                            }
                            onClick={() =>
                              setCleanup({
                                threadId: thread.threadId,
                                title: `Clear files for “${thread.title}”?`,
                              })
                            }
                          >
                            Clear storage
                          </Button>
                        </div>
                        {cleanup?.threadId === thread.threadId &&
                          cleanupConfirmation}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <SectionHeading
                title="Machine storage"
                description="Thread files and leftover worktrees on each machine. Open one to scan it or free up space."
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
                    onOpen={() =>
                      navigate.toPluginPanel(PANEL, { subPath: host.hostId })
                    }
                  />
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <SectionHeading
                title="Automatic retention"
                description="Archive or delete inactive threads across all projects. You’ll see what changes before anything is saved."
                badge={
                  state.policy.archiveAfterDays === null &&
                  state.policy.deleteAfterDays === null
                    ? "Off"
                    : "Checks hourly"
                }
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
                  <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      {changed
                        ? "Unsaved changes"
                        : state.lastRun
                          ? `Last checked ${ago(state.lastRun.ranAt)} · ${state.lastRun.archivedCount} archived · ${state.lastRun.deletedCount} deleted${state.lastRun.failedCount ? ` · ${state.lastRun.failedCount} failed` : ""}`
                          : state.policy.archiveAfterDays === null &&
                              state.policy.deleteAfterDays === null
                            ? "Threads are kept until you archive or delete them."
                            : "First check runs within the hour."}
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
                        void perform(async () => {
                          await rpc.call("configure", confirmation.policy);
                          setDraft(null);
                          setConfirmation(null);
                        }, "Retention policy saved.")
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

function SectionHeading({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge && (
          <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
        {description}
      </p>
    </div>
  );
}

function MachineStatus({ machine }: { machine: Machine }) {
  const online = machine.status === "connected";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-subtle-foreground">
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
          ? `Offline · seen ${ago(machine.lastSeenAt)}`
          : "Offline"}
    </span>
  );
}

function MachineRow({
  host,
  machine,
  onOpen,
}: {
  host: Hosts[number];
  machine: Machine | undefined;
  onOpen: () => void;
}) {
  const report = host.report;
  return (
    <button
      className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onOpen}
    >
      <Icon name="Laptop" className="size-4 shrink-0 self-start mt-0.5 text-subtle-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <span className="truncate text-sm font-normal">
            {machine?.name ?? host.hostId}
          </span>
          {machine && <MachineStatus machine={machine} />}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground/75">
          {host.scan.state === "scanning"
            ? "Scanning in the background…"
            : host.scan.state === "failed"
              ? "Scan failed · open to retry"
              : report
                ? [
                    `${report.threadsWithStorageCount} ${report.threadsWithStorageCount === 1 ? "thread" : "threads"}`,
                    report.orphanCount > 0 &&
                      `${bytes(report.orphanBytes)} orphaned`,
                    report.leftoverWorktrees.length > 0 &&
                      `${bytes(report.leftoverWorktreeBytes)} in leftover worktrees`,
                    `scanned ${ago(report.scannedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Not scanned yet"}
        </span>
        {report && <UsageBar report={report} className="mt-2.5" />}
      </span>
      <span className="shrink-0 text-right">
        {report ? (
          <>
            <span className="block text-sm font-normal tabular-nums">
              {bytes(totalBytes(report))}
            </span>
            {report.disk && (
              <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                {bytes(report.disk.freeBytes)} free
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Scan</span>
        )}
      </span>
      <Icon
        name="ChevronRight"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
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
function totalBytes(report: NonNullable<HostReport["report"]>) {
  return (
    report.activeThreadBytes +
    report.archivedThreadBytes +
    report.orphanBytes +
    report.leftoverWorktreeBytes
  );
}
function categories(report: NonNullable<HostReport["report"]>) {
  return [
    {
      label: "Active threads",
      value: report.activeThreadBytes,
      color: "bg-foreground/70",
    },
    {
      label: "Archived threads",
      value: report.archivedThreadBytes,
      color: "bg-foreground/40",
    },
    {
      label: "Orphaned files",
      value: report.orphanBytes,
      color: "bg-foreground/20",
    },
    {
      label: "Leftover worktrees",
      value: report.leftoverWorktreeBytes,
      color: "bg-foreground/10",
    },
  ];
}
function UsageBar({
  report,
  className,
}: {
  report: NonNullable<HostReport["report"]>;
  className?: string;
}) {
  const total = totalBytes(report);
  return (
    <span
      className={cn(
        "flex h-1.5 overflow-hidden rounded-full bg-muted",
        className,
      )}
      aria-hidden="true"
    >
      {categories(report).map((category) => (
        <span
          key={category.label}
          className={category.color}
          style={{ width: `${total ? (category.value / total) * 100 : 0}%` }}
        />
      ))}
    </span>
  );
}
function StorageBreakdown({
  report,
}: {
  report: NonNullable<HostReport["report"]>;
}) {
  return (
    <>
      <UsageBar report={report} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {categories(report).map((category) => (
          <div key={category.label}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`size-2 shrink-0 rounded-sm ${category.color}`}
              />
              {category.label}
            </dt>
            <dd className="mt-1.5 text-sm font-normal tabular-nums">
              {bytes(category.value)}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL,
    title: "Storage & retention",
    icon: "FolderOpen",
    path: PANEL,
    component: StoragePanel,
  });
});
