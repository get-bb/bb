import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { upsertCandidate } from "../registry/store.js";
import {
  readSerial,
  registerSerialRpc,
  runFsSerial,
  sendSerial,
  type SendConfirmation,
  type SerialServiceContext,
  serialRpcContract,
} from "./fs-serial.js";
import { createSerialRuntime } from "./session.js";
import type { SerialPortRef, SerialTransport } from "./transport.js";

class FakeTransport implements SerialTransport {
  readonly write = vi.fn(async (_data: Uint8Array) => undefined);
  async open(_port: SerialPortRef, _options: { baud: number }): Promise<void> {}
  async close(): Promise<void> {}
  private data: (chunk: Uint8Array) => void = () => undefined;
  onData(handler: (chunk: Uint8Array) => void): void {
    this.data = handler;
  }
  onClosed(_handler: (reason: string) => void): void {}
  emit(text: string): void {
    this.data(new TextEncoder().encode(text));
  }
}

const databases: Database.Database[] = [];
const directories: string[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  for (const db of databases.splice(0)) db.close();
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(maxLines = 3) {
  const db = new Database(":memory:");
  databases.push(db);
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
  const artifactRoot = await mkdtemp(join(tmpdir(), "fs122-service-"));
  directories.push(artifactRoot);
  const scope = { projectId: "project-a", projectVersionId: null };
  const deviceId = upsertCandidate(
    db,
    scope,
    "serial-ports",
    "serial",
    {
      stableIdentity: "SERIAL-A",
      make: "Acme",
      model: "UART",
      connection: "tty:/dev/serial-a",
      transport: "local-usb",
    },
    "2026-08-13T12:00:00.000Z",
  ).deviceId;
  const transport = new FakeTransport();
  const runtime = createSerialRuntime({
    db,
    artifactRoot,
    publish: () => undefined,
    helperStatus: async () => ({ configured: true, message: null }),
    transportFactory: () => transport,
    claimRefreshMs: 1_000_000,
    ring: { maxLines, maxBytes: 1_000_000 },
  });
  await runtime.open(scope, deviceId);
  const context: SerialServiceContext = {
    ...scope,
    db,
    validateSendConfirmation: (value) => value === confirmation,
  };
  return { artifactRoot, context, deviceId, runtime, transport };
}

const confirmation = { confirmed: true } as unknown as SendConfirmation;
const invalidConfirmation = { confirmed: false } as unknown as SendConfirmation;

describe("fs_serial service", () => {
  it("returns bounded cursor-resumable lines and explicit gaps without gating read", async () => {
    const fx = await fixture();
    fx.transport.emit("one\ntwo\nthree\nfour\n");
    const first = await readSerial(fx.context, {
      device: fx.deviceId,
      maxLines: 2,
    });
    expect(first).toMatchObject({
      lines: [{ text: "two" }, { text: "three" }],
      gaps: [{ dropped: 1 }],
    });
    const resumed = await runFsSerial(fx.context, {
      mode: "read",
      device: fx.deviceId,
      cursor: first.nextCursor,
      maxLines: 500,
    });
    expect(resumed).toMatchObject({ lines: [{ text: "four" }], nextCursor: 4 });
    await fx.runtime.dispose();
  });

  it("fails closed before transport write without a valid send confirmation", async () => {
    const fx = await fixture();
    await expect(
      sendSerial(fx.context, {
        device: fx.deviceId,
        data: "AT+RESET",
        confirmation: invalidConfirmation,
      }),
    ).rejects.toThrow(/SEND_CONFIRMATION_REQUIRED/u);
    expect(fx.transport.write).not.toHaveBeenCalled();
    await expect(
      sendSerial(fx.context, {
        device: fx.deviceId,
        data: "AT+PING",
        confirmation,
      }),
    ).resolves.toEqual({ bytes: 7 });
    expect(fx.transport.write).toHaveBeenCalledOnce();
    expect(
      (await readSerial(fx.context, { device: fx.deviceId })).lines.at(-1),
    ).toMatchObject({ dir: "tx", text: "AT+PING" });
    await fx.runtime.dispose();
  });

  it("clamps agent reads to the shared response page budget", async () => {
    const fx = await fixture(300);
    fx.transport.emit(
      `${Array.from({ length: 250 }, (_, index) => `line-${index}`).join("\n")}\n`,
    );
    const result = await readSerial(fx.context, {
      device: fx.deviceId,
      maxLines: 500,
    });
    expect(result.lines.length).toBeLessThanOrEqual(200);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.nextCursor).toBe(result.lines.at(-1)?.cursor);
    const resumed = await readSerial(fx.context, {
      device: fx.deviceId,
      cursor: result.nextCursor,
      maxLines: 500,
    });
    expect(resumed.lines[0]?.cursor).toBe(result.nextCursor + 1);
    await fx.runtime.dispose();
  });

  it("requires a single-use server-minted RPC token bound to scope, device, and bytes", async () => {
    const fx = await fixture();
    const host = createFakePluginHost({ pluginId: "fs122-serial-send-rpc" });
    hosts.push(host);
    registerSerialRpc(host.bb, fx.runtime);

    await expect(
      host.harness.callRpc("benchDevSerialSend", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+PING",
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect(fx.transport.write).not.toHaveBeenCalled();

    const approval = serialRpcContract.benchDevSerialSendReview.output.parse(
      await host.harness.callRpc("benchDevSerialSendReview", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+PING",
      }),
    );
    await expect(
      host.harness.callRpc("benchDevSerialSend", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+RESET",
        sendToken: approval.sendToken,
      }),
    ).rejects.toThrow(/SEND_CONFIRMATION_REQUIRED/u);
    expect(fx.transport.write).not.toHaveBeenCalled();

    const approved = serialRpcContract.benchDevSerialSendReview.output.parse(
      await host.harness.callRpc("benchDevSerialSendReview", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+PING",
      }),
    );
    await expect(
      host.harness.callRpc("benchDevSerialSend", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+PING",
        sendToken: approved.sendToken,
      }),
    ).resolves.toEqual({ bytes: 7 });
    await expect(
      host.harness.callRpc("benchDevSerialSend", {
        ...scopeFor(fx.context),
        device: fx.deviceId,
        data: "AT+PING",
        sendToken: approved.sendToken,
      }),
    ).rejects.toThrow(/SEND_CONFIRMATION_REQUIRED/u);
    expect(fx.transport.write).toHaveBeenCalledOnce();
    await fx.runtime.dispose();
  });

  it("liveness-qualifies a prior-process connected row through the registered RPC", async () => {
    const fx = await fixture();
    const restartedRuntime = createSerialRuntime({
      db: fx.context.db,
      artifactRoot: fx.artifactRoot,
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => new FakeTransport(),
      claimRefreshMs: 1_000_000,
    });
    const host = createFakePluginHost({
      pluginId: "fs161-serial-liveness-rpc",
    });
    hosts.push(host);
    registerSerialRpc(host.bb, restartedRuntime);

    const current = serialRpcContract.benchDevSerialSessionCurrent.output.parse(
      await host.harness.callRpc("benchDevSerialSessionCurrent", {
        ...scopeFor(fx.context),
        deviceId: fx.deviceId,
      }),
    );
    expect(current).toMatchObject({
      state: "closed",
      message: expect.stringContaining("Connect to start a new session"),
    });
    await expect(
      host.harness.callRpc("benchDevSerialSessionClose", {
        ...scopeFor(fx.context),
        deviceId: fx.deviceId,
      }),
    ).resolves.toEqual(current);

    await restartedRuntime.dispose();
    await fx.runtime.dispose();
  });
});

function scopeFor(context: SerialServiceContext): {
  projectId: string;
  projectVersionId: string | null;
} {
  return {
    projectId: context.projectId,
    projectVersionId: context.projectVersionId,
  };
}
