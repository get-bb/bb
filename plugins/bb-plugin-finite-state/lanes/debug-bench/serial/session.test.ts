import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { confirmationFixture, createFixture, type AuthoringFixture } from "../../authoring/build/test-fixture.js";
import { runBuild } from "../../authoring/build/runner.js";
import { runFlash } from "../../authoring/build/flash.js";
import { listClaimEvents } from "../registry/claims.js";
import { recordFamilyStatus, upsertCandidate } from "../registry/store.js";
import { associateSerialDevice, createSerialRuntime } from "./session.js";
import type { SerialPortRef, SerialTransport } from "./transport.js";

class FakeTransport implements SerialTransport {
  constructor(private readonly openFailure: string | null = null) {}
  readonly open = vi.fn(async (_port: SerialPortRef, _options: { baud: number }) => {
    if (this.openFailure) throw new Error(this.openFailure);
  });
  readonly write = vi.fn(async (_data: Uint8Array) => undefined);
  readonly close = vi.fn(async () => undefined);
  private data: (chunk: Uint8Array) => void = () => undefined;
  private closed: (reason: string) => void = () => undefined;
  onData(handler: (chunk: Uint8Array) => void): void { this.data = handler; }
  onClosed(handler: (reason: string) => void): void { this.closed = handler; }
  emit(text: string): void { this.data(new TextEncoder().encode(text)); }
  disconnect(reason: string): void { this.closed(reason); }
}

const databases: Database.Database[] = [];
const directories: string[] = [];
const fixtures: AuthoringFixture[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

function database(): Database.Database {
  const db = new Database(":memory:");
  databases.push(db);
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
  return db;
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "fs122-session-"));
  directories.push(value);
  return value;
}

const scope = { projectId: "project-a", projectVersionId: "version-a" };

function seedSerial(db: Database.Database, identity = "SERIAL-A"): string {
  return upsertCandidate(db, scope, "serial-ports", "serial", {
    stableIdentity: identity,
    make: "Acme",
    model: "UART",
    connection: `/dev/${identity}`.replace("/dev/", "tty:/dev/"),
    transport: "local-usb",
  }, "2026-08-13T12:00:00.000Z").deviceId;
}

describe("serial session lifecycle", () => {
  it("captures bursts without blocking, reconnects with a cap, and explicit close stops reopen", async () => {
    const db = database();
    const deviceId = seedSerial(db);
    const transports: FakeTransport[] = [];
    const delays: number[] = [];
    const runtime = createSerialRuntime({
      db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      sleep: async (ms, signal) => {
        delays.push(ms);
        if (ms !== 1_000_000) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      reconnectBaseMs: 10,
      reconnectMaxMs: 20,
      reconnectJitter: 0,
      reconnectAttempts: 3,
      claimRefreshMs: 1_000_000,
      ring: { maxLines: 3, maxBytes: 100 },
    });
    const session = await runtime.open(scope, deviceId);
    transports[0]!.emit("one\ntwo\nthree\nfour\n");
    await expect(session.read({ cursor: 0, maxLines: 10 })).resolves.toMatchObject({
      state: "connected",
      gaps: [{ dropped: 1 }],
      lines: [{ text: "two" }, { text: "three" }, { text: "four" }],
    });
    transports[0]!.disconnect("cable unplugged");
    await vi.waitFor(() => expect(transports).toHaveLength(2));
    expect(session.state).toBe("connected");
    expect(transports[0]!.close).toHaveBeenCalledOnce();
    expect(delays).toContain(10);

    await session.close();
    transports[1]!.disconnect("helper died after close");
    await Promise.resolve();
    expect(transports).toHaveLength(2);
    expect(listClaimEvents(db, deviceId).filter((event) => event.reason === "released"))
      .toHaveLength(1);
    await runtime.dispose();
  });

  it("lands unconfigured without claiming when Python/pyserial is absent", async () => {
    const db = database();
    const deviceId = seedSerial(db);
    recordFamilyStatus(db, scope, {
      familyId: "serial-ports",
      kind: "serial",
      label: "Serial ports",
      availability: "unavailable",
      reason: "pyserial is unavailable",
      helper: {
        id: "python-pyserial",
        displayName: "Python pyserial",
        source: "python3 -m pip install pyserial",
        why: "Required for UART sessions",
      },
      needsConfiguration: true,
      checkedAt: "2026-08-13T12:00:01.000Z",
    });
    const transportFactory = vi.fn(() => new FakeTransport());
    const runtime = createSerialRuntime({
      db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: false, message: "pyserial missing" }),
      transportFactory,
    });
    const session = await runtime.open(scope, deviceId);
    expect(session.record()).toMatchObject({ state: "unconfigured", message: "pyserial missing" });
    await runtime.dispose();
    const reloaded = createSerialRuntime({
      db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: false, message: "pyserial missing" }),
    });
    await expect(reloaded.read(scope, { device: deviceId, maxLines: 10 })).resolves.toMatchObject({
      state: "unconfigured",
      lines: [],
    });
    expect(listClaimEvents(db, deviceId)).toEqual([]);
    expect(transportFactory).not.toHaveBeenCalled();
    await reloaded.dispose();
  });

  it("caps reconnect backoff, closes after exhaustion, and releases its claim", async () => {
    const db = database();
    const deviceId = seedSerial(db);
    const delays: number[] = [];
    const transports: FakeTransport[] = [];
    let transportCount = 0;
    const runtime = createSerialRuntime({
      db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => {
        const transport = new FakeTransport(
          transportCount++ === 0 ? null : "port remains unavailable",
        );
        transports.push(transport);
        return transport;
      },
      sleep: async (ms, signal) => {
        delays.push(ms);
        if (ms !== 1_000_000) return;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      reconnectBaseMs: 10,
      reconnectMaxMs: 20,
      reconnectJitter: 0,
      reconnectAttempts: 3,
      claimRefreshMs: 1_000_000,
    });
    const session = await runtime.open(scope, deviceId);
    transports[0]!.disconnect("helper exited");
    await vi.waitFor(() => expect(session.state).toBe("closed"));
    expect(delays.filter((delay) => delay < 1_000_000)).toEqual([10, 20, 20]);
    expect(session.record().message).toContain("exhausted");
    expect(listClaimEvents(db, deviceId).filter((event) => event.reason === "released"))
      .toHaveLength(1);
    await runtime.dispose();
  });

  it("auto-connects only to the identity-associated port after scoped flash and no-ops when open", async () => {
    const fx = await createFixture({ confirmationValid: true });
    fixtures.push(fx);
    const serialScope = { projectId: fx.ctx.projectId, projectVersionId: fx.ctx.projectVersionId };
    const flashedDeviceId = upsertCandidate(fx.ctx.db, serialScope, "probe-rs", "probe", {
      stableIdentity: "probe-a",
      make: "Acme",
      model: "Probe",
      connection: "usb:probe-a",
      transport: "local-usb",
    }, "2026-08-13T12:00:00.000Z").deviceId;
    const serialDeviceId = upsertCandidate(fx.ctx.db, serialScope, "serial-ports", "serial", {
      stableIdentity: "serial-a",
      make: "Acme",
      model: "UART",
      connection: "tty:/dev/serial-a",
      transport: "local-usb",
    }, "2026-08-13T12:00:00.000Z").deviceId;
    associateSerialDevice(fx.ctx.db, serialScope, flashedDeviceId, serialDeviceId);
    const transports: FakeTransport[] = [];
    const runtime = createSerialRuntime({
      db: fx.ctx.db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      claimRefreshMs: 1_000_000,
    });
    runtime.observeScope(serialScope);
    const build = await runBuild(fx.ctx, {});
    await runFlash(fx.ctx, {
      runId: build.runId,
      device: flashedDeviceId,
      confirmation: confirmationFixture(),
    });
    await vi.waitFor(() => expect(runtime.current(serialScope, serialDeviceId)?.state).toBe("connected"));
    expect(transports).toHaveLength(1);
    await runFlash(fx.ctx, {
      runId: build.runId,
      device: flashedDeviceId,
      confirmation: confirmationFixture(),
    });
    await vi.waitFor(() => expect(runtime.autoConnectStatus(serialScope)?.state).toBe("connected"));
    expect(transports).toHaveLength(1);
    await runtime.dispose();
  });

  it("falls back to the last-used live registry port when no explicit association exists", async () => {
    const fx = await createFixture({ confirmationValid: true });
    fixtures.push(fx);
    const serialScope = { projectId: fx.ctx.projectId, projectVersionId: fx.ctx.projectVersionId };
    const flashedDeviceId = upsertCandidate(fx.ctx.db, serialScope, "probe-rs", "probe", {
      stableIdentity: "probe-fallback", make: "Acme", model: "Probe",
      connection: "usb:probe-fallback", transport: "local-usb",
    }, "2026-08-13T12:00:00.000Z").deviceId;
    const serialDeviceId = upsertCandidate(fx.ctx.db, serialScope, "serial-ports", "serial", {
      stableIdentity: "serial-fallback", make: "Acme", model: "UART",
      connection: "tty:/dev/serial-fallback", transport: "local-usb",
    }, "2026-08-13T12:00:00.000Z").deviceId;
    const transports: FakeTransport[] = [];
    const runtime = createSerialRuntime({
      db: fx.ctx.db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      claimRefreshMs: 1_000_000,
    });
    await runtime.open(serialScope, serialDeviceId);
    await runtime.close(serialScope, serialDeviceId);
    const build = await runBuild(fx.ctx, {});
    await runFlash(fx.ctx, {
      runId: build.runId,
      device: flashedDeviceId,
      confirmation: confirmationFixture(),
    });
    await vi.waitFor(() => expect(runtime.current(serialScope, serialDeviceId)?.state).toBe("connected"));
    expect(runtime.autoConnectStatus(serialScope)).toMatchObject({
      flashedDeviceId,
      serialDeviceId,
      state: "connected",
    });
    expect(transports).toHaveLength(2);
    await runtime.dispose();
  });

  it("bounds unterminated lines and throttles cursor persistence during bursts", async () => {
    const db = database();
    const deviceId = seedSerial(db);
    const transport = new FakeTransport();
    const prepare = vi.spyOn(db, "prepare");
    const runtime = createSerialRuntime({
      db,
      artifactRoot: await root(),
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => transport,
      claimRefreshMs: 1_000_000,
      persistThrottleMs: 1_000,
      partialLineMaxBytes: 8,
      ring: { maxLines: 100, maxBytes: 10_000 },
    });
    const session = await runtime.open(scope, deviceId);
    const beforeBurst = prepare.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO bench_serial_session"),
    ).length;
    transport.emit("abcdefghijklmnopqrst");
    expect((await session.read({ maxLines: 10 })).lines.map((line) => line.text)).toEqual([
      "abcdefgh",
      "ijklmnop",
    ]);
    const afterBurst = prepare.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("INSERT INTO bench_serial_session"),
    ).length;
    expect(afterBurst - beforeBurst).toBeLessThanOrEqual(1);
    await session.close();
    expect(session.record().latestCursor).toBe(3);
    await runtime.dispose();
  });
});
