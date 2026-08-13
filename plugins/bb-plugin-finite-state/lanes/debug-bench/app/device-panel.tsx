import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginNavPanelProps,
  type PluginPendingInteractionProps,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { rpcContract } from "../../../shared/contract.js";
import type { debugBenchRpcContract } from "../register.js";
import { BENCH_CHANGED_CHANNEL } from "../registry/families.js";
import type {
  BenchDeviceRecord,
  DeviceKind,
  FamilyStatus,
} from "../registry/families.js";

const KIND_ORDER: readonly DeviceKind[] = ["probe", "logic", "power", "scope", "serial"];
const KIND_LABELS: Record<DeviceKind, string> = {
  probe: "Debug probes",
  logic: "Logic analyzers",
  power: "Power analyzers",
  scope: "Oscilloscopes",
  serial: "Serial ports",
};
const KIND_ICONS: Record<DeviceKind, IconName> = {
  probe: "Zap",
  logic: "GitBranch",
  power: "ChartColumn",
  scope: "AudioLines",
  serial: "Terminal",
};

interface RegistryReadyState {
  kind: "ready";
  families: FamilyStatus[];
  devices: BenchDeviceRecord[];
  totalDevices: number;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | RegistryReadyState;

interface DevicePanelProps extends PluginNavPanelProps {
  compact?: boolean;
  consoleSlot?: ReactNode | ((props: {
    projectId: string;
    projectVersionId: string | null;
    devices: readonly BenchDeviceRecord[];
  }) => ReactNode);
  helperInstallThreadId?: string;
}

export function DestructiveConfirmationInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps): React.JSX.Element {
  const payload = typeof interaction.payload === "object" && interaction.payload !== null &&
    !Array.isArray(interaction.payload) ? interaction.payload : null;
  const detail = payload && "detail" in payload && typeof payload.detail === "string"
    ? payload.detail
    : "Review this destructive operation before continuing.";
  const command = payload && "command" in payload && typeof payload.command === "string"
    ? payload.command
    : null;
  return (
    <section className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{interaction.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
      {command ? (
        <code className="block overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs text-foreground">
          {command}
        </code>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Confirmation is single-use and expires with this interaction.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => { void submit({ confirmed: true }); }} size="sm">
          Confirm operation
        </Button>
        <Button onClick={() => { void cancel(); }} size="sm" variant="outline">
          Cancel
        </Button>
      </div>
    </section>
  );
}

interface ProjectPickerProps {
  disabled: boolean;
  projectId: string | null;
  projects: readonly { id: string; name: string }[];
  select(projectId: string | null): void;
}

function ProjectPicker({ disabled, projectId, projects, select }: ProjectPickerProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="shrink-0 text-xs font-medium text-muted-foreground" htmlFor="firmware-bench-project">Project</label>
      <select
        className="h-8 min-w-0 max-w-52 rounded-md border border-input bg-background px-2 text-xs"
        disabled={disabled}
        id="firmware-bench-project"
        onChange={(event) => select(event.target.value || null)}
        value={projectId ?? ""}
      >
        <option value="">Select project</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>
  );
}

function ChooseProjectState(props: ProjectPickerProps): React.JSX.Element {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground" data-state="choose-project">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <Icon className="text-muted-foreground" name="Zap" />
        <h1 className="text-sm font-semibold">Firmware Bench</h1>
        <div className="ml-auto"><ProjectPicker {...props} /></div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <Icon className="mx-auto size-6 text-muted-foreground" name="Zap" />
          <h2 className="mt-3 text-lg font-semibold">Choose a project</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Device observations are stored in a project scope while claims remain machine-wide. Choose a project to scan this machine.</p>
        </div>
      </div>
    </section>
  );
}

function panelHolder(projectId: string | null, threadId: string | null): string {
  if (threadId) return threadId;
  if (!projectId) return "ui-unscoped";
  const key = `fs.debug-bench.holder.v1.${projectId}`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const holder = `ui-${window.crypto.randomUUID()}`;
    window.sessionStorage.setItem(key, holder);
    return holder;
  } catch {
    return `ui-${projectId}`;
  }
}

function LoadingState(): React.JSX.Element {
  return (
    <div className="space-y-4 p-4 md:p-5" data-state="loading" role="status" aria-label="Scanning hardware registry">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        {[0, 1, 2, 3].map((value) => (
          <div className="bg-card p-4" key={value}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-12" />
          </div>
        ))}
      </div>
      {[0, 1].map((value) => (
        <div className="rounded-lg border border-border bg-card p-4" key={value}>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry(): void }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6" data-state="error">
      <Alert className="max-w-xl border-destructive/40">
        <Icon className="size-4 text-destructive" name="AlertTriangle" />
        <AlertDescription className="space-y-4">
          <p>{message}</p>
          <Button onClick={retry} size="sm" variant="outline">
            <Icon name="ArrowReloadHorizontal" />
            Retry registry read
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

function EmptyState({ rescan, busy }: { rescan(): void; busy: boolean }): React.JSX.Element {
  return (
    <section className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border bg-card/40 p-8 text-center" data-state="empty">
      <div className="max-w-md">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="size-5" name="ElectricPlugs" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-foreground">No instruments detected</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          All configured families responded, but no local device is currently visible. An unplugged device will remain here as stale after it has been seen once.
        </p>
        <Button className="mt-5" disabled={busy} onClick={rescan} variant="outline">
          <Icon className={busy ? "animate-spin" : undefined} name="ArrowReloadHorizontal" />
          {busy ? "Scanning" : "Scan again"}
        </Button>
      </div>
    </section>
  );
}

function formatLastSeen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function DeviceRow({
  device,
  holder,
  busy,
  compact,
  claim,
  release,
}: {
  device: BenchDeviceRecord;
  holder: string;
  busy: boolean;
  compact: boolean;
  claim(): void;
  release(): void;
}): React.JSX.Element {
  const heldHere = device.claimedBy === holder;
  return (
    <article className={compact
      ? "grid gap-3 border-t border-border px-3 py-3 first:border-t-0"
      : "grid gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {[device.make, device.model].filter(Boolean).join(" ") || device.deviceId}
          </p>
          <Badge variant={device.stale ? "outline" : "secondary"}>
            {device.stale ? "Stale" : "Seen"}
          </Badge>
          <Badge variant="outline">{device.transport}</Badge>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{device.connection}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Last seen {formatLastSeen(device.lastSeen)} · scope {device.claimScope}
        </p>
      </div>
      <div className={compact ? "flex flex-wrap items-center gap-2" : "flex items-center gap-2 md:justify-end"}>
        {device.claimedBy ? (
          <Badge variant={heldHere ? "secondary" : "outline"}>
            <Icon name="Lock" />
            {heldHere ? "Claimed here" : `Held by ${device.claimedBy}`}
          </Badge>
        ) : (
          <Badge variant="outline">Free</Badge>
        )}
        {device.claimedBy === null ? (
          <Button disabled={busy || device.stale} onClick={claim} size="sm">
            Claim
          </Button>
        ) : heldHere ? (
          <Button disabled={busy} onClick={release} size="sm" variant="outline">
            Release
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function FamilyUnavailableRow({
  family,
  proposal,
  busy,
  compact,
  propose,
  confirm,
  helperInstallAvailable,
}: {
  family: FamilyStatus;
  proposal: {
    proposalToken: string;
    command: string;
    source: string;
    why: string;
  } | null;
  busy: boolean;
  compact: boolean;
  propose(): void;
  confirm(): void;
  helperInstallAvailable: boolean;
}): React.JSX.Element {
  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3 first:border-t-0">
      <div className={compact
        ? "flex flex-col gap-3"
        : "flex flex-col gap-3 md:flex-row md:items-start md:justify-between"}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Icon className="size-4 text-muted-foreground" name="AlertCircle" />
            {family.label} unavailable
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{family.reason}</p>
        </div>
        {family.needsConfiguration && proposal === null && helperInstallAvailable ? (
          <Button className={compact ? "w-full whitespace-normal" : undefined} disabled={busy} onClick={propose} size="sm" variant="outline">
            Review helper install
          </Button>
        ) : null}
        {family.needsConfiguration && !helperInstallAvailable ? (
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            Open Firmware Bench from this thread&apos;s Actions menu to review helper installation.
          </p>
        ) : null}
      </div>
      {proposal ? (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-foreground">Explicit confirmation required</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.why}</p>
          <code className="mt-2 block overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs text-foreground">{proposal.command}</code>
          <div className={compact ? "mt-3 grid gap-2" : "mt-3 flex flex-wrap items-center gap-2"}>
            <Button className={compact ? "w-full whitespace-normal" : undefined} disabled={busy} onClick={confirm} size="sm">
              Confirm and install
            </Button>
            <a className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href={proposal.source} rel="noreferrer" target="_blank">
              Helper source
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DevicePanel({
  compact = false,
  consoleSlot,
  helperInstallThreadId,
}: DevicePanelProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const registryRpc = useRpc<typeof debugBenchRpcContract>();
  const { projectId: routeProjectId, threadId: routeThreadId } = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projectId = routeProjectId ?? selectedProjectId;
  const realtimeState = useRealtimeConnectionState();
  const reconnected = useRef(false);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, {
    proposalToken: string;
    command: string;
    source: string;
    why: string;
  }>>({});
  const scope = useMemo(
    () => projectId ? { projectId, projectVersionId: null } : null,
    [projectId],
  );
  const holder = useMemo(
    () => panelHolder(projectId, helperInstallThreadId ?? routeThreadId),
    [helperInstallThreadId, projectId, routeThreadId],
  );

  const load = useCallback(async (rescan: boolean) => {
    if (!scope) return;
    try {
      const registry = await registryRpc.call(
        rescan ? "benchDevRegistryRescan" : "benchDevRegistryStatus",
        scope,
      );
      const devices = await rpc.call("benchDevDevicesList", {
        ...scope,
        pageSize: 200,
        cursor: null,
      });
      setState({
        kind: "ready",
        families: registry.families,
        devices: devices.items,
        totalDevices: devices.total,
      });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "The device registry could not be read.",
      });
    }
  }, [registryRpc, rpc, scope]);

  useEffect(() => {
    if (!scope) return;
    setState({ kind: "loading" });
    void load(true);
  }, [load, scope]);
  useRealtime(BENCH_CHANGED_CHANNEL, () => { void load(false); });
  useEffect(() => {
    if (realtimeState !== "connected") {
      reconnected.current = true;
      return;
    }
    if (reconnected.current) {
      reconnected.current = false;
      void load(false);
    }
  }, [load, realtimeState]);

  const perform = useCallback(async (key: string, operation: () => Promise<unknown>) => {
    setBusyKey(key);
    setActionError(null);
    try {
      await operation();
      await load(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The device operation failed.",
      );
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  const projectPicker = {
    disabled: Boolean(routeProjectId) || sidebar.status === "loading",
    projectId,
    projects: sidebar.projects,
    select(nextProjectId: string | null) {
      setState({ kind: "loading" });
      setSelectedProjectId(nextProjectId);
    },
  };

  if (!projectId) return <ChooseProjectState {...projectPicker} />;

  if (state.kind === "loading") return <LoadingState />;
  if (state.kind === "error") {
    return <ErrorState message={state.message} retry={() => { setState({ kind: "loading" }); void load(true); }} />;
  }
  const unavailable = state.families.filter((family) => family.availability === "unavailable");
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    devices: state.devices.filter((device) => device.kind === kind),
    families: unavailable.filter((family) => family.kind === kind),
  })).filter((group) => group.devices.length > 0 || group.families.length > 0);
  const claimed = state.devices.filter((device) => device.claimedBy !== null).length;
  const stale = state.devices.filter((device) => device.stale).length;

  return (
    <div
      className="h-full overflow-x-hidden overflow-y-auto bg-background text-foreground"
      data-layout={compact ? "compact" : "wide"}
      data-state="ready"
    >
      <div className={compact ? "w-full space-y-3 p-3" : "mx-auto w-full max-w-6xl space-y-4 p-4 md:p-5"}>
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className={compact
            ? "flex flex-col gap-3 border-b border-border bg-muted/20 px-3 py-3"
            : "flex flex-col gap-4 border-b border-border bg-muted/20 px-4 py-3 md:flex-row md:items-center"}>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Machine arbitration · diagnostic only</p>
              <p className="mt-1 text-sm text-foreground">Live registry for local instruments and serial endpoints.</p>
            </div>
            <div className={compact ? "min-w-0" : "md:ml-auto"}><ProjectPicker {...projectPicker} /></div>
            <Button className={compact ? "w-full" : undefined} disabled={busyKey === "rescan"} onClick={() => void perform("rescan", async () => {
              if (!scope) return;
              await registryRpc.call("benchDevRegistryRescan", scope);
            })} size="sm" variant="outline">
              <Icon className={busyKey === "rescan" ? "animate-spin" : undefined} name="ArrowReloadHorizontal" />
              Rescan
            </Button>
          </div>
          <div className={compact ? "grid grid-cols-2 gap-px bg-border" : "grid grid-cols-2 gap-px bg-border md:grid-cols-4"}>
            {[
              ["Visible", state.devices.length - stale],
              ["Claimed", claimed],
              ["Stale", stale],
              ["Needs setup", unavailable.filter((family) => family.needsConfiguration).length],
            ].map(([label, value]) => (
              <div className="bg-card px-4 py-3" key={label}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </section>

        {actionError ? (
          <Alert className="border-destructive/40" role="alert">
            <Icon className="size-4 text-destructive" name="AlertTriangle" />
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {state.devices.length === 0 && unavailable.length === 0 ? (
          <EmptyState busy={busyKey === "rescan"} rescan={() => void perform("rescan", async () => {
            if (!scope) return;
            await registryRpc.call("benchDevRegistryRescan", scope);
          })} />
        ) : (
          <div className={compact ? "grid min-w-0 gap-3" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"}>
            <div className="space-y-3">
              {groups.map((group) => (
                <section className="overflow-hidden rounded-lg border border-border bg-card" key={group.kind}>
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" name={KIND_ICONS[group.kind]} />
                      <h2 className="text-sm font-semibold">{KIND_LABELS[group.kind]}</h2>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{group.devices.length}</span>
                  </div>
                  {group.devices.map((device) => (
                    <DeviceRow
                      busy={busyKey === device.deviceId}
                      compact={compact}
                      claim={() => void perform(device.deviceId, async () => {
                        if (!scope) return;
                        await rpc.call("benchDevDeviceClaim", {
                          ...scope,
                          deviceId: device.deviceId,
                          holder,
                          claimScope: "machine",
                        });
                      })}
                      device={device}
                      holder={holder}
                      key={device.deviceId}
                      release={() => void perform(device.deviceId, async () => {
                        if (!scope) return;
                        await rpc.call("benchDevDeviceRelease", {
                          ...scope,
                          deviceId: device.deviceId,
                          holder,
                        });
                      })}
                    />
                  ))}
                  {group.families.map((family) => (
                    <FamilyUnavailableRow
                      busy={busyKey === family.familyId}
                      compact={compact}
                      confirm={() => void perform(family.familyId, async () => {
                        if (!scope || !helperInstallThreadId) return;
                        const proposal = proposals[family.familyId];
                        if (!proposal) return;
                        await registryRpc.call("benchDevHelperInstall", {
                          ...scope,
                          proposalToken: proposal.proposalToken,
                          threadId: helperInstallThreadId,
                        });
                        setProposals((current) => {
                          const next = { ...current };
                          delete next[family.familyId];
                          return next;
                        });
                      })}
                      helperInstallAvailable={helperInstallThreadId !== undefined}
                      family={family}
                      key={family.familyId}
                      proposal={proposals[family.familyId] ?? null}
                      propose={() => void perform(family.familyId, async () => {
                        if (!scope) return;
                        const proposal = await registryRpc.call("benchDevHelperProposal", {
                          ...scope,
                          familyId: family.familyId,
                        });
                        setProposals((current) => ({ ...current, [family.familyId]: proposal }));
                      })}
                    />
                  ))}
                </section>
              ))}
              {state.totalDevices > state.devices.length ? (
                <p className="text-xs text-muted-foreground">Showing the first {state.devices.length} of {state.totalDevices} devices.</p>
              ) : null}
            </div>
            <aside className="min-h-48 overflow-hidden rounded-lg border border-border bg-card" aria-label="Serial console slot">
              {typeof consoleSlot === "function"
                ? consoleSlot({ projectId, projectVersionId: null, devices: state.devices })
                : consoleSlot}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
