import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  snapshotProcessTree,
  stopRecordedProcess,
  stopRecordedProcesses,
  type RecordedProcess,
  type TrackedProcess,
} from "@bb/process-utils";
import { z } from "zod";
import type { HostDaemonLogger } from "./logger.js";

const RESOURCE_LEDGER_DIR = "host-daemon-resources";
const RECORD_VERSION = 2;
const DEADLINE_STOP_GRACE_MS = 10_000;
const PROCESS_STOP_GRACE_MS = 2_000;
const OWNER_STOP_GRACE_MS = 10_000;
const ADOPTED_PROCESS_RECORD_DELAY_MS = 1_000;

const resourceOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider-runtime"),
      environmentId: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("provider-maintenance") }).strict(),
  z
    .object({
      kind: z.literal("environment-hook"),
      operationId: z.string().min(1),
      hook: z.enum(["setup", "teardown"]),
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plugin-host"),
      pluginId: z.string().min(1),
      generation: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("connect-next-tunnel") }).strict(),
  z.object({ kind: z.literal("host-command") }).strict(),
  z.object({ kind: z.literal("file-watcher") }).strict(),
]);

export type ResourceOwner = z.infer<typeof resourceOwnerSchema>;

export type ResourceTermination = "confirmed" | "unverified";

interface ReconciledResource {
  owner: ResourceOwner;
  termination: ResourceTermination;
}

export type ResourceDeadline =
  | { kind: "at"; at: number }
  | { kind: "idle"; idleMs: number }
  | { kind: "owner" };

export type ResourceEnd =
  | { status: "completed" }
  | { status: "failed"; message: string; terminationUnverified: boolean };

interface OpenResourceArgs {
  owner: ResourceOwner;
  deadline: ResourceDeadline;
  onDeadline?: () => Promise<unknown> | void;
}

interface ResourceLedgerOptions {
  directory: string;
  instanceId: string;
  logger: HostDaemonLogger;
}

interface ProcessRecord extends RecordedProcess {
  label: string;
}

const processRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    processGroup: z.boolean(),
    startId: z.string().min(1).nullable(),
    label: z.string(),
  })
  .strict();

const resourceRecordSchema = z
  .object({
    version: z.literal(RECORD_VERSION),
    id: z.string().min(1),
    instanceId: z.string().min(1),
    owner: z.unknown(),
    openedAt: z.number().finite(),
    deadlineAt: z.number().finite().nullable(),
    processes: z.array(processRecordSchema),
  })
  .strict();

type PreviousRecord =
  | {
      kind: "readable";
      file: string;
      record: z.infer<typeof resourceRecordSchema>;
    }
  | { kind: "unreadable"; owner: ResourceOwner | null };

export function resourceLedgerDirectory(dataDir: string): string {
  return path.join(dataDir, RESOURCE_LEDGER_DIR);
}

export class DaemonResource {
  readonly id = randomUUID();
  readonly openedAt = Date.now();
  readonly done: Promise<ResourceEnd>;
  private readonly abortController = new AbortController();
  private readonly processes = new Map<number, ProcessRecord>();
  private readonly descendants = new Map<number, ProcessRecord>();
  private readonly recordedPids = new Set<number>();
  private readonly identityReaders = new Map<
    number,
    () => Promise<string | null>
  >();
  private readonly leases = new Set<{ deadlineAt: number }>();
  private idleSince = Date.now();
  private resolveDone: (end: ResourceEnd) => void = () => undefined;
  private closing: Promise<ResourceEnd> | null = null;
  private hasExpired = false;

  constructor(
    private readonly ledger: ResourceLedger,
    readonly owner: ResourceOwner,
    private readonly deadline: ResourceDeadline,
    private readonly onDeadline: () => Promise<unknown> | void,
  ) {
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get closed(): boolean {
    return this.closing !== null;
  }

  get deadlineAt(): number | null {
    if (this.deadline.kind === "at") return this.deadline.at;
    if (this.deadline.kind === "owner") return null;
    if (this.leases.size === 0) return this.idleSince + this.deadline.idleMs;
    return Math.max(...[...this.leases].map((lease) => lease.deadlineAt));
  }

  readonly trackProcess = (process: TrackedProcess): void => {
    if (this.closed) return;
    this.addProcess(process);
    this.save();
    void this.readIdentities().then(() => {
      if (!this.closed) this.save();
    });
    void process.exited.then(() => this.processExited(process.pid));
  };

  readonly adoptProcess = (process: TrackedProcess): void => {
    if (this.closed) return;
    this.addProcess(process);
    const timer = setTimeout(() => {
      void this.readIdentities().then(() => {
        if (this.processes.has(process.pid) && !this.closed) this.save();
      });
    }, ADOPTED_PROCESS_RECORD_DELAY_MS);
    timer.unref();
    void process.exited.then(() => {
      clearTimeout(timer);
      this.processExited(process.pid);
    });
  };

  private addProcess(process: TrackedProcess): void {
    this.processes.set(process.pid, {
      pid: process.pid,
      processGroup: process.processGroup,
      startId: null,
      label: process.label,
    });
    this.identityReaders.set(process.pid, process.startId);
  }

  private async readIdentities(): Promise<void> {
    await Promise.all(
      [...this.identityReaders].map(async ([pid, read]) => {
        const startId = await read();
        if (startId === null) return;
        const record = this.processes.get(pid);
        if (record !== undefined && record.startId === null)
          record.startId = startId;
        if (this.identityReaders.get(pid) === read)
          this.identityReaders.delete(pid);
      }),
    );
  }

  private save(): void {
    this.ledger.persist(this);
    this.recordedPids.clear();
    for (const record of this.listProcesses())
      this.recordedPids.add(record.pid);
  }

  lease(deadlineAt: number): () => void {
    const lease = { deadlineAt };
    this.leases.add(lease);
    this.ledger.scheduleDeadlines();
    return () => {
      if (!this.leases.delete(lease)) return;
      if (this.leases.size === 0) this.idleSince = Date.now();
      if (!this.closed) this.ledger.scheduleDeadlines();
    };
  }

  async abort(): Promise<void> {
    await this.captureTree();
    this.abortController.abort();
  }

  async captureTree(): Promise<void> {
    if (this.processes.size === 0 || this.closed) return;
    await this.readIdentities();
    const roots = [...this.processes.values()];
    let members;
    try {
      ({ members } = await snapshotProcessTree(roots));
    } catch {
      return;
    }
    for (const member of members) {
      if (this.processes.has(member.pid)) continue;
      this.descendants.set(member.pid, {
        pid: member.pid,
        processGroup: member.pgid === member.pid,
        startId: member.startId,
        label: "descendant",
      });
    }
    this.save();
  }

  async end(
    stop: () => Promise<void> | void,
    end: ResourceEnd = { status: "completed" },
  ): Promise<ResourceEnd> {
    if (this.closing !== null) return this.closing;
    await this.captureTree();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        stop(),
        new Promise((resolve) => {
          timer = setTimeout(resolve, OWNER_STOP_GRACE_MS);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      await this.close(end);
    }
    return this.close(end);
  }

  leaveRunning(end: ResourceEnd = { status: "completed" }): void {
    if (this.closing !== null) return;
    this.closing = Promise.resolve(this.finish(end));
  }

  close(end: ResourceEnd = { status: "completed" }): Promise<ResourceEnd> {
    if (this.closing !== null) return this.closing;
    this.closing =
      this.listProcesses().length === 0
        ? Promise.resolve(this.finish(end))
        : this.stopRemaining(end);
    return this.closing;
  }

  private finish(end: ResourceEnd): ResourceEnd {
    this.ledger.release(this, end);
    this.resolveDone(end);
    return end;
  }

  private async stopRemaining(end: ResourceEnd): Promise<ResourceEnd> {
    await this.readIdentities();
    const remaining = this.listProcesses();
    if (remaining.length === 0) return this.finish(end);
    const result = await stopRecordedProcesses(remaining, {
      graceMs: PROCESS_STOP_GRACE_MS,
    });
    if (result !== "unverified") return this.finish(end);
    const unverified: ResourceEnd =
      end.status === "failed"
        ? { ...end, terminationUnverified: true }
        : {
            status: "failed",
            message: "Processes outlived their owner",
            terminationUnverified: true,
          };
    this.ledger.retain(this, unverified);
    this.resolveDone(unverified);
    return unverified;
  }

  listProcesses(): ProcessRecord[] {
    return [...this.processes.values(), ...this.descendants.values()];
  }

  get expired(): boolean {
    return this.hasExpired;
  }

  markExpired(): void {
    this.hasExpired = true;
  }

  clearExpired(): void {
    this.hasExpired = false;
  }

  async runDeadlineHandler(): Promise<void> {
    try {
      await this.onDeadline();
    } catch {}
  }

  async stopProcesses(
    args: { graceMs: number } = { graceMs: PROCESS_STOP_GRACE_MS },
  ): Promise<ResourceTermination> {
    await this.readIdentities();
    const result = await stopRecordedProcesses(this.listProcesses(), args);
    return result === "unverified" ? "unverified" : "confirmed";
  }

  forgetExitedProcesses(): void {
    for (const records of [this.processes, this.descendants]) {
      for (const record of records.values()) {
        if (!processAlive(record)) records.delete(record.pid);
      }
    }
    this.save();
  }

  private processExited(pid: number): void {
    const record = this.processes.get(pid);
    if (record === undefined || this.closed) return;
    if (processAlive(record)) return;
    this.processes.delete(pid);
    this.identityReaders.delete(pid);
    if (this.recordedPids.has(pid)) this.save();
  }
}

function processAlive(record: ProcessRecord): boolean {
  try {
    process.kill(record.processGroup ? -record.pid : record.pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

export class ResourceLedger {
  private readonly resources = new Set<DaemonResource>();
  private readonly previous: ReconciledResource[] = [];
  private readonly cancelledOperationIds = new Set<string>();
  private readonly endedOperations = new Map<
    string,
    { owner: ResourceOwner; end: ResourceEnd }
  >();
  private deadlineTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ResourceLedgerOptions) {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  }

  open(args: OpenResourceArgs): DaemonResource {
    const resource = new DaemonResource(
      this,
      args.owner,
      args.deadline,
      args.onDeadline ?? (() => resource.abort()),
    );
    this.resources.add(resource);
    this.persist(resource);
    return resource;
  }

  find(predicate: (owner: ResourceOwner) => boolean): DaemonResource[] {
    return [...this.resources].filter((resource) => predicate(resource.owner));
  }

  findOperation(operationId: string): DaemonResource | undefined {
    return this.find(
      (owner) =>
        owner.kind === "environment-hook" && owner.operationId === operationId,
    )[0];
  }

  operationEnd(
    operationId: string,
  ): { owner: ResourceOwner; end: ResourceEnd } | null {
    return this.endedOperations.get(operationId) ?? null;
  }

  previousOperationTermination(
    operationId: string,
  ): ResourceTermination | null {
    return (
      this.previous.find(
        (resource) =>
          resource.owner.kind === "environment-hook" &&
          resource.owner.operationId === operationId,
      )?.termination ?? null
    );
  }

  markOperationCancelled(operationId: string): void {
    this.cancelledOperationIds.add(operationId);
  }

  isOperationCancelled(operationId: string): boolean {
    return this.cancelledOperationIds.has(operationId);
  }

  async reconcile(): Promise<void> {
    const records = this.readPreviousRecords();
    const outcomes = await Promise.all(
      records.map(async (entry) => {
        if (entry.kind === "unreadable")
          return {
            owner: entry.owner,
            termination: "unverified" as const,
            stopped: 0,
          };
        const { file, record } = entry;
        const results = await Promise.all(
          record.processes.map(async (process) => ({
            process,
            result: await stopRecordedProcess(process, {
              graceMs: PROCESS_STOP_GRACE_MS,
            }),
          })),
        );
        const survivors = results
          .filter(({ result }) => result === "unverified")
          .map(({ process }) => process);
        if (survivors.length === 0) rmSync(file, { force: true });
        else writeRecordFile(file, { ...record, processes: survivors });
        const owner = resourceOwnerSchema.safeParse(record.owner);
        return {
          owner: owner.success ? owner.data : null,
          termination:
            survivors.length === 0
              ? ("confirmed" as const)
              : ("unverified" as const),
          stopped: results.filter(({ result }) => result === "terminated")
            .length,
        };
      }),
    );
    const reconciled = outcomes.flatMap((outcome) =>
      outcome.owner === null
        ? []
        : [{ owner: outcome.owner, termination: outcome.termination }],
    );
    this.previous.push(...reconciled);
    if (outcomes.length > 0)
      this.options.logger.info(
        {
          resources: outcomes.length,
          stoppedProcesses: outcomes.reduce(
            (total, outcome) => total + outcome.stopped,
            0,
          ),
          unverified: outcomes.filter(
            (outcome) => outcome.termination === "unverified",
          ).length,
          kinds: outcomes.map((outcome) => outcome.owner?.kind ?? "unknown"),
        },
        "Reconciled resources left by a previous host daemon",
      );
  }

  persist(resource: DaemonResource): void {
    if (!this.resources.has(resource)) return;
    try {
      writeRecordFile(this.recordPath(resource.id), {
        version: RECORD_VERSION,
        id: resource.id,
        instanceId: this.options.instanceId,
        owner: resource.owner,
        openedAt: resource.openedAt,
        deadlineAt: resource.deadlineAt,
        processes: resource.listProcesses(),
      });
    } catch (error) {
      this.options.logger.warn(
        { err: error, owner: resource.owner },
        "Failed to record a host daemon resource",
      );
    }
    this.armDeadlineTimer();
  }

  scheduleDeadlines(): void {
    this.armDeadlineTimer();
  }

  retain(resource: DaemonResource, end: ResourceEnd): void {
    this.persist(resource);
    if (!this.resources.delete(resource)) return;
    this.recordEnd(resource, end);
    this.armDeadlineTimer();
  }

  release(resource: DaemonResource, end: ResourceEnd): void {
    if (!this.resources.delete(resource)) return;
    this.recordEnd(resource, end);
    rmSync(this.recordPath(resource.id), { force: true });
    this.armDeadlineTimer();
  }

  private recordEnd(resource: DaemonResource, end: ResourceEnd): void {
    if (resource.owner.kind === "environment-hook")
      this.endedOperations.set(resource.owner.operationId, {
        owner: resource.owner,
        end,
      });
  }

  private recordPath(id: string): string {
    return path.join(this.options.directory, `${id}.json`);
  }

  private readPreviousRecords(): PreviousRecord[] {
    const names = readdirSync(this.options.directory);
    for (const name of names)
      if (name.endsWith(".tmp"))
        rmSync(path.join(this.options.directory, name), { force: true });
    return names
      .filter((name) => name.endsWith(".json"))
      .flatMap((name): PreviousRecord[] => {
        const file = path.join(this.options.directory, name);
        let contents: unknown;
        try {
          contents = JSON.parse(readFileSync(file, "utf8"));
        } catch {
          contents = null;
        }
        const parsed = resourceRecordSchema.safeParse(contents);
        if (!parsed.success) {
          this.options.logger.warn(
            { file },
            "Keeping a host daemon resource record this version cannot read",
          );
          const owner = resourceOwnerSchema.safeParse(
            typeof contents === "object" && contents !== null
              ? Reflect.get(contents, "owner")
              : null,
          );
          return [
            {
              kind: "unreadable",
              owner: owner.success ? owner.data : null,
            },
          ];
        }
        if (parsed.data.instanceId === this.options.instanceId) return [];
        return [{ kind: "readable", file, record: parsed.data }];
      });
  }

  private armDeadlineTimer(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    const deadlines = [...this.resources].flatMap((resource) => {
      const at = resource.deadlineAt;
      return at === null || resource.expired ? [] : [at];
    });
    if (deadlines.length === 0) return;
    this.deadlineTimer = setTimeout(
      () => this.expireDueResources(),
      Math.min(Math.max(0, Math.min(...deadlines) - Date.now()), 2_147_483_647),
    );
    this.deadlineTimer.unref();
  }

  private expireDueResources(): void {
    const now = Date.now();
    const due = [...this.resources].filter((resource) => {
      const at = resource.deadlineAt;
      return at !== null && !resource.expired && at <= now;
    });
    for (const resource of due) resource.markExpired();
    this.armDeadlineTimer();
    for (const resource of due) void this.expire(resource);
  }

  private async expire(resource: DaemonResource): Promise<void> {
    this.options.logger.info(
      { owner: resource.owner, deadlineAt: resource.deadlineAt },
      "Host daemon resource reached its deadline",
    );
    await resource.captureTree();
    await Promise.race([
      resource.runDeadlineHandler(),
      new Promise((resolve) =>
        setTimeout(resolve, DEADLINE_STOP_GRACE_MS).unref(),
      ),
    ]);
    if (resource.closed) return;
    const deadlineAt = resource.deadlineAt;
    if (deadlineAt === null || deadlineAt > Date.now()) {
      resource.clearExpired();
      this.armDeadlineTimer();
      return;
    }
    this.options.logger.warn(
      { owner: resource.owner },
      "Stopping a host daemon resource its owner did not end by the deadline",
    );
    await resource.close({
      status: "failed",
      message: "The resource was stopped at its deadline",
      terminationUnverified: false,
    });
  }

  shutdown(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    for (const resource of [...this.resources]) {
      resource.forgetExitedProcesses();
      if (resource.listProcesses().length === 0) void resource.close();
    }
  }
}

function writeRecordFile(file: string, record: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, file);
}
