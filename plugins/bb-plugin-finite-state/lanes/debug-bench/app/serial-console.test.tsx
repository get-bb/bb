// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BenchDeviceRecord } from "../registry/families.js";

let SerialConsole: typeof import("./serial-console.js")["SerialConsole"];

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
      lines: [{ cursor: 3, at: "2026-08-13T12:00:03.000Z", dir: "rx" as const, text: "boot ok" }],
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
    const slot = renderSlot(serialConsole(), {}, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevSerialSessionCurrent: current,
        benchDevSerialLinesRead: read,
        benchDevSerialSendReview: review,
        benchDevSerialSend: send,
      },
    });
    await waitFor(() => expect(current).toHaveBeenCalled());
    expect(await slot.findByText("Connected")).toBeTruthy();
    expect(await slot.findByText(/2 lines dropped/u)).toBeTruthy();

    const beforePause = read.mock.calls.length;
    fireEvent.click(slot.getByRole("button", { name: "Pause" }));
    await slot.behavior.emitRealtime("serial:changed", { deviceId: serialDevice.deviceId, cursor: 4 });
    expect(read).toHaveBeenCalledTimes(beforePause);
    fireEvent.click(slot.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(beforePause));

    const input = slot.getByLabelText("Serial command");
    fireEvent.change(input, { target: { value: "AT+PING" } });
    expect(slot.getByRole("button", { name: "Review" }).hasAttribute("disabled")).toBe(true);
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "~AT+PING" } });
    fireEvent.click(slot.getByRole("button", { name: "Review" }));
    expect(await slot.findByText("Send these bytes to the device?")).toBeTruthy();
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ data: "AT+PING" }));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Confirm send" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({
      device: serialDevice.deviceId,
      data: "AT+PING",
      sendToken: "send-token-1",
    })));
    slot.lifecycle.unmount();
  });

  it("keeps an invalid regex inline and recoverable without replacing the console", async () => {
    const read = vi.fn((input: unknown) => {
      if (typeof input === "object" && input !== null && Reflect.get(input, "filter") === "(") {
        throw new Error("INVALID_SERIAL_FILTER: Unterminated group");
      }
      return {
        lines: [{ cursor: 1, at: "2026-08-13T12:00:00.000Z", dir: "rx" as const, text: "boot ok" }],
        nextCursor: 1,
        gaps: [],
        state: "connected" as const,
      };
    });
    const slot = renderSlot(serialConsole(), {}, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevSerialSessionCurrent: () => ({
          ...scope, sessionId: "serial-filter", deviceId: serialDevice.deviceId,
          state: "connected" as const, baud: 115_200, latestCursor: 1, droppedLines: 0,
          openedAt: "2026-08-13T12:00:00.000Z", closedAt: null, message: null,
        }),
        benchDevSerialLinesRead: read,
      },
    });
    expect(await slot.findByText("Connected")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Serial regex filter"), { target: { value: "(" } });
    expect(await slot.findByText(/INVALID_SERIAL_FILTER/u)).toBeTruthy();
    expect(slot.getByLabelText("Serial regex filter")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Serial regex filter"), { target: { value: "boot" } });
    await waitFor(() => expect(slot.queryByText(/INVALID_SERIAL_FILTER/u)).toBeNull());
    slot.lifecycle.unmount();
  });

  it("designs unavailable, reconnecting, closed, and error states", async () => {
    const unavailable = renderSlot(serialConsole([]), {}, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {},
    });
    expect(await unavailable.findByText("No serial port available")).toBeTruthy();
    unavailable.lifecycle.unmount();

    for (const connection of ["reconnecting", "closed", "unconfigured"] as const) {
      const view = renderSlot(serialConsole(), {}, {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          benchDevSerialSessionCurrent: () => ({
            ...scope, sessionId: `serial-${connection}`, deviceId: serialDevice.deviceId,
            state: connection, baud: 115_200, latestCursor: 0, droppedLines: 0,
            openedAt: "2026-08-13T12:00:00.000Z", closedAt: connection === "reconnecting" ? null : "2026-08-13T12:01:00.000Z",
            message: connection === "unconfigured" ? "pyserial missing" : null,
          }),
          benchDevSerialLinesRead: () => ({ lines: [], nextCursor: 0, gaps: [], state: connection }),
        },
      });
      expect(await view.findByText(connection === "unconfigured" ? "Needs setup" : connection === "reconnecting" ? "Reconnecting" : "Closed")).toBeTruthy();
      view.lifecycle.unmount();
    }

    const error = renderSlot(serialConsole(), {}, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: { benchDevSerialSessionCurrent: () => { throw new Error("serial failed"); } },
    });
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
    const slot = renderSlot(serialConsole(), {}, {
      context: { projectId: "project-1", threadId: "thread-1" },
      rpc: {
        benchDevSerialSessionCurrent: () => opened ? unconfigured : null,
        benchDevSerialAutoConnectStatus: () => null,
        benchDevSerialSessionOpen: open,
        benchDevSerialLinesRead: () => ({
          lines: [], nextCursor: 0, gaps: [], state: "unconfigured" as const,
        }),
      },
    });

    expect(await slot.findByText("Closed")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Connect" }));
    expect(await slot.findByText("Needs setup")).toBeTruthy();
    expect(slot.getByText("Python with pyserial is required for serial sessions.")).toBeTruthy();
    expect(open).toHaveBeenCalledOnce();
    slot.lifecycle.unmount();
  });
});
