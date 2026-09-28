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
import { Input } from "@/components/ui/input";
import type { storageRpc, State, Policy, Preview } from "./src/contract.js";

type HostReport = import("./src/storage-types.js").HostStorageResponse;
type Hosts = import("./src/storage-types.js").HostStorageListResponse["hosts"];
const PANEL = "storage";
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** index).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][index]}`;
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
  const [names, setNames] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<HostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    archive: string;
    deletion: string;
  } | null>(null);
  const archiveDays =
    draft?.archive ?? state?.policy.archiveAfterDays?.toString() ?? "";
  const deleteDays =
    draft?.deletion ?? state?.policy.deleteAfterDays?.toString() ?? "";
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
      setNames(
        Object.fromEntries(machines.map((host) => [host.id, host.name])),
      );
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
  async function preview() {
    setConfirmation(null);
    await perform(async () => {
      const parse = (text: string) => {
        if (!text.trim()) return null;
        const n = Number(text);
        if (!Number.isInteger(n) || n < 1 || n > 3650)
          throw new Error(
            "Enter whole days between 1 and 3650, or leave blank for Never.",
          );
        return n;
      };
      const policy = {
        archiveAfterDays: parse(archiveDays),
        deleteAfterDays: parse(deleteDays),
      };
      setConfirmation({ policy, preview: await rpc.call("preview", policy) });
    });
  }
  const report = detail?.report;
  const scanning = detail?.scan.state === "scanning";
  const locked = busy || scanning;
  const changed =
    state !== null &&
    (archiveDays !== (state.policy.archiveAfterDays?.toString() ?? "") ||
      deleteDays !== (state.policy.deleteAfterDays?.toString() ?? ""));
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
        <header className="space-y-3">
          {hostId && (
            <button
              className="inline-flex items-center gap-1.5 text-xs leading-snug text-subtle-foreground/75 hover:text-foreground"
              onClick={() => navigate.toPluginPanel(PANEL)}
            >
              <Icon name="ArrowLeft" className="size-4" />
              Storage &amp; retention
            </button>
          )}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h1 className="break-words text-base font-semibold">
                {hostId
                  ? (names[hostId] ?? "Machine storage")
                  : "Storage & retention"}
              </h1>
              <p className="text-xs leading-snug text-subtle-foreground/75">
                {hostId
                  ? "Review stored files and free up space on this machine."
                  : "Manage machine storage and decide how long to keep threads."}
              </p>
            </div>
            {hostId && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || scanning || !detail}
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
            )}
          </div>
        </header>
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
                    <p className="text-xs text-muted-foreground">
                      Last scanned {new Date(report.scannedAt).toLocaleString()}
                    </p>
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
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-semibold">Largest threads</h2>
                    <span className="text-xs text-muted-foreground">
                      {report.largestThreads.length} shown
                    </span>
                  </div>
                  <p className="text-xs leading-snug text-subtle-foreground/75">
                    Clear files from stopped threads without deleting their
                    conversation history.
                  </p>
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
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Machine storage</h2>
                <span className="text-xs text-muted-foreground">
                  {hosts.length} {hosts.length === 1 ? "machine" : "machines"}
                </span>
              </div>
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
                  <button
                    key={host.hostId}
                    className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() =>
                      navigate.toPluginPanel(PANEL, { subPath: host.hostId })
                    }
                  >
                    <Icon name="Laptop" className="size-4 shrink-0 text-subtle-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-normal">
                        {names[host.hostId] ?? host.hostId}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground/75">
                        {host.scan.state === "scanning"
                          ? "Scanning in the background…"
                          : host.scan.state === "failed"
                            ? "Scan failed · open to retry"
                            : host.report
                              ? `Scanned ${new Date(host.report.scannedAt).toLocaleString()}`
                              : "Scan to measure storage"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-normal tabular-nums">
                      {host.report
                        ? bytes(totalBytes(host.report))
                        : "Not scanned"}
                    </span>
                    <Icon
                      name="ChevronRight"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                ))}
              </div>
            </section>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Automatic retention</h2>
                <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
                  {state.policy.archiveAfterDays === null &&
                  state.policy.deleteAfterDays === null
                    ? "Off · keep everything"
                    : "Checks hourly"}
                </span>
              </div>
              <p className="text-xs leading-snug text-subtle-foreground/75">
                Set a lifetime for inactive threads across all projects. Nothing
                changes until you preview and save.
              </p>
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                <RetentionField
                  label="Auto-archive"
                  description="Archive threads after this many idle days."
                  ariaLabel="Auto-archive after idle days"
                  value={archiveDays}
                  disabled={busy || confirmation !== null}
                  onChange={(value) => {
                    setDraft({ archive: value, deletion: deleteDays });
                    setNotice(null);
                  }}
                />
                <RetentionField
                  label="Auto-delete"
                  description="Permanently delete threads after this many archived days."
                  ariaLabel="Auto-delete after archived days"
                  value={deleteDays}
                  disabled={busy || confirmation !== null}
                  onChange={(value) => {
                    setDraft({ archive: archiveDays, deletion: value });
                    setNotice(null);
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {changed
                      ? "Unsaved changes"
                      : "Leave blank to keep threads indefinitely."}
                  </p>
                  <Button
                    size="sm"
                    disabled={busy || confirmation !== null || !changed}
                    onClick={() => void preview()}
                  >
                    {busy ? "Working…" : "Preview changes"}
                  </Button>
                </div>
              </div>
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
                          : `After ${confirmation.policy.archiveAfterDays} idle days`}
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
                          : `After ${confirmation.policy.deleteAfterDays} archived days`}
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
              <div className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
                <Icon name="Pin" className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  Pinned threads are kept. Pin automation targets you want to
                  preserve; they aren’t automatically protected.
                </p>
              </div>
              <p className="px-1 text-xs text-muted-foreground">
                {state.lastRun
                  ? `Last checked ${new Date(state.lastRun.ranAt).toLocaleString()} · ${state.lastRun.archivedCount} archived · ${state.lastRun.deletedCount} deleted · ${state.lastRun.failedCount} failed`
                  : "No automatic retention run yet. Enabled policies are checked every hour."}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function RetentionField({
  label,
  description,
  ariaLabel,
  value,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  ariaLabel: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-normal">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          aria-label={ariaLabel}
          type="number"
          min={1}
          max={3650}
          placeholder="Never"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-20 text-right text-xs tabular-nums"
        />
        <span className="text-xs text-muted-foreground">days</span>
        {value !== "" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange("")}
            aria-label={`Never ${label.toLowerCase()}`}
          >
            Never
          </Button>
        )}
      </div>
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
function StorageBreakdown({
  report,
}: {
  report: NonNullable<HostReport["report"]>;
}) {
  const categories = [
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
  const total = totalBytes(report);
  return (
    <>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        {categories.map((category) => (
          <div
            key={category.label}
            className={category.color}
            style={{ width: `${total ? (category.value / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {categories.map((category) => (
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
