// @vitest-environment jsdom
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fireEvent, waitFor } from "@testing-library/react";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import type { BenchDeviceRecord } from "../registry/families.js";
import { upsertCandidate } from "../registry/store.js";
import { registerSerialRpc, serialRpcContract } from "../serial/fs-serial.js";
import { createSerialRuntime, type SerialRuntime } from "../serial/session.js";
import type { SerialPortRef, SerialTransport } from "../serial/transport.js";

let SerialConsole: (typeof import("./serial-console.js"))["SerialConsole"];

class BackendTransport implements SerialTransport {
  async open(_port: SerialPortRef, _options: { baud: number }): Promise<void> {}
  async write(_data: Uint8Array): Promise<void> {}
  async close(): Promise<void> {}
  onData(_handler: (chunk: Uint8Array) => void): void {}
  onClosed(_handler: (reason: string) => void): void {}
}

const backendDatabases: Database.Database[] = [];
const backendDirectories: string[] = [];
const backendHosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const backendRuntimes: SerialRuntime[] = [];

afterEach(async () => {
  await Promise.allSettled(
    backendRuntimes.splice(0).map((runtime) => runtime.dispose()),
  );
  await Promise.all(
    backendHosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
  for (const db of backendDatabases.splice(0)) db.close();
  await Promise.all(
    backendDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

beforeAll(async () => {
  installTestPluginRuntime();
  ({ SerialConsole } = await import("./serial-console.js"));
}, 60_000);

const scope = { projectId: "project-1", projectVersionId: null };
const serialDevice = {
  ...scope,
  deviceId: "serial-ports:abc",
  kind: "serial" as const,
  make: "Acme",
  model: "UART",
  connection: "tty:/dev/fixture",
  transport: "local-usb" as const,
  claimedBy: null,
  claimedAt: null,
  claimScope: "machine" as const,
  lastSeen: "2026-08-13T12:00:00.000Z",
  stale: false,
};

function serialConsole(devices: readonly BenchDeviceRecord[] = [serialDevice]) {
  return {
    component: () => (
      <SerialConsole
        devices={devices}
        projectId={scope.projectId}
        projectVersionId={scope.projectVersionId}
      />
    ),
  };
}

describe("serial console", () => {
  it("renders gaps, pauses only UI pulls, resumes, and confirms only tilde sends", async () => {
    const read = vi.fn(() => ({
      lines: [
        {
          cursor: 3,
          at: "2026-08-13T12:00:03.000Z",
          dir: "rx" as const,
          text: "boot ok",
        },
      ],
      nextCursor: 3,
      gaps: [{ afterCursor: 0, dropped: 2 }],
      state: "connected" as const,
    }));
    const send = vi.fn(() => ({ bytes: 7 }));
    const review = vi.fn(() => ({
      sendToken: "send-token-1",
      expiresAt: "2026-08-13T12:01:00.000Z",
    }));
    const current = vi.fn(() => ({
      ...scope,
      sessionId: "serial-session-1",
      deviceId: serialDevice.deviceId,
      state: "connected" as const,
      baud: 115_200,
      latestCursor: 3,
      droppedLines: 2,
      openedAt: "2026-08-13T12:00:00.000Z",
      closedAt: null,
      message: null,
    }));
    const slot = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: current,
          benchDevSerialLinesRead: read,
          benchDevSerialSendReview: review,
          benchDevSerialSend: send,
        },
      },
    );
    await waitFor(() => expect(current).toHaveBeenCalled());
    expect(await slot.findByText("Connected")).toBeTruthy();
    expect(await slot.findByText(/2 lines dropped/u)).toBeTruthy();

    const beforePause = read.mock.calls.length;
    fireEvent.click(slot.getByRole("button", { name: "Pause" }));
    await slot.behavior.emitRealtime("serial:changed", {
      deviceId: serialDevice.deviceId,
      cursor: 4,
    });
    expect(read).toHaveBeenCalledTimes(beforePause);
    fireEvent.click(slot.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(read.mock.calls.length).toBeGreaterThan(beforePause),
    );

    const input = slot.getByLabelText("Serial command");
    fireEvent.change(input, { target: { value: "AT+PING" } });
    expect(
      slot.getByRole("button", { name: "Review" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "~AT+PING" } });
    fireEvent.click(slot.getByRole("button", { name: "Review" }));
    expect(
      await slot.findByText("Send these bytes to the device?"),
    ).toBeTruthy();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ data: "AT+PING" }),
    );
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Confirm send" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          device: serialDevice.deviceId,
          data: "AT+PING",
          sendToken: "send-token-1",
        }),
      ),
    );
    slot.lifecycle.unmount();
  });

  it("keeps an invalid regex inline and recoverable without replacing the console", async () => {
    const read = vi.fn((input: unknown) => {
      if (
        typeof input === "object" &&
        input !== null &&
        Reflect.get(input, "filter") === "("
      ) {
        throw new Error("INVALID_SERIAL_FILTER: Unterminated group");
      }
      return {
        lines: [
          {
            cursor: 1,
            at: "2026-08-13T12:00:00.000Z",
            dir: "rx" as const,
            text: "boot ok",
          },
        ],
        nextCursor: 1,
        gaps: [],
        state: "connected" as const,
      };
    });
    const slot = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => ({
            ...scope,
            sessionId: "serial-filter",
            deviceId: serialDevice.deviceId,
            state: "connected" as const,
            baud: 115_200,
            latestCursor: 1,
            droppedLines: 0,
            openedAt: "2026-08-13T12:00:00.000Z",
            closedAt: null,
            message: null,
          }),
          benchDevSerialLinesRead: read,
        },
      },
    );
    expect(await slot.findByText("Connected")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Serial regex filter"), {
      target: { value: "(" },
    });
    expect(await slot.findByText(/INVALID_SERIAL_FILTER/u)).toBeTruthy();
    expect(slot.getByLabelText("Serial regex filter")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Serial regex filter"), {
      target: { value: "boot" },
    });
    await waitFor(() =>
      expect(slot.queryByText(/INVALID_SERIAL_FILTER/u)).toBeNull(),
    );
    slot.lifecycle.unmount();
  });

  it("designs unavailable, reconnecting, closed, and error states", async () => {
    const unavailable = renderSlot(
      serialConsole([]),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {},
      },
    );
    expect(
      await unavailable.findByText("No serial port available"),
    ).toBeTruthy();
    unavailable.lifecycle.unmount();

    for (const connection of [
      "reconnecting",
      "closed",
      "unconfigured",
    ] as const) {
      const view = renderSlot(
        serialConsole(),
        {},
        {
          context: { projectId: "project-1", threadId: "thread-1" },
          rpc: {
            benchDevSerialSessionCurrent: () => ({
              ...scope,
              sessionId: `serial-${connection}`,
              deviceId: serialDevice.deviceId,
              state: connection,
              baud: 115_200,
              latestCursor: 0,
              droppedLines: 0,
              openedAt: "2026-08-13T12:00:00.000Z",
              closedAt:
                connection === "reconnecting"
                  ? null
                  : "2026-08-13T12:01:00.000Z",
              message:
                connection === "unconfigured" ? "pyserial missing" : null,
            }),
            benchDevSerialLinesRead: () => ({
              lines: [],
              nextCursor: 0,
              gaps: [],
              state: connection,
            }),
          },
        },
      );
      expect(
        await view.findByText(
          connection === "unconfigured"
            ? "Needs setup"
            : connection === "reconnecting"
              ? "Reconnecting"
              : "Closed",
        ),
      ).toBeTruthy();
      view.lifecycle.unmount();
    }

    const error = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => {
            throw new Error("serial failed");
          },
        },
      },
    );
    expect(await error.findByText("serial failed")).toBeTruthy();
    error.lifecycle.unmount();
  });

  it("renders the designed unconfigured state after helper-less Connect", async () => {
    let opened = false;
    const unconfigured = {
      ...scope,
      sessionId: "serial-helper-less",
      deviceId: serialDevice.deviceId,
      state: "unconfigured" as const,
      baud: 115_200,
      latestCursor: 0,
      droppedLines: 0,
      openedAt: "2026-08-13T12:00:00.000Z",
      closedAt: "2026-08-13T12:00:00.000Z",
      message: "Python with pyserial is required for serial sessions.",
    };
    const open = vi.fn(() => {
      opened = true;
      return unconfigured;
    });
    const slot = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => (opened ? unconfigured : null),
          benchDevSerialAutoConnectStatus: () => null,
          benchDevSerialSessionOpen: open,
          benchDevSerialLinesRead: () => ({
            lines: [],
            nextCursor: 0,
            gaps: [],
            state: "unconfigured" as const,
          }),
        },
      },
    );

    expect(await slot.findByText("Closed")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));
    expect(await slot.findByText("Needs setup")).toBeTruthy();
    expect(
      slot.getByText("Python with pyserial is required for serial sessions."),
    ).toBeTruthy();
    expect(open).toHaveBeenCalledOnce();
    slot.lifecycle.unmount();
  });

  it("renders a recovered stale session as closed with a reconnect affordance", async () => {
    const stale = {
      ...scope,
      sessionId: "serial-stale",
      deviceId: serialDevice.deviceId,
      state: "closed" as const,
      baud: 115_200,
      latestCursor: 0,
      droppedLines: 0,
      openedAt: "2026-08-13T12:00:00.000Z",
      closedAt: "2026-08-13T12:01:00.000Z",
      message:
        "The serial session ended when the plugin stopped unexpectedly. Connect to start a new session.",
    };
    const open = vi.fn(() => ({
      ...stale,
      state: "connected" as const,
      closedAt: null,
      message: null,
    }));
    const slot = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => stale,
          benchDevSerialLinesRead: () => ({
            lines: [],
            nextCursor: 0,
            gaps: [],
            state: "closed" as const,
          }),
          benchDevSerialSessionOpen: open,
        },
      },
    );

    expect(await slot.findByText("Closed")).toBeTruthy();
    expect(slot.getByText(/plugin stopped unexpectedly/u)).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(slot.queryByText(/SERIAL_SESSION_NOT_OPEN/u)).toBeNull();
    slot.lifecycle.unmount();
  });

  it("renders and reconnects a kill-9 residue through registered real-runtime RPCs", async () => {
    const db = new Database(":memory:");
    backendDatabases.push(db);
    db.transaction(() => {
      for (const statement of MIGRATIONS) db.exec(statement);
    })();
    const artifactRoot = await mkdtemp(join(tmpdir(), "fs161-console-"));
    backendDirectories.push(artifactRoot);
    const device = upsertCandidate(
      db,
      scope,
      "serial-ports",
      "serial",
      {
        stableIdentity: "abc",
        make: "Acme",
        model: "UART",
        connection: "tty:/dev/fixture",
        transport: "local-usb",
      },
      "2026-08-13T12:00:00.000Z",
    );
    const runtimeOptions = {
      db,
      artifactRoot,
      publish: () => undefined,
      helperStatus: async () => ({ configured: true, message: null }),
      transportFactory: () => new BackendTransport(),
      claimRefreshMs: 1_000_000,
    };
    const killedRuntime = createSerialRuntime(runtimeOptions);
    backendRuntimes.push(killedRuntime);
    await killedRuntime.open(scope, device.deviceId);

    // Starting another runtime without disposing the first preserves the row
    // and claim exactly as an ungraceful process exit would.
    const restartedRuntime = createSerialRuntime(runtimeOptions);
    backendRuntimes.push(restartedRuntime);
    const host = createFakePluginHost({
      pluginId: "fs161-console-registered-runtime",
    });
    backendHosts.push(host);
    registerSerialRpc(host.bb, restartedRuntime);
    const slot = renderSlot(
      serialConsole([device]),
      {},
      {
        context: { projectId: scope.projectId, threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: async (input) =>
            serialRpcContract.benchDevSerialSessionCurrent.output.parse(
              await host.harness.callRpc("benchDevSerialSessionCurrent", input),
            ),
          benchDevSerialSessionOpen: async (input) =>
            serialRpcContract.benchDevSerialSessionOpen.output.parse(
              await host.harness.callRpc("benchDevSerialSessionOpen", input),
            ),
          benchDevSerialLinesRead: async (input) =>
            serialRpcContract.benchDevSerialLinesRead.output.parse(
              await host.harness.callRpc("benchDevSerialLinesRead", input),
            ),
        },
      },
    );

    expect(await slot.findByText("Closed")).toBeTruthy();
    expect(slot.getByText(/plugin stopped unexpectedly/u)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));
    expect(await slot.findByText("Connected")).toBeTruthy();
    expect(slot.queryByRole("alert")).toBeNull();
    expect(
      db
        .prepare<
          [string],
          { claimed_by: string | null }
        >(`SELECT claimed_by FROM bench_device WHERE device_id = ?`)
        .get(device.deviceId)?.claimed_by,
    ).toMatch(/^serial-session:serial-/u);
    slot.lifecycle.unmount();
  });

  it("renders typed recovery guidance instead of raw action errors", async () => {
    const slot = renderSlot(
      serialConsole(),
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => null,
          benchDevSerialAutoConnectStatus: () => null,
          benchDevSerialSessionOpen: () => {
            throw new Error(
              "DEVICE_CLAIMED: Device serial-ports:abc is claimed by serial-session:dead.",
            );
          },
        },
      },
    );

    expect(await slot.findByText("Closed")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));
    expect(
      await slot.findByText(/serial port is in use by another session/u),
    ).toBeTruthy();
    expect(slot.queryByText(/DEVICE_CLAIMED/u)).toBeNull();
    expect(slot.queryByText(/serial-session:dead/u)).toBeNull();
    slot.lifecycle.unmount();
  });
});
