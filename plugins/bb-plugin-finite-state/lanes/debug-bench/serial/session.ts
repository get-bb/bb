import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import {
  fromStorageProjectVersionId,
  toStorageProjectVersionId,
} from "../../../lib/store/index.js";
import {
  subscribeFlashCompleted,
  type FlashCompletedEvent,
} from "../../authoring/build/flash.js";
import { claimDevice, refreshClaim, releaseDevice } from "../registry/claims.js";
import type { BenchContext } from "../registry/enumerate.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import { getDevice, type RegistryScope } from "../registry/store.js";
import { compileSerialFilter } from "./filter.js";
import {
  createSerialRingBuffer,
  type SerialRingBuffer,
  type SerialRingBufferOptions,
  type SerialRingRead,
} from "./ring-buffer.js";
import {
  createSerialTransport,
  detectSerialHelper,
  SerialTransportError,
  type SerialHelperStatus,
  type SerialPortRef,
  type SerialTransport,
} from "./transport.js";
import {
  openSerialTranscript,
  type SerialTranscript,
  type SerialTranscriptOptions,
} from "./transcript.js";

export type SerialSessionState = "connected" | "reconnecting" | "closed" | "unconfigured";

export interface SerialSessionRecord extends RegistryScope {
  sessionId: string;
  deviceId: string;
  state: SerialSessionState;
  baud: number;
  latestCursor: number;
  droppedLines: number;
  openedAt: string;
  closedAt: string | null;
  message: string | null;
}

export interface SerialReadResult extends SerialRingRead {
  state: SerialSessionState;
}

export interface SerialAutoConnectStatus {
  state: SerialSessionState;
  flashedDeviceId: string;
  serialDeviceId: string | null;
  message: string | null;
  updatedAt: string;
}

const SERIAL_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS bench_serial_session (
     project_id TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     device_id TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('connected','reconnecting','closed','unconfigured')),
     baud INTEGER NOT NULL,
     latest_cursor INTEGER NOT NULL DEFAULT 0,
     dropped_lines INTEGER NOT NULL DEFAULT 0,
     opened_at TEXT NOT NULL,
     closed_at TEXT,
     message TEXT,
     PRIMARY KEY (project_id, project_version_id, session_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_bench_serial_session_device
     ON bench_serial_session (project_id, project_version_id, device_id, opened_at DESC)`,
  `CREATE TABLE IF NOT EXISTS bench_serial_preference (
     project_id TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     last_device_id TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id)
   )`,
  `CREATE TABLE IF NOT EXISTS bench_serial_association (
     project_id TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     flashed_device_id TEXT NOT NULL,
     serial_device_id TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, flashed_device_id)
   )`,
  `CREATE TABLE IF NOT EXISTS bench_serial_auto_connect (
     project_id TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('connected','reconnecting','closed','unconfigured')),
     flashed_device_id TEXT NOT NULL,
     serial_device_id TEXT,
     message TEXT,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id)
   )`,
] as const;

export function initializeSerialStore(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of SERIAL_MIGRATIONS) db.exec(statement);
  })();
}

interface SessionRow {
  project_id: string;
  project_version_id: string;
  session_id: string;
  device_id: string;
  state: SerialSessionState;
  baud: number;
  latest_cursor: number;
  dropped_lines: number;
  opened_at: string;
  closed_at: string | null;
  message: string | null;
}

function sessionRecord(row: SessionRow): SerialSessionRecord {
  return {
    projectId: row.project_id,
    projectVersionId: fromStorageProjectVersionId(row.project_version_id),
    sessionId: row.session_id,
    deviceId: row.device_id,
    state: row.state,
    baud: row.baud,
    latestCursor: row.latest_cursor,
    droppedLines: row.dropped_lines,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    message: row.message,
  };
}

function stringField(input: object, key: string): string {
  const value: unknown = Reflect.get(input, key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`INVALID_SERIAL_SESSION_${key.toUpperCase()}`);
  }
  return value;
}

export function getSerialSession(db: Database.Database, input: object): SerialSessionRecord {
  initializeSerialStore(db);
  const projectId = stringField(input, "projectId");
  const projectVersionValue: unknown = Reflect.get(input, "projectVersionId");
  if (projectVersionValue !== null && typeof projectVersionValue !== "string") {
    throw new Error("INVALID_SERIAL_SESSION_PROJECT_VERSION_ID");
  }
  const sessionId = stringField(input, "sessionId");
  const row = db.prepare<[string, string, string], SessionRow>(
    `SELECT * FROM bench_serial_session
      WHERE project_id = ? AND project_version_id = ? AND session_id = ?`,
  ).get(
    projectId,
    toStorageProjectVersionId(projectVersionValue),
    sessionId,
  );
  if (!row) throw new Error(`SERIAL_SESSION_NOT_FOUND:${sessionId}`);
  return sessionRecord(row);
}

function sessionKey(scope: RegistryScope, deviceId: string): string {
  return `${scope.projectId}\0${toStorageProjectVersionId(scope.projectVersionId)}\0${deviceId}`;
}

function scopeKey(scope: RegistryScope): string {
  return `${scope.projectId}\0${toStorageProjectVersionId(scope.projectVersionId)}`;
}

function portFromDevice(device: BenchDeviceRecord): SerialPortRef {
  if (device.kind !== "serial") throw new Error(`DEVICE_NOT_SERIAL:${device.deviceId}`);
  if (device.stale) throw new Error(`SERIAL_DEVICE_STALE:${device.deviceId}`);
  if (device.transport !== "local-usb" || !device.connection.startsWith("tty:")) {
    throw new Error(`SERIAL_TRANSPORT_UNSUPPORTED:${device.deviceId}`);
  }
  const portPath = device.connection.slice("tty:".length);
  if (!portPath) throw new Error(`SERIAL_PORT_MISSING:${device.deviceId}`);
  return { deviceId: device.deviceId, portPath };
}

function boundedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown serial failure").slice(0, 1000);
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SerialRuntimeOptions {
  db: Database.Database;
  artifactRoot?: string;
  publish(channel: string, payload: { deviceId: string; cursor: number }): void;
  log?: { warn(message: string): void };
  transportFactory?: () => SerialTransport;
  helperStatus?: () => Promise<SerialHelperStatus>;
  now?: () => Date;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectAttempts?: number;
  reconnectJitter?: number;
  claimRefreshMs?: number;
  realtimeThrottleMs?: number;
  persistThrottleMs?: number;
  partialLineMaxBytes?: number;
  ring?: SerialRingBufferOptions;
  transcript?: Pick<SerialTranscriptOptions, "maxBytes" | "maxSessions">;
}

interface ResolvedRuntimeOptions extends SerialRuntimeOptions {
  artifactRoot: string;
  transportFactory: () => SerialTransport;
  helperStatus: () => Promise<SerialHelperStatus>;
  now: () => Date;
  random: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  reconnectAttempts: number;
  reconnectJitter: number;
  claimRefreshMs: number;
  realtimeThrottleMs: number;
  persistThrottleMs: number;
  partialLineMaxBytes: number;
}

export class SerialSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly scope: RegistryScope;
  readonly baud: number;
  readonly openedAt: string;
  readonly buffer: SerialRingBuffer;
  private stateValue: SerialSessionState = "reconnecting";
  private messageValue: string | null = null;
  private closedAtValue: string | null = null;
  private transport: SerialTransport | null = null;
  private transcript: SerialTranscript | null = null;
  private transcriptWrites: Promise<void> = Promise.resolve();
  private readonly decoder = new TextDecoder();
  private partialLine = "";
  private claimed = false;
  private explicitClose = false;
  private reconnectTask: Promise<void> | null = null;
  private refreshTask: Promise<void> | null = null;
  private readonly lifecycle = new AbortController();
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHintAt = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistAt = 0;

  constructor(
    private readonly runtime: SerialRuntime,
    scope: RegistryScope,
    deviceId: string,
    baud: number,
  ) {
    this.scope = scope;
    this.deviceId = deviceId;
    this.baud = baud;
    this.sessionId = `serial-${randomUUID()}`;
    this.openedAt = runtime.options.now().toISOString();
    this.buffer = createSerialRingBuffer(runtime.options.ring);
    this.persistNow();
  }

  get state(): SerialSessionState {
    return this.stateValue;
  }

  record(): SerialSessionRecord {
    return {
      ...this.scope,
      sessionId: this.sessionId,
      deviceId: this.deviceId,
      state: this.stateValue,
      baud: this.baud,
      latestCursor: this.buffer.latestCursor,
      droppedLines: this.buffer.droppedLines,
      openedAt: this.openedAt,
      closedAt: this.closedAtValue,
      message: this.messageValue,
    };
  }

  private persistNow(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.lastPersistAt = this.runtime.options.now().getTime();
    const record = this.record();
    this.runtime.options.db.prepare(
      `INSERT INTO bench_serial_session (
         project_id, project_version_id, session_id, device_id, state, baud,
         latest_cursor, dropped_lines, opened_at, closed_at, message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, project_version_id, session_id) DO UPDATE SET
         state = excluded.state,
         latest_cursor = excluded.latest_cursor,
         dropped_lines = excluded.dropped_lines,
         closed_at = excluded.closed_at,
         message = excluded.message`,
    ).run(
      record.projectId,
      toStorageProjectVersionId(record.projectVersionId),
      record.sessionId,
      record.deviceId,
      record.state,
      record.baud,
      record.latestCursor,
      record.droppedLines,
      record.openedAt,
      record.closedAt,
      record.message,
    );
  }

  private schedulePersist(): void {
    const elapsed = this.runtime.options.now().getTime() - this.lastPersistAt;
    if (elapsed >= this.runtime.options.persistThrottleMs) {
      this.persistNow();
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(
      () => this.persistNow(),
      this.runtime.options.persistThrottleMs - elapsed,
    );
  }

  private setState(state: SerialSessionState, message: string | null = null): void {
    this.stateValue = state;
    this.messageValue = message;
    if (state === "closed" || state === "unconfigured") {
      this.closedAtValue ??= this.runtime.options.now().toISOString();
    }
    this.persistNow();
    this.publishHint(true);
  }

  private publishHint(immediate = false): void {
    const now = this.runtime.options.now().getTime();
    const elapsed = now - this.lastHintAt;
    if (immediate || elapsed >= this.runtime.options.realtimeThrottleMs) {
      if (this.hintTimer) clearTimeout(this.hintTimer);
      this.hintTimer = null;
      this.lastHintAt = now;
      this.runtime.options.publish("serial:changed", {
        deviceId: this.deviceId,
        cursor: this.buffer.latestCursor,
      });
      return;
    }
    if (this.hintTimer) return;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      if (!this.explicitClose) this.publishHint(true);
    }, this.runtime.options.realtimeThrottleMs - elapsed);
  }

  private queueTranscript(at: string, dir: "rx" | "tx", text: string): void {
    const transcript = this.transcript;
    if (!transcript) return;
    this.transcriptWrites = this.transcriptWrites
      .then(() => transcript.append({ at, dir, text }))
      .catch((error: unknown) => {
        this.messageValue = `Transcript write failed: ${boundedMessage(error)}`;
        this.persistNow();
        this.runtime.options.log?.warn(this.messageValue);
      });
  }

  private appendLine(dir: "rx" | "tx", text: string): void {
    const at = this.runtime.options.now().toISOString();
    this.buffer.append({ at, dir, text });
    this.queueTranscript(at, dir, text);
    this.schedulePersist();
    this.publishHint();
  }

  private receive(chunk: Uint8Array): void {
    const decoded = this.decoder.decode(chunk, { stream: true });
    const parts = `${this.partialLine}${decoded}`.split("\n");
    this.partialLine = parts.pop() ?? "";
    for (const part of parts) this.appendLine("rx", part.endsWith("\r") ? part.slice(0, -1) : part);
    while (Buffer.byteLength(this.partialLine, "utf8") > this.runtime.options.partialLineMaxBytes) {
      let end = Math.min(this.partialLine.length, this.runtime.options.partialLineMaxBytes);
      while (
        end > 0 &&
        Buffer.byteLength(this.partialLine.slice(0, end), "utf8") >
          this.runtime.options.partialLineMaxBytes
      ) end -= 1;
      if (end === 0) break;
      this.appendLine("rx", this.partialLine.slice(0, end));
      this.partialLine = this.partialLine.slice(end);
    }
  }

  private flushPartial(): void {
    const tail = `${this.partialLine}${this.decoder.decode()}`;
    this.partialLine = "";
    if (tail.length > 0) this.appendLine("rx", tail.endsWith("\r") ? tail.slice(0, -1) : tail);
  }

  private beginReconnect(reason: string): void {
    if (this.explicitClose || this.lifecycle.signal.aborted || this.reconnectTask) return;
    this.setState("reconnecting", reason);
    this.reconnectTask = this.reconnectLoop()
      .catch((error: unknown) => this.finishClosed(boundedMessage(error)))
      .finally(() => {
        this.reconnectTask = null;
      });
  }

  private async reconnectLoop(): Promise<void> {
    for (let attempt = 0; attempt < this.runtime.options.reconnectAttempts; attempt += 1) {
      const exponential = Math.min(
        this.runtime.options.reconnectMaxMs,
        this.runtime.options.reconnectBaseMs * (2 ** attempt),
      );
      const jitter = exponential * this.runtime.options.reconnectJitter *
        ((this.runtime.options.random() * 2) - 1);
      const delay = Math.min(
        this.runtime.options.reconnectMaxMs,
        Math.max(0, Math.round(exponential + jitter)),
      );
      await this.runtime.options.sleep(delay, this.lifecycle.signal);
      if (this.lifecycle.signal.aborted || this.explicitClose) return;
      try {
        refreshClaim(this.runtime.options.db, this.deviceId, this.holder, { scope: this.scope });
        await this.connectTransport();
        return;
      } catch (error) {
        if (error instanceof SerialTransportError && error.code === "SERIAL_HELPER_UNCONFIGURED") {
          await this.finishUnconfigured(error.message);
          return;
        }
        this.setState("reconnecting", boundedMessage(error));
      }
    }
    await this.finishClosed("Serial reconnect attempts were exhausted.");
  }

  private get holder(): string {
    return `serial-session:${this.sessionId}`;
  }

  private async connectTransport(): Promise<void> {
    const device = getDevice(this.runtime.options.db, this.scope, this.deviceId);
    if (!device) throw new Error(`DEVICE_NOT_FOUND:${this.deviceId}`);
    const transport = this.runtime.options.transportFactory();
    this.transport = transport;
    transport.onData((chunk) => this.receive(chunk));
    transport.onClosed((reason) => {
      if (this.transport !== transport) return;
      this.transport = null;
      void transport.close()
        .catch((error: unknown) => {
          this.runtime.options.log?.warn(`Serial transport cleanup failed: ${boundedMessage(error)}`);
        })
        .finally(() => this.beginReconnect(reason));
    });
    try {
      await transport.open(portFromDevice(device), { baud: this.baud });
    } catch (error) {
      if (this.transport === transport) this.transport = null;
      await transport.close().catch(() => undefined);
      throw error;
    }
    if (this.explicitClose) {
      await transport.close();
      return;
    }
    this.setState("connected");
  }

  private startClaimRefresh(): void {
    if (this.refreshTask) return;
    this.refreshTask = (async () => {
      while (!this.lifecycle.signal.aborted) {
        await this.runtime.options.sleep(
          this.runtime.options.claimRefreshMs,
          this.lifecycle.signal,
        );
        if (this.lifecycle.signal.aborted) return;
        try {
          refreshClaim(this.runtime.options.db, this.deviceId, this.holder, { scope: this.scope });
        } catch (error) {
          this.beginReconnect(boundedMessage(error));
        }
      }
    })().finally(() => {
      this.refreshTask = null;
    });
  }

  async open(): Promise<this> {
    const helper = await this.runtime.options.helperStatus();
    if (!helper.configured) {
      this.setState("unconfigured", helper.message ?? "Python with pyserial is required.");
      return this;
    }
    claimDevice(this.runtime.options.db, this.deviceId, this.holder, { scope: this.scope });
    this.claimed = true;
    try {
      this.transcript = await openSerialTranscript({
        artifactRoot: this.runtime.options.artifactRoot,
        deviceId: this.deviceId,
        sessionId: this.sessionId,
        openedAt: this.openedAt,
        ...this.runtime.options.transcript,
      });
      await this.connectTransport();
      this.startClaimRefresh();
      return this;
    } catch (error) {
      if (error instanceof SerialTransportError && error.code === "SERIAL_HELPER_UNCONFIGURED") {
        await this.finishUnconfigured(error.message);
        return this;
      }
      this.beginReconnect(boundedMessage(error));
      return this;
    }
  }

  read(input: { cursor?: number; filter?: string; maxLines: number }): SerialReadResult {
    const include = compileSerialFilter(input.filter);
    return {
      ...this.buffer.read({ cursor: input.cursor, maxLines: input.maxLines, include }),
      state: this.stateValue,
    };
  }

  async write(data: string): Promise<{ bytes: number }> {
    if (this.stateValue !== "connected" || !this.transport) {
      throw new Error(`SERIAL_SESSION_NOT_CONNECTED:${this.deviceId}`);
    }
    const encoded = new TextEncoder().encode(data);
    await this.transport.write(encoded);
    this.appendLine("tx", data);
    return { bytes: encoded.byteLength };
  }

  private async releaseClaim(): Promise<void> {
    if (!this.claimed) return;
    this.claimed = false;
    try {
      releaseDevice(this.runtime.options.db, this.deviceId, this.holder, { scope: this.scope });
    } catch (error) {
      this.runtime.options.log?.warn(`Serial claim release failed: ${boundedMessage(error)}`);
    }
  }

  private async finishUnconfigured(message: string): Promise<void> {
    this.lifecycle.abort();
    this.setState("unconfigured", message);
    await this.transport?.close().catch(() => undefined);
    this.transport = null;
    await this.releaseClaim();
    await this.transcriptWrites;
    await this.transcript?.close().catch(() => undefined);
  }

  private async finishClosed(message: string | null): Promise<void> {
    if (this.stateValue === "closed" && this.closedAtValue) return;
    this.lifecycle.abort();
    this.flushPartial();
    this.setState("closed", message);
    await this.transport?.close().catch(() => undefined);
    this.transport = null;
    await this.releaseClaim();
    await this.transcriptWrites;
    await this.transcript?.close().catch(() => undefined);
  }

  async close(reason = "Closed explicitly."): Promise<SerialSessionRecord> {
    if (this.explicitClose) return this.record();
    this.explicitClose = true;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.lifecycle.abort();
    if (this.stateValue === "unconfigured" && reason === "Plugin scope unloaded.") {
      this.persistNow();
      return this.record();
    }
    await this.transport?.close().catch(() => undefined);
    this.transport = null;
    await this.reconnectTask;
    await this.refreshTask;
    await this.finishClosed(reason);
    return this.record();
  }
}

interface ScopeRow {
  project_id: string;
  project_version_id: string;
}

interface PreferenceRow { last_device_id: string }
interface AssociationRow { serial_device_id: string }
interface AutoConnectRow {
  state: SerialSessionState;
  flashed_device_id: string;
  serial_device_id: string | null;
  message: string | null;
  updated_at: string;
}

const runtimeByDatabase = new WeakMap<Database.Database, SerialRuntime>();

export class SerialRuntime {
  readonly options: ResolvedRuntimeOptions;
  private readonly sessions = new Map<string, SerialSession>();
  private readonly subscriptions = new Map<string, () => void>();
  private disposed = false;

  constructor(options: SerialRuntimeOptions) {
    initializeSerialStore(options.db);
    this.options = {
      ...options,
      artifactRoot: options.artifactRoot ?? join(dirname(options.db.name), ".fs-bench"),
      transportFactory: options.transportFactory ?? (() => createSerialTransport()),
      helperStatus: options.helperStatus ?? (() => detectSerialHelper()),
      now: options.now ?? (() => new Date()),
      random: options.random ?? Math.random,
      sleep: options.sleep ?? waitFor,
      reconnectBaseMs: options.reconnectBaseMs ?? 250,
      reconnectMaxMs: options.reconnectMaxMs ?? 10_000,
      reconnectAttempts: options.reconnectAttempts ?? 8,
      reconnectJitter: options.reconnectJitter ?? 0.2,
      claimRefreshMs: options.claimRefreshMs ?? 5 * 60_000,
      realtimeThrottleMs: options.realtimeThrottleMs ?? 50,
      persistThrottleMs: options.persistThrottleMs ?? 50,
      partialLineMaxBytes: options.partialLineMaxBytes ?? 64 * 1024,
    };
    runtimeByDatabase.set(options.db, this);
    const scopes = options.db.prepare<[], ScopeRow>(
      `SELECT DISTINCT project_id, project_version_id FROM bench_device`,
    ).all();
    for (const row of scopes) {
      this.observeScope({
        projectId: row.project_id,
        projectVersionId: fromStorageProjectVersionId(row.project_version_id),
      });
    }
  }

  observeScope(scope: RegistryScope): void {
    if (this.disposed || this.subscriptions.has(scopeKey(scope))) return;
    const dispose = subscribeFlashCompleted({ db: this.options.db, ...scope }, (event) => {
      void this.autoConnect(scope, event).catch((error: unknown) => {
        this.recordAutoConnect(scope, event.device, null, "closed", boundedMessage(error));
      });
    });
    this.subscriptions.set(scopeKey(scope), dispose);
  }

  async open(scope: RegistryScope, deviceId: string, baud = 115_200): Promise<SerialSession> {
    if (this.disposed) throw new Error("SERIAL_RUNTIME_DISPOSED");
    this.observeScope(scope);
    const device = getDevice(this.options.db, scope, deviceId);
    if (!device) throw new Error(`DEVICE_NOT_FOUND:${deviceId}`);
    portFromDevice(device);
    const key = sessionKey(scope, deviceId);
    const existing = this.sessions.get(key);
    if (existing && existing.state !== "closed" && existing.state !== "unconfigured") {
      return existing;
    }
    if (existing) await existing.close("Replaced by a new session.");
    const session = new SerialSession(this, scope, deviceId, baud);
    this.sessions.set(key, session);
    this.options.db.prepare(
      `INSERT INTO bench_serial_preference (
         project_id, project_version_id, last_device_id, updated_at
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, project_version_id) DO UPDATE SET
         last_device_id = excluded.last_device_id,
         updated_at = excluded.updated_at`,
    ).run(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      deviceId,
      this.options.now().toISOString(),
    );
    await session.open();
    return session;
  }

  current(scope: RegistryScope, deviceId: string): SerialSessionRecord | null {
    const active = this.sessions.get(sessionKey(scope, deviceId));
    if (active) return active.record();
    const row = this.options.db.prepare<[string, string, string], SessionRow>(
      `SELECT * FROM bench_serial_session
        WHERE project_id = ? AND project_version_id = ? AND device_id = ?
        ORDER BY opened_at DESC LIMIT 1`,
    ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), deviceId);
    return row ? sessionRecord(row) : null;
  }

  read(
    scope: RegistryScope,
    request: { device: string; cursor?: number; filter?: string; maxLines: number },
  ): SerialReadResult {
    const session = this.sessions.get(sessionKey(scope, request.device));
    if (!session) {
      return {
        lines: [],
        nextCursor: request.cursor ?? 0,
        gaps: [],
        state: this.current(scope, request.device)?.state ?? "closed",
      };
    }
    return session.read(request);
  }

  async send(scope: RegistryScope, deviceId: string, data: string): Promise<{ bytes: number }> {
    const session = this.sessions.get(sessionKey(scope, deviceId));
    if (!session) throw new Error(`SERIAL_SESSION_NOT_OPEN:${deviceId}`);
    return session.write(data);
  }

  async close(scope: RegistryScope, deviceId: string): Promise<SerialSessionRecord> {
    const session = this.sessions.get(sessionKey(scope, deviceId));
    if (!session) throw new Error(`SERIAL_SESSION_NOT_OPEN:${deviceId}`);
    return session.close();
  }

  autoConnectStatus(scope: RegistryScope): SerialAutoConnectStatus | null {
    const row = this.options.db.prepare<[string, string], AutoConnectRow>(
      `SELECT state, flashed_device_id, serial_device_id, message, updated_at
         FROM bench_serial_auto_connect
        WHERE project_id = ? AND project_version_id = ?`,
    ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId));
    return row ? {
      state: row.state,
      flashedDeviceId: row.flashed_device_id,
      serialDeviceId: row.serial_device_id,
      message: row.message,
      updatedAt: row.updated_at,
    } : null;
  }

  private recordAutoConnect(
    scope: RegistryScope,
    flashedDeviceId: string,
    serialDeviceId: string | null,
    state: SerialSessionState,
    message: string | null,
  ): void {
    this.options.db.prepare(
      `INSERT INTO bench_serial_auto_connect (
         project_id, project_version_id, state, flashed_device_id,
         serial_device_id, message, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, project_version_id) DO UPDATE SET
         state = excluded.state,
         flashed_device_id = excluded.flashed_device_id,
         serial_device_id = excluded.serial_device_id,
         message = excluded.message,
         updated_at = excluded.updated_at`,
    ).run(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      state,
      flashedDeviceId,
      serialDeviceId,
      message,
      this.options.now().toISOString(),
    );
    this.options.publish("serial:changed", { deviceId: serialDeviceId ?? flashedDeviceId, cursor: 0 });
  }

  private resolveAutoConnectDevice(
    scope: RegistryScope,
    event: FlashCompletedEvent,
  ): BenchDeviceRecord | null {
    const association = this.options.db.prepare<[string, string, string], AssociationRow>(
      `SELECT serial_device_id FROM bench_serial_association
        WHERE project_id = ? AND project_version_id = ? AND flashed_device_id = ?`,
    ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), event.device);
    if (association) {
      const associated = getDevice(this.options.db, scope, association.serial_device_id);
      if (associated?.kind === "serial") return associated;
      return null;
    }
    const serialDevices = this.options.db.prepare<[string, string, string, string], { device_id: string }>(
      `SELECT device_id FROM bench_device
        WHERE project_id = ? AND project_version_id = ? AND kind = 'serial'
          AND (device_id = ? OR connection = ?)
        LIMIT 1`,
    ).get(
      scope.projectId,
      toStorageProjectVersionId(scope.projectVersionId),
      event.device,
      event.device,
    );
    if (serialDevices) return getDevice(this.options.db, scope, serialDevices.device_id);
    const preference = this.options.db.prepare<[string, string], PreferenceRow>(
      `SELECT last_device_id FROM bench_serial_preference
        WHERE project_id = ? AND project_version_id = ?`,
    ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId));
    if (!preference) return null;
    const lastUsed = getDevice(this.options.db, scope, preference.last_device_id);
    if (lastUsed?.kind === "serial" && !lastUsed.stale) return lastUsed;
    return null;
  }

  private async autoConnect(scope: RegistryScope, event: FlashCompletedEvent): Promise<void> {
    const device = this.resolveAutoConnectDevice(scope, event);
    if (!device) {
      this.recordAutoConnect(
        scope,
        event.device,
        null,
        "closed",
        "No identity-verified serial port is associated with the flashed device.",
      );
      return;
    }
    const existing = this.sessions.get(sessionKey(scope, device.deviceId));
    if (existing && existing.state !== "closed" && existing.state !== "unconfigured") {
      this.recordAutoConnect(scope, event.device, device.deviceId, existing.state, null);
      return;
    }
    const session = await this.open(scope, device.deviceId);
    this.recordAutoConnect(scope, event.device, device.deviceId, session.state, session.record().message);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.subscriptions.values()) dispose();
    this.subscriptions.clear();
    await Promise.all([...this.sessions.values()].map((session) => session.close("Plugin scope unloaded.")));
    this.sessions.clear();
    if (runtimeByDatabase.get(this.options.db) === this) runtimeByDatabase.delete(this.options.db);
  }
}

export function createSerialRuntime(options: SerialRuntimeOptions): SerialRuntime {
  return new SerialRuntime(options);
}

export function registeredSerialRuntime(ctx: BenchContext): SerialRuntime {
  const runtime = runtimeByDatabase.get(ctx.db);
  if (!runtime) throw new Error("SERIAL_RUNTIME_NOT_REGISTERED");
  runtime.observeScope(ctx);
  return runtime;
}

export function openSession(
  ctx: BenchContext,
  deviceId: string,
  opts: { baud?: number } = {},
): Promise<SerialSession> {
  return registeredSerialRuntime(ctx).open(ctx, deviceId, opts.baud);
}

export function associateSerialDevice(
  db: Database.Database,
  scope: RegistryScope,
  flashedDeviceId: string,
  serialDeviceId: string,
  now = new Date(),
): void {
  initializeSerialStore(db);
  const flashed = getDevice(db, scope, flashedDeviceId);
  const serial = getDevice(db, scope, serialDeviceId);
  if (!flashed) throw new Error(`DEVICE_NOT_FOUND:${flashedDeviceId}`);
  if (!serial || serial.kind !== "serial") throw new Error(`DEVICE_NOT_SERIAL:${serialDeviceId}`);
  db.prepare(
    `INSERT INTO bench_serial_association (
       project_id, project_version_id, flashed_device_id, serial_device_id, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, project_version_id, flashed_device_id) DO UPDATE SET
       serial_device_id = excluded.serial_device_id,
       updated_at = excluded.updated_at`,
  ).run(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    flashedDeviceId,
    serialDeviceId,
    now.toISOString(),
  );
}
